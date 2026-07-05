import { getPool, cors, ensureFlipTables } from "./db.js";
import { ablyPublish, roomChannel } from "./ably.js";
import {
  createInitialState,
  applyAction,
  publicState,
  MIN_PLAYERS,
} from "../lib/flip-engine.js";

async function loadRoom(client, roomId) {
  const { rows: [room] } = await client.query(
    `SELECT * FROM flip_rooms WHERE id = $1`,
    [roomId]
  );
  if (!room) return null;

  const { rows: players } = await client.query(
    `SELECT username, role, status, seat_index, total_score
     FROM flip_room_players WHERE room_id = $1 ORDER BY seat_index ASC, username ASC`,
    [roomId]
  );
  return { room, players };
}

async function saveGameState(client, roomId, gameState) {
  await client.query(
    `UPDATE flip_rooms SET game_state = $2 WHERE id = $1`,
    [roomId, JSON.stringify(gameState)]
  );

  for (const p of gameState.players) {
    await client.query(
      `UPDATE flip_room_players SET total_score = $3 WHERE room_id = $1 AND username = $2`,
      [roomId, p.username, p.totalScore]
    );
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const client = await getPool().connect();
  try {
    await ensureFlipTables(client);

    if (req.method === "GET") {
      const { room_id, username } = req.query;
      if (!room_id) return res.status(400).json({ error: "room_id required" });

      const data = await loadRoom(client, room_id);
      if (!data) return res.status(404).json({ error: "room not found" });

      const { room, players } = data;
      let view = null;
      if (room.game_state) {
        view = publicState(room.game_state, username || null);
      }

      return res.status(200).json({
        room: {
          id: room.id,
          status: room.status,
          host_username: room.host_username,
          target_score: room.target_score,
        },
        players,
        state: view,
      });
    }

    if (req.method === "PATCH") {
      const { action, room_id, username, target_username } = req.body || {};
      if (!action || !room_id || !username) {
        return res.status(400).json({ error: "action, room_id, and username required" });
      }

      const user = username.toLowerCase();
      const data = await loadRoom(client, room_id);
      if (!data) return res.status(404).json({ error: "room not found" });

      const { room, players } = data;

      // ── start game ─────────────────────────────────────────────────────
      if (action === "start") {
        if (room.host_username !== user) {
          return res.status(403).json({ error: "Only host can start" });
        }
        if (room.status !== "lobby") {
          return res.status(400).json({ error: "Game already started" });
        }

        const accepted = players.filter(
          (p) => p.status === "accepted" || p.role === "host"
        );
        if (accepted.length < MIN_PLAYERS) {
          return res.status(400).json({
            error: `Need at least ${MIN_PLAYERS} accepted players`,
          });
        }

        const usernames = accepted
          .sort((a, b) => (a.seat_index ?? 0) - (b.seat_index ?? 0))
          .map((p) => p.username);

        const gameState = createInitialState(usernames, {
          targetScore: room.target_score || 200,
        });

        await client.query(
          `UPDATE flip_rooms SET status='active', game_state=$2, started_at=NOW() WHERE id=$1`,
          [room_id, JSON.stringify(gameState)]
        );
        await client.query(
          `UPDATE flip_room_players SET status='playing'
           WHERE room_id=$1 AND status='accepted'`,
          [room_id]
        );
        await client.query(
          `UPDATE flip_room_players SET status='playing'
           WHERE room_id=$1 AND role='host'`,
          [room_id]
        );

        const payload = {
          room_id,
          state: publicState(gameState),
        };
        await ablyPublish(roomChannel(room_id), "game-start", payload);
        await ablyPublish(roomChannel(room_id), "state-update", payload);

        return res.status(200).json(payload);
      }

      // ── game actions ───────────────────────────────────────────────────
      if (!room.game_state) {
        return res.status(400).json({ error: "Game not started" });
      }
      if (room.status !== "active") {
        return res.status(400).json({ error: "Game not active" });
      }

      let gameState = room.game_state;
      if (typeof gameState === "string") gameState = JSON.parse(gameState);
      else if (gameState) gameState = structuredClone(gameState);

      try {
        if (action === "hit") {
          gameState = applyAction(gameState, "hit", user);
        } else if (action === "stay") {
          gameState = applyAction(gameState, "stay", user);
        } else if (action === "play_action") {
          if (!target_username) {
            return res.status(400).json({ error: "target_username required" });
          }
          gameState = applyAction(gameState, "play_action", user, {
            targetUsername: target_username,
          });
        } else if (action === "next_round") {
          if (room.host_username !== user) {
            return res.status(403).json({ error: "Only host can start next round" });
          }
          gameState = applyAction(gameState, "next_round", user);
        } else {
          return res.status(400).json({ error: `Unknown action: ${action}` });
        }
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }

      await saveGameState(client, room_id, gameState);

      if (gameState.phase === "game_over") {
        await client.query(
          `UPDATE flip_rooms SET status='complete', ended_at=NOW() WHERE id=$1`,
          [room_id]
        );
      }

      const payload = {
        room_id,
        state: publicState(gameState),
      };
      await ablyPublish(roomChannel(room_id), "state-update", payload);

      if (gameState.phase === "game_over") {
        await ablyPublish(roomChannel(room_id), "game-over", {
          room_id,
          winner: gameState.winner,
          state: payload.state,
        });
      } else if (gameState.phase === "round_end") {
        await ablyPublish(roomChannel(room_id), "round-end", payload);
      }

      return res.status(200).json(payload);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } finally {
    client.release();
  }
}
