import { getPool, cors, ensureFlipTables } from "./db.js";
import { ablyPublish, LOBBY_CHANNEL } from "./ably.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const client = await getPool().connect();
  try {
    await ensureFlipTables(client);

    if (req.method === "POST") {
      const { username } = req.body || {};
      if (!username) return res.status(400).json({ error: "username required" });
      const u = username.toLowerCase();

      await client.query(
        `INSERT INTO flip_lobby (username, last_seen) VALUES ($1, NOW())
         ON CONFLICT (username) DO UPDATE SET last_seen = NOW()`,
        [u]
      );

      await ablyPublish(LOBBY_CHANNEL, "lobby-update", { username: u });
      return res.status(200).json({ ok: true });
    }

    if (req.method === "GET") {
      const { rows } = await client.query(`
        SELECT
          u.username,
          CASE
            WHEN mp.username IS NOT NULL THEN 'playing'
            WHEN l.last_seen > NOW() - INTERVAL '30 seconds' THEN 'available'
            ELSE 'offline'
          END AS status
        FROM (
          SELECT DISTINCT LOWER(username) AS username
          FROM flip_games
          WHERE username IS NOT NULL AND username <> ''
          UNION
          SELECT username FROM flip_lobby
        ) u
        LEFT JOIN flip_lobby l ON l.username = u.username
        LEFT JOIN (
          SELECT DISTINCT fp.username
          FROM flip_room_players fp
          JOIN flip_rooms fr ON fr.id = fp.room_id
          WHERE fr.status = 'active' AND fp.status = 'playing'
        ) mp ON mp.username = u.username
        ORDER BY
          CASE
            WHEN l.last_seen > NOW() - INTERVAL '30 seconds' THEN 0
            WHEN mp.username IS NOT NULL THEN 1
            ELSE 2
          END,
          u.username ASC
      `);
      return res.status(200).json({ players: rows });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } finally {
    client.release();
  }
}
