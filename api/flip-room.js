import { getPool, cors, ensureFlipTables } from "./db.js";
import { ablyPublish, LOBBY_CHANNEL, roomChannel } from "./ably.js";
import { MIN_PLAYERS, MAX_PLAYERS, minPlayersForMode } from "../lib/flip-deck.js";
import {
  abandonStaleLobbyRooms,
  assertInviteesAvailable,
  listPendingInvites,
} from "./flip-lobby-util.js";

async function getRoomWithPlayers(client, roomId) {
  const { rows: roomRows } = await client.query(
    `SELECT * FROM flip_rooms WHERE id = $1`,
    [roomId]
  );
  const { rows: players } = await client.query(
    `SELECT username, role, status, seat_index, total_score
     FROM flip_room_players WHERE room_id = $1 ORDER BY role DESC, username ASC`,
    [roomId]
  );
  return { room: roomRows[0] || null, players };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const client = await getPool().connect();
  try {
    await ensureFlipTables(client);
    await abandonStaleLobbyRooms(client);

    if (req.method === "POST") {
      const { username, invitees = [], game_mode = "classic", brutal_mode = false } =
        req.body || {};
      if (!username) return res.status(400).json({ error: "username required" });

      const host = username.toLowerCase();
      const mode = game_mode === "vengeance" ? "vengeance" : "classic";
      const brutal = mode === "vengeance" && !!brutal_mode;
      const minP = minPlayersForMode(mode);

      const uniqueInvitees = [...new Set(invitees.map((i) => i.toLowerCase()))].filter(
        (i) => i !== host
      );

      if (uniqueInvitees.length === 0 && mode === "vengeance") {
        return res.status(400).json({ error: "Vengeance requires at least one other player." });
      }

      const totalPlayers = 1 + uniqueInvitees.length;
      if (totalPlayers < minP || totalPlayers > MAX_PLAYERS) {
        return res.status(400).json({
          error: `${mode === "vengeance" ? "Vengeance" : "Classic"} requires ${minP}-${MAX_PLAYERS} players (${totalPlayers} selected).`,
        });
      }

      const availErr = await assertInviteesAvailable(client, uniqueInvitees);
      if (availErr) return res.status(400).json({ error: availErr });

      const { rows: [room] } = await client.query(
        `INSERT INTO flip_rooms (host_username, game_mode, brutal_mode) VALUES ($1,$2,$3) RETURNING id`,
        [host, mode, brutal]
      );
      const roomId = room.id;

      await client.query(
        `INSERT INTO flip_room_players (room_id, username, role, status, seat_index)
         VALUES ($1,$2,'host','accepted',0)`,
        [roomId, host]
      );

      for (let idx = 0; idx < uniqueInvitees.length; idx++) {
        const invitee = uniqueInvitees[idx];
        await client.query(
          `INSERT INTO flip_room_players (room_id, username, role, status, seat_index)
           VALUES ($1,$2,'player','invited',$3)
           ON CONFLICT (room_id, username) DO NOTHING`,
          [roomId, invitee, idx + 1]
        );
      }

      for (const invitee of uniqueInvitees) {
        await ablyPublish(LOBBY_CHANNEL, "invite", {
          invitee,
          host,
          room_id: roomId,
        });
      }

      return res.status(200).json({ room_id: roomId, game_mode: mode, brutal_mode: brutal });
    }

    if (req.method === "GET") {
      const { room_id, username } = req.query;

      // Lookup active or waiting room for a user (reconnect after refresh).
      if (username && !room_id) {
        const u = String(username).toLowerCase();
        const pending_invites = await listPendingInvites(client, u);

        const { rows } = await client.query(
          `SELECT fr.id, fr.host_username, fr.status, fr.target_score, fr.game_mode, fr.brutal_mode, fr.created_at,
                  fp.role, fp.status AS player_status
           FROM flip_room_players fp
           JOIN flip_rooms fr ON fr.id = fp.room_id
           WHERE fp.username = $1 AND fr.status IN ('lobby', 'active')
             AND fp.status NOT IN ('left', 'declined', 'invited')
           ORDER BY fr.created_at DESC
           LIMIT 1`,
          [u]
        );
        if (!rows.length) {
          return res.status(200).json({ room_id: null, pending_invites });
        }
        const row = rows[0];
        const { players } = await getRoomWithPlayers(client, row.id);
        return res.status(200).json({
          room_id: row.id,
          role: row.role,
          player_status: row.player_status,
          pending_invites,
          room: {
            id: row.id,
            host_username: row.host_username,
            status: row.status,
            target_score: row.target_score,
            game_mode: row.game_mode || "classic",
            brutal_mode: !!row.brutal_mode,
          },
          players,
        });
      }

      if (!room_id) {
        return res.status(400).json({ error: "room_id or username required" });
      }
      const { room, players } = await getRoomWithPlayers(client, room_id);
      if (!room) return res.status(404).json({ error: "room not found" });
      return res.status(200).json({
        room: {
          ...room,
          game_mode: room.game_mode || "classic",
          brutal_mode: !!room.brutal_mode,
        },
        players,
      });
    }

    if (req.method === "PATCH") {
      const { action, room_id, username, previous_username } = req.body || {};
      const user = username ? username.toLowerCase() : null;

      if (action === "rename_username") {
        const prev = previous_username ? String(previous_username).toLowerCase() : null;
        const next = user;
        if (!prev || !next || prev === next) {
          return res.status(400).json({ error: "previous_username and username required" });
        }

        const { rows: memberships } = await client.query(
          `SELECT fr.id, fr.status, fr.host_username, fp.role
           FROM flip_room_players fp
           JOIN flip_rooms fr ON fr.id = fp.room_id
           WHERE fp.username = $1 AND fr.status IN ('lobby', 'active')
           ORDER BY fr.created_at DESC
           LIMIT 1`,
          [prev]
        );
        if (!memberships.length) {
          return res.status(200).json({ ok: true, room_id: null });
        }

        const { id: rid, status, host_username, role } = memberships[0];
        if (status === "active") {
          return res.status(400).json({ error: "Cannot rename during an active game." });
        }

        const { rows: taken } = await client.query(
          `SELECT 1 FROM flip_room_players WHERE room_id = $1 AND username = $2 LIMIT 1`,
          [rid, next]
        );
        if (taken.length) {
          return res.status(400).json({ error: "That name is already in this room." });
        }

        await client.query(
          `UPDATE flip_room_players SET username = $3 WHERE room_id = $1 AND username = $2`,
          [rid, prev, next]
        );
        if (host_username === prev) {
          await client.query(`UPDATE flip_rooms SET host_username = $2 WHERE id = $1`, [rid, next]);
        }

        const { players } = await getRoomWithPlayers(client, rid);
        await ablyPublish(roomChannel(rid), "player-status", { players });

        for (const p of players) {
          if (p.status === "invited" && p.username === next) {
            await ablyPublish(LOBBY_CHANNEL, "invite", {
              invitee: next,
              host: players.find((x) => x.role === "host")?.username || host_username,
              room_id: rid,
            });
          }
        }

        return res.status(200).json({ ok: true, room_id: rid, role });
      }

      if (!action || !room_id) {
        return res.status(400).json({ error: "action and room_id required" });
      }

      if (action === "accept") {
        await client.query(
          `UPDATE flip_room_players SET status='accepted' WHERE room_id=$1 AND username=$2`,
          [room_id, user]
        );
        const { players } = await getRoomWithPlayers(client, room_id);
        await ablyPublish(roomChannel(room_id), "player-status", { players });
        return res.status(200).json({ ok: true });
      }

      if (action === "decline") {
        await client.query(
          `UPDATE flip_room_players SET status='declined' WHERE room_id=$1 AND username=$2`,
          [room_id, user]
        );
        const { players } = await getRoomWithPlayers(client, room_id);
        await ablyPublish(roomChannel(room_id), "player-status", { players });
        return res.status(200).json({ ok: true });
      }

      if (action === "abandon") {
        await client.query(
          `UPDATE flip_rooms SET status='abandoned', ended_at=NOW() WHERE id=$1`,
          [room_id]
        );
        await client.query(
          `UPDATE flip_room_players SET status='left' WHERE room_id=$1 AND status='playing'`,
          [room_id]
        );
        const payload = { room_id, abandoned_by: user };
        await ablyPublish(roomChannel(room_id), "room-abandoned", payload);
        await ablyPublish(LOBBY_CHANNEL, "room-abandoned", payload);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } finally {
    client.release();
  }
}
