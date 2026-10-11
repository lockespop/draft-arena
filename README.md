# Draft Arena 🏀

Multiplayer all-time NBA draft battles. Create a room, text the link to friends,
draft a starting five, and let the AI judge crown a winner.

Two modes:

- **🐍 Snake Draft** — classic turn-based drafting, 5 rounds, PG/SG/SF/PF/C slots,
  60-second pick timer with auto-pick on timeout.
- **⚡ Free-for-All** — every round, each drafter still building secretly submits a
  full lineup: one player per open roster slot (up to 5 in round 1), each pick
  assigned to its position. Rounds run on a 3-minute clock with a prominent
  countdown. Your picks appear on your roster immediately (marked pending) and
  sync to the server live as you tap — if the buzzer hits before you submit,
  your picks are kept and only the still-empty slots are auto-filled
  needs-based, never replaced wholesale. At the reveal, any player picked by
  2+ drafters is **eliminated** from the pool entirely — nobody gets them.
  Players picked by exactly one drafter **lock in** at their position and come
  off the board. The reveal screen shows every team's full locked roster
  ("League progress") plus that round's eliminations. Drafters with a full
  starting five sit out; rounds continue until every team is full. Land 5
  unique picks in round 1 and you're done immediately.

Any mix of humans and computer opponents (5 bot personalities: Best Available,
Positional Needs, Defense First, Star Chaser, Contrarian). Solo vs bots works.

**Player pool:** 409 all-time NBA greats with real full names, positions, eras,
career stats, and era-adjusted attribute ratings. Stats are approximate —
generated for gameplay, not an official record book. Full names + stats only;
no photos or likenesses.

## Quick start (local)

```bash
npm install
npm run dev:all
```

Then open **http://localhost:5173** on your phone or computer. `dev:all` runs both:

- the game server on **ws://localhost:3001** (`npm run dev:server`)
- the web app on **http://localhost:5173** (`npm run dev`)

To play with friends on the same Wi-Fi, give them `http://<your-lan-ip>:5173`
(the WebSocket URL defaults to the same host, port 3001).

## How a game goes

1. Enter a name, pick a mode, **Create Room**.
2. Copy the invite link, or tell friends the 6-letter room code.
3. Add computer opponents (optional — pick a style or random).
4. **Start Draft**. Draft your five.
5. On the results screen, paste an **OpenAI API key** and hit **Judge** for the
   full analyst-style verdict. The key is stored only in your browser
   (localStorage) and is sent only to OpenAI. Without a key you still get the
   instant heuristic ranking.

## Project structure

```
src/
  shared/types.ts        # Room/draft/message types shared by client+server
  data/players.json      # 409-player database (versioned, hand-built)
  engine/
    draft.ts             # Pure draft mechanics (snake + free-form)
    bots.ts              # Bot personalities
    judge.ts             # Heuristic ranking + OpenAI analyst-verdict prompt
    rng.ts               # Seeded RNG
  server/index.ts        # Authoritative WebSocket game server (rooms, timers, bots)
  client/
    hooks/useRoom.ts     # WebSocket connection hook
    components/ui.tsx    # Shared UI (buttons, cards, roster slots, player picker…)
    screens/             # Home, Lobby, SnakeDraft, FreeformDraft, Results
    players.ts           # Client-side player data access
scripts/
  simulate.ts            # Headless engine simulation (npm run simulate)
  smoke.ts               # End-to-end test vs a live server
  deadline-test.ts        # Verifies AFK auto-pick/auto-submit
```

## Tests

```bash
npm run simulate   # full snake + free-form drafts, headless, asserts valid rosters
npm run build      # TypeScript check + production build
```

End-to-end (server + real WebSocket client):

```bash
# terminal 1 (fast bot timers for testing)
BOT_DELAY_MIN=150 BOT_DELAY_MAX=400 npm run dev:server
# terminal 2
npx tsx scripts/smoke.ts
```

## Going live — the one step Mike needs

The app is built to run locally with **zero accounts**. To put it on the internet
for friends, deploy two free services (one free account covers both):

**Option A — Render (recommended, one account):**

1. Create a free account at render.com, connect this repo.
2. **Web Service** (the game server): build `npm install`, start
   `npx tsx src/server/index.ts`, env `PORT=10000` (Render injects its own PORT —
   the server already reads `process.env.PORT`). Free tier spins down when idle;
   first connection takes ~30s to wake.
3. **Static Site** (the web app): build `npm run build`, publish `dist/`,
   env var `VITE_WS_URL=wss://<your-web-service>.onrender.com`.
4. Share the static-site URL. Done.

**Option B — swap the transport later:** the realtime layer is isolated in
`src/server/index.ts` (authoritative) + `src/client/hooks/useRoom.ts`
(transport). If you ever want Supabase Realtime instead of the custom server,
only those two files change; the engine and UI are transport-agnostic.

## Notes & caveats

- **AI judge calls OpenAI directly from the browser** with your pasted key. Fine
  for playing with friends; before any public launch, move it behind a tiny
  serverless proxy so the key isn't in client code.
- **No auth, no matchmaking, no leaderboards** — that's v2. Rooms are
  in-memory and expire after 2h idle.
- Free Render tier sleeps when idle; the first player to open the app waits
  ~30s once. Upgrading the web service to paid ($7/mo) removes that.
