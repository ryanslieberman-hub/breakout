# worker-pricing-engine

Server-side, tamper-proof port of Breakout's pricing engine (index.html's
`const ENGINE = (() => {...})()`), all four leagues: NBA, MLB, Golf, NFL.
Exists so real-money challenge settlement in `worker-payments` never has to
trust anything a client can write - prices are independently recomputed from
real ESPN/MLB Stats API/balldontlie data and stored in Firestore's
`priceEngine/{league}_{rank}` docs, which `firestore.rules` locks to
server-only writes.

## Setup

1. `npm install`
2. `cp .dev.vars.example .dev.vars` and fill in:
   - `FIREBASE_SERVICE_ACCOUNT` - same service account JSON used by `worker-payments`
   - `BALLDONTLIE_API_KEY` - sign up free at balldontlie.io; without this the
     NBA daily baseline refresh (ppg/rpg/apg) fails with 401 and does nothing
3. `npm run dev` to run locally, `npm run deploy` to ship it, then:
   ```
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
   npx wrangler secret put BALLDONTLIE_API_KEY
   ```

## What it does

- **Every ~15 min** (`[triggers]` in `wrangler.toml`): runs all four leagues'
  game-day ticks - fetches today's scoreboard/schedule, pulls box scores for
  any live/final games, matches players by normalized name against each
  league's `data/*-raw.json`, runs them through the ported engine
  (`src/engine.js`), and batch-persists the result. Finalized games lock in a
  daily close with the same ±15%-vs-prior-close cap the client uses.
  - NBA: ESPN scoreboard/summary (`src/espn.js`)
  - MLB: official MLB Stats API, no CORS proxy needed server-side (`src/mlb.js`)
  - Golf: ESPN scoreboard, with persisted cumulative-to-par history since
    ESPN never gives a raw "today's round" number (`src/golf.js`) - see that
    file's header comment for a known limitation carried over from the
    client (closes only lock in when the whole event completes, not per-round)
  - NFL: ESPN scoreboard/summary + fantasy-point synthesis (`src/nfl.js`) -
    this port added a `finalize()` call the client's own `nflTick()` never
    had; see that function's comment
- **Once/day** (~6-7am ET, DST-approximate): re-pulls balldontlie NBA season
  averages and MLB Stats API season stats to refresh each league's
  performance-expectation baseline (ppg/rpg/apg for NBA; avg/hr/rbi/ops or
  era/kper9/ipp for MLB). `statPrice` (the fundamental $ anchor) intentionally
  stays frozen at initial load, matching client behavior. Golf/NFL have no
  daily refresh in the client either, so none was added here.
- Dates use a hardcoded `America/New_York` boundary (`src/index.js`'s
  `easternDateStr`) - a Worker has no "local" timezone, so this can't use the
  client's device-clock approach.
- All Firestore access is batched (`firestoreBatchGetDocs`/
  `firestoreBatchWriteDocs` in `src/lib/firestore.js`) - one request per
  league per tick instead of one per player. This isn't an optimization, it's
  required: processing a full slate with one GET+PATCH per player exceeded
  Cloudflare's per-invocation subrequest limit in production (129 MLB players
  = 258 requests), even though it worked fine under `wrangler dev` locally.

## Manual endpoints (dev/testing only)

- `POST /internal/tick` - run one game-day cycle immediately, all 4 leagues
- `POST /internal/refresh-baselines` - run the daily refresh immediately (NBA + MLB)

Lock these down or remove them before this feeds a real, unattended
settlement pipeline.

## Verification notes

Engine math (`src/engine.js`) is unit-testable in isolation - construct a
player + stat line, call `price()`/`finalize()`, and compare against hand
calculation or the client's own displayed price for the same player/day. Do
this for any future formula changes before trusting them for real money.

Every league's parser and formula here was verified against **real** data
before being trusted, not synthetic fixtures:
- NBA: a real completed ESPN game's box score, sane price move for a real player
- MLB: real live games in production - Schwarber's `statPrice` matched
  `(ops*200 + hr*3 + rbi*0.8) * tier-multiplier` by hand exactly
- Golf: a real, already-completed tournament in production - 48 real
  rostered golfers correctly finalized with sane closes
- NFL: formulas unit-tested against constructed stat lines; verify against a
  real live/completed NFL game the same way before the season is in full swing

If you change any parser (label indices, name normalization, category names),
re-verify against a real API response before trusting it again - ESPN/MLB's
exact response shape is not something to assume stays stable.
