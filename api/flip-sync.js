import { getPool, cors, ensureFlipTables } from "./db.js";

function normalizeGame(raw) {
  if (!raw || typeof raw !== "object") {
    return { error: "Game payload must be an object." };
  }

  const required = [
    "client_game_id",
    "username",
    "start_time",
    "end_time",
    "outcome",
    "final_score",
    "players_json",
  ];

  for (const field of required) {
    if (!(field in raw)) return { error: `Missing required field: ${field}` };
  }

  const outcome = String(raw.outcome).toLowerCase();
  if (outcome !== "win" && outcome !== "loss") {
    return { error: "outcome must be 'win' or 'loss'." };
  }

  if (!Array.isArray(raw.players_json)) {
    return { error: "players_json must be an array." };
  }

  return {
    game: {
      client_game_id: String(raw.client_game_id),
      room_id: raw.room_id || null,
      username: String(raw.username).trim().toLowerCase().slice(0, 64),
      start_time: new Date(raw.start_time),
      end_time: new Date(raw.end_time),
      outcome,
      final_score: Number(raw.final_score) || 0,
      rounds_played: Number(raw.rounds_played) || 0,
      players_json: raw.players_json,
      rounds_json: raw.rounds_json || null,
    },
  };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const games = Array.isArray(req.body?.games) ? req.body.games : null;
  if (!games?.length) {
    return res.status(400).json({ error: "Request must include games array." });
  }

  const client = await getPool().connect();
  const acked_ids = [];
  const rejected = [];

  try {
    await ensureFlipTables(client);
    await client.query("BEGIN");

    for (const payload of games) {
      const { game, error } = normalizeGame(payload);
      if (error) {
        rejected.push({ client_game_id: payload?.client_game_id || null, reason: error });
        continue;
      }

      if (Number.isNaN(game.start_time.getTime()) || Number.isNaN(game.end_time.getTime())) {
        rejected.push({ client_game_id: game.client_game_id, reason: "Invalid dates." });
        continue;
      }

      try {
        await client.query(
          `INSERT INTO flip_games (
            client_game_id, room_id, username, start_time, end_time,
            outcome, final_score, rounds_played, players_json, rounds_json
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (client_game_id) DO NOTHING`,
          [
            game.client_game_id,
            game.room_id,
            game.username,
            game.start_time,
            game.end_time,
            game.outcome,
            game.final_score,
            game.rounds_played,
            JSON.stringify(game.players_json),
            game.rounds_json ? JSON.stringify(game.rounds_json) : null,
          ]
        );
        acked_ids.push(game.client_game_id);
      } catch (e) {
        rejected.push({ client_game_id: game.client_game_id, reason: e.message });
      }
    }

    await client.query("COMMIT");
    return res.status(200).json({ acked_ids, rejected });
  } catch (e) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}
