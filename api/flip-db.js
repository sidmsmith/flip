import { getPool, cors, ensureFlipTables } from "./db.js";
import { publicState } from "../lib/flip-engine.js";

const TABLES = {
  flip_lobby: { orderBy: "last_seen DESC", cols: "username, last_seen" },
  flip_rooms: {
    orderBy: "created_at DESC",
    cols: "id, host_username, status, target_score, game_state, created_at, started_at, ended_at",
  },
  flip_room_players: {
    orderBy: "id DESC",
    cols: "id, room_id, username, role, status, seat_index, total_score",
  },
  flip_games: {
    orderBy: "end_time DESC",
    cols: "id, room_id, username, outcome, final_score, rounds_played, end_time",
  },
};

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const client = await getPool().connect();
  try {
    await ensureFlipTables(client);

    const { table = "flip_rooms", active, username } = req.query;

    if (active === "1") {
      const { rows: rooms } = await client.query(`
        SELECT id, host_username, status, target_score, game_state, started_at
        FROM flip_rooms
        WHERE status IN ('lobby', 'active')
        ORDER BY created_at DESC
        LIMIT 10
      `);
      const enriched = rooms.map((room) => {
        let state = room.game_state;
        if (typeof state === "string") state = JSON.parse(state);
        return {
          id: room.id,
          host_username: room.host_username,
          status: room.status,
          target_score: room.target_score,
          started_at: room.started_at,
          state: state ? publicState(state, username || null) : null,
          raw: state,
        };
      });
      return res.status(200).json({ rooms: enriched });
    }

    const spec = TABLES[table.toLowerCase()];
    if (!spec) {
      return res.status(400).json({ error: "Invalid table", allowed: Object.keys(TABLES) });
    }

    const { rows } = await client.query(
      `SELECT ${spec.cols} FROM ${table} ORDER BY ${spec.orderBy} LIMIT 50`
    );
    return res.status(200).json({ table, rows });
  } catch (e) {
    return res.status(500).json({ error: String(e.message) });
  } finally {
    client.release();
  }
}
