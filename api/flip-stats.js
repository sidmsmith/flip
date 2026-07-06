import { getPool, cors, ensureFlipTables } from "./db.js";

const MIN_H2H_GAMES = 3;

function computeStreaks(outcomes) {
  let best = 0;
  let run = 0;
  for (const o of outcomes) {
    if (o === "win") {
      run++;
      if (run > best) best = run;
    } else run = 0;
  }
  let current = 0;
  for (let i = outcomes.length - 1; i >= 0; i--) {
    if (outcomes[i] === "win") current++;
    else break;
  }
  return { currentStreak: current, bestStreak: best };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { username = "" } = req.query;
  const client = await getPool().connect();

  try {
    await ensureFlipTables(client);

    const [meRes, overallRes, mpRes, flip7Res, bustRes, soloRes] = await Promise.all([
      client.query(
        `SELECT outcome, final_score, rounds_played
         FROM flip_games WHERE LOWER(username) = LOWER($1)
         ORDER BY end_time ASC`,
        [username]
      ),
      client.query(
        `SELECT outcome, COUNT(*)::int AS cnt,
                ROUND(AVG(final_score)::numeric, 1) AS avg_score,
                MAX(final_score)::int AS best_score
         FROM flip_games GROUP BY outcome`
      ),
      client.query(
        `SELECT
           fg.outcome = 'win' AS i_won,
           fg.players_json,
           fg.end_time
         FROM flip_games fg
         WHERE LOWER(fg.username) = LOWER($1)
           AND jsonb_array_length(fg.players_json) > 1
         ORDER BY fg.end_time ASC`,
        [username]
      ),
      client.query(
        `SELECT COUNT(*)::int AS cnt FROM flip_games
         WHERE LOWER(username) = LOWER($1) AND rounds_json IS NOT NULL`,
        [username]
      ),
      client.query(
        `SELECT
           COUNT(*) FILTER (WHERE outcome = 'loss')::int AS losses,
           COUNT(*)::int AS total
         FROM flip_games WHERE LOWER(username) = LOWER($1)`,
        [username]
      ),
      client.query(
        `SELECT rounds_played, rounds_json, end_time
         FROM flip_games
         WHERE LOWER(username) = LOWER($1)
           AND outcome = 'win'
           AND jsonb_array_length(players_json) = 1
         ORDER BY end_time DESC`,
        [username]
      ),
    ]);

    const meRows = meRes.rows;
    const meTotal = meRows.length;
    const meWins = meRows.filter((r) => r.outcome === "win").length;
    const { currentStreak, bestStreak } = computeStreaks(meRows.map((r) => r.outcome));

    const avgFinal =
      meTotal > 0
        ? Math.round(meRows.reduce((s, r) => s + Number(r.final_score), 0) / meTotal)
        : 0;

    let overallTotal = 0;
    let overallWins = 0;
    let overallAvg = 0;
    let overallBest = 0;
    for (const r of overallRes.rows) {
      const cnt = Number(r.cnt);
      overallTotal += cnt;
      if (r.outcome === "win") {
        overallWins += cnt;
        overallAvg = parseFloat(r.avg_score) || 0;
        overallBest = Number(r.best_score) || 0;
      }
    }

    const mpRows = mpRes.rows;
    const mpMatches = mpRows.length;
    const mpWins = mpRows.filter((r) => r.i_won).length;

    const h2hMap = {};
    for (const r of mpRows) {
      const players = r.players_json || [];
      const opp = players
        .map((p) => (typeof p === "string" ? p : p.username)?.toLowerCase())
        .filter((o) => o && o !== username.toLowerCase())
        .sort();
      if (!opp.length) continue;
      const key = opp.join(",");
      if (!h2hMap[key]) h2hMap[key] = { opponents: opp, games: [] };
      h2hMap[key].games.push(r.i_won);
    }

    const headToHead = Object.values(h2hMap)
      .filter((h) => h.games.length >= MIN_H2H_GAMES)
      .map((h) => {
        const wins = h.games.filter(Boolean).length;
        const total = h.games.length;
        return {
          opponents: h.opponents,
          wins,
          losses: total - wins,
          winPct: Math.round((wins / total) * 100),
        };
      })
      .sort((a, b) => b.wins + b.losses - (a.wins + a.losses));

    const bustTotal = Number(bustRes.rows[0]?.total) || 0;
    const bustLosses = Number(bustRes.rows[0]?.losses) || 0;

    const soloRows = soloRes.rows;
    const soloWins = soloRows.length;
    const soloRoundCounts = soloRows.map((r) => {
      const rj = r.rounds_json;
      if (rj && typeof rj === "object" && rj.rounds_to_200) {
        return Number(rj.rounds_to_200);
      }
      return Number(r.rounds_played) || 0;
    }).filter((n) => n > 0);
    const soloBest = soloRoundCounts.length ? Math.min(...soloRoundCounts) : null;
    const soloAvg = soloRoundCounts.length
      ? Math.round(soloRoundCounts.reduce((a, b) => a + b, 0) / soloRoundCounts.length)
      : null;
    const soloLast = soloRoundCounts[0] ?? null;

    return res.status(200).json({
      me: {
        totalGames: meTotal,
        wins: meWins,
        winPct: meTotal > 0 ? Math.round((meWins / meTotal) * 100) : 0,
        currentStreak,
        bestStreak,
        avgFinalScore: avgFinal,
        bustRatePct: bustTotal > 0 ? Math.round((bustLosses / bustTotal) * 100) : 0,
      },
      overall: {
        totalGames: overallTotal,
        wins: overallWins,
        winPct: overallTotal > 0 ? Math.round((overallWins / overallTotal) * 100) : 0,
        avgFinalScore: Math.round(overallAvg),
        bestScore: overallBest,
      },
      mpStats: {
        matches: mpMatches,
        wins: mpWins,
        losses: mpMatches - mpWins,
        winPct: mpMatches > 0 ? Math.round((mpWins / mpMatches) * 100) : 0,
        headToHead,
      },
      soloStats: {
        wins: soloWins,
        bestRounds: soloBest,
        avgRounds: soloAvg,
        lastRounds: soloLast,
      },
    });
  } finally {
    client.release();
  }
}
