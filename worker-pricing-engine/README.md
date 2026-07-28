# worker-pricing-engine

Server-side, tamper-proof port of Breakout's NBA pricing engine (index.html's
`const ENGINE = (() => {...})()`). Exists so real-money challenge settlement
in `worker-payments` never has to trust anything a client can write - prices
are independently recomputed from real ESPN/balldontlie data and stored in
Firestore's `priceEngine/nba_{rank}` docs, which `firestore.rules` locks to
server-only writes.

**NBA only for now.** MLB/NFL/Golf need their own port following the same
pattern - see the plan file for the full formula reference per league.

## Setup

1. `npm install`
2. `cp .dev.vars.example .dev.vars` and fill in:
   - `FIREBASE_SERVICE_ACCOUNT` - same service account JSON used by `worker-payments`
   - `BALLDONTLIE_API_KEY` - sign up free at balldontlie.io; without this the
     daily baseline refresh (ppg/rpg/apg) fails with 401 and does nothing
3. `npm run dev` to run locally, `npm run deploy` to ship it, then:
   ```
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
   npx wrangler secret put BALLDONTLIE_API_KEY
   ```

## What it does

- **Every ~15 min** (`[triggers]` in `wrangler.toml`): fetches today's NBA
  scoreboard, pulls box scores for any live/final games, matches players by
  normalized display name against `data/nba-raw.json`, runs each through the
  ported engine (`src/engine.js`), and persists the result. Finalized (final
  status) games lock in a daily close with the same ±15%-vs-prior-close cap
  the client uses.
- **Once/day** (~6-7am ET, DST-approximate): re-pulls balldontlie season
  averages to refresh ppg/rpg/apg - `statPrice` (the fundamental $ anchor)
  intentionally stays frozen, matching current client behavior.
- Dates use a hardcoded `America/New_York` boundary (`src/index.js`'s
  `easternDateStr`) - a Worker has no "local" timezone, so this can't use the
  client's device-clock approach.

## Manual endpoints (dev/testing only)

- `POST /internal/tick` - run one game-day cycle immediately
- `POST /internal/refresh-baselines` - run the daily refresh immediately

Lock these down or remove them before this feeds a real, unattended
settlement pipeline.

## Verification notes

Engine math (`src/engine.js`) is unit-testable in isolation - construct a
player + stat line, call `price()`/`finalize()`, and compare against hand
calculation or the client's own displayed price for the same player/day.
`src/espn.js`'s box-score parser was verified against a real completed ESPN
game (not synthetic data) before this was trusted - do the same for any
future changes to the parsing logic.
