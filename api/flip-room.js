import { getPool, cors, ensureFlipTables } from "./db.js";
import { ablyPublish, LOBBY_CHANNEL, roomChannel } from "./ably.js";
import { MIN_PLAYERS, MAX_PLAYERS } from "../lib/flip-deck.js";

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

    if (req.method === "POST") {
      const { username, invitees = [] } = req.body || {};
      if (!username) return res.status(400).json({ error: "username required" });
      if (!invitees.length) return res.status(400).json({ error: "invitees required" });

      const host = username.toLowerCase();
      const uniqueInvitees = [...new Set(invitees.map((i) => i.toLowerCase()))].filter(
        (i) => i !== host
      );
      const totalPlayers = 1 + uniqueInvitees.length;
      if (totalPlayers < MIN_PLAYERS || totalPlayers > MAX_PLAYERS) {
        return res.status(400).json({
          error: `Flip 7 requires ${MIN_PLAYERS}-${MAX_PLAYERS} players (${totalPlayers} selected).`,
        });
      }

      const { rows: [room] } = await client.query(
        `INSERT INTO flip_rooms (host_username) VALUES ($1) RETURNING id`,
        [host]
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

      return res.status(200).json({ room_id: roomId });
    }

    if (req.method === "GET") {
      const { room_id, username } = req.query;

      // Lookup active or waiting room for a user (reconnect after refresh).
      if (username && !room_id) {
        const u = String(username).toLowerCase();
        const { rows } = await client.query(
          `SELECT fr.id, fr.host_username, fr.status, fr.target_score, fr.created_at,
                  fp.role, fp.status AS player_status
           FROM flip_room_players fp
           JOIN flip_rooms fr ON fr.id = fp.room_id
           WHERE fp.username = $1 AND fr.status IN ('lobby', 'active')
           ORDER BY fr.created_at DESC
           LIMIT 1`,
          [u]
        );
        if (!rows.length) {
          return res.status(200).json({ room_id: null });
        }
        const row = rows[0];
        const { players } = await getRoomWithPlayers(client, row.id);
        return res.status(200).json({
          room_id: row.id,
          role: row.role,
          player_status: row.player_status,
          room: {
            id: row.id,
            host_username: row.host_username,
            status: row.status,
            target_score: row.target_score,
          },
          players,
        });
      }

      if (!room_id) {
        return res.status(400).json({ error: "room_id or username required" });
      }
      const { room, players } = await getRoomWithPlayers(client, room_id);
      if (!room) return res.status(404).json({ error: "room not found" });
      return res.status(200).json({ room, players });
    }

    if (req.method === "PATCH") {
      const { action, room_id, username } = req.body || {};
      if (!action || !room_id) {
        return res.status(400).json({ error: "action and room_id required" });
      }
      const user = username ? username.toLowerCase() : null;

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
