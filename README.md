# Flip 7 Online

Multiplayer Flip 7 card game — web app with lobby invites, server-authoritative game state, Neon Postgres stats, and Ably realtime updates.

## Environment variables (Vercel)

| Variable | Description |
|---|---|
| `NEON_DATABASE_URL` | Postgres connection string (shared Neon project; uses `flip_*` tables) |
| `ABLY_API_KEY` | Ably REST API key for server-side publish (same key as Wordle is fine) |

## Local development

```bash
npm install
npm test
npx vercel dev
```

Open `http://localhost:3000/flip`.

## Deploy

1. Create a new GitHub repo and push this folder.
2. Import the repo in Vercel as a new project.
3. Set `NEON_DATABASE_URL` and `ABLY_API_KEY` in Vercel project settings.
4. Update `API_ORIGIN` in `flip.html` to your Vercel URL after first deploy.

## Ably channels

- `flip-lobby` — player list, invites, room abandoned
- `flip-room-{roomId}` — in-room game events

Client uses the Ably subscribe key in `flip.html` (same pattern as Wordle).

## Lobby / invites

- Players only appear as **available** while they have **Game Lobby** open (heartbeat).
- Closing the lobby removes you from availability immediately.
- Anyone already in a lobby room or active game is not inviteable.
- Invites are stored on the server; opening Game Lobby reloads any pending invites (so a missed Ably toast still works).

## Database tables

Created automatically on first API call:

- `flip_lobby` — online presence
- `flip_rooms` — game rooms + live `game_state` JSONB
- `flip_room_players` — room membership
- `flip_games` — completed games for statistics
