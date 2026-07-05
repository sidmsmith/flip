# Deploy Flip 7

## 1. GitHub

```powershell
cd "C:\Users\ssmith\OneDrive - Manhattan Associates\Documents\Solutions Consulting\Scripts\Web\flip"
git init
git add .
git commit -m "Initial Flip 7 online game"
gh repo create flip7 --private --source=. --push
```

(Use your preferred repo name and visibility.)

## 2. Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import the GitHub repo.
2. Framework preset: **Other** (static + serverless functions).
3. Root directory: `.` (default).
4. Add environment variables:
   - `NEON_DATABASE_URL` — same value as Wordle
   - `ABLY_API_KEY` — same value as Wordle
5. Deploy.

## 3. After first deploy

Update `API_ORIGIN` in `flip.html` to your Vercel URL, e.g.:

```javascript
const API_ORIGIN = "https://your-project.vercel.app";
```

Redeploy (or commit and push).

## 4. Smoke test (3 players)

1. Open the app in three browser windows (or normal + incognito).
2. Set three different usernames.
3. Player 1: **Find Game** → select players 2 & 3 → **Invite**.
4. Players 2 & 3: **Accept**.
5. Player 1: **Start Game** (needs 3+ accepted).
6. Take turns with **Hit** / **Stay** until round ends.
7. Host: **Next Round** until someone reaches 200.
8. Check **Stats** after game over.

## Local dev

```powershell
cd flip
npm install
npx vercel dev
```

Uses `.env.local` with `NEON_DATABASE_URL` and `ABLY_API_KEY` if present.
