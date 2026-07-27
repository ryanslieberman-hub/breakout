# worker-payments

Cloudflare Worker backing Breakout's real-money Weekly Challenges: entry-fee
checkout, Stripe Connect payout onboarding, and hourly settlement.

## Setup

1. `npm install`
2. `cp .dev.vars.example .dev.vars` and fill in real values:
   - `STRIPE_SECRET_KEY` - from the Stripe Dashboard (test mode first: `sk_test_...`)
   - `STRIPE_WEBHOOK_SECRET` - created in step 4 below (`whsec_...`)
   - `FIREBASE_SERVICE_ACCOUNT` - Firebase Console > Project Settings > Service
     Accounts > Generate new private key, pasted as one JSON line
3. Edit `wrangler.toml`'s `[vars]` block: `FIREBASE_PROJECT_ID`, `ALLOWED_ORIGIN`
   (your app's origin, for CORS), `CHECKOUT_SUCCESS_URL`, `CHECKOUT_CANCEL_URL`.
4. Stripe Dashboard > Developers > Webhooks > Add endpoint, pointing at
   `https://<your-worker>.workers.dev/webhooks/stripe`, subscribed to
   `checkout.session.completed`. Copy its signing secret into `.dev.vars`
   (local) and as a deployed secret (step 6).
5. Local dev: `npm run dev` (runs `wrangler dev`, reads `.dev.vars`).
   Forward Stripe webhooks to it with the Stripe CLI:
   `stripe listen --forward-to localhost:8787/webhooks/stripe`
6. Deploy: `npm run deploy`, then set the real secrets on Cloudflare (these
   are encrypted at rest and never touch source):
   ```
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
   ```

## Required Firestore contract: challengeSnapshots

Settlement never trusts client-writable fields. For each challenge, once it
ends, something trustworthy needs to have written:

```
challengeSnapshots/{challengeId}/entries/{uid}  { uid, portfolioValue, returnPct }
```

...for every participant, computed from authoritative server-side data (not
the browser's self-reported `users/{uid}.portfolioValue`). If you already
have an hourly snapshot job elsewhere, extend it to also write this
challenge-scoped, tamper-proof copy when a challenge is active. If a
challenge has no snapshots by the time it ends, the sweep logs an error and
leaves it unsettled rather than guessing - check the Worker logs
(`npx wrangler tail`) if a challenge isn't settling.

## Endpoints

- `POST /challenges/:id/checkout` - `Authorization: Bearer <Firebase ID token>` -> `{ url }` Stripe Checkout URL
- `POST /webhooks/stripe` - Stripe-only, verified via signing secret
- `POST /connect/onboard` - `Authorization: Bearer <Firebase ID token>` -> `{ url }` Stripe onboarding URL
- `GET /connect/status` - `Authorization: Bearer <Firebase ID token>` -> `{ connected, payoutsEnabled, chargesEnabled }`
- `POST /internal/run-settlement` - manually triggers the settlement sweep (for local/dev testing only - lock this down or remove it before handling real money)

## Testing before real money touches this

1. `npm run dev` + `stripe listen --forward-to localhost:8787/webhooks/stripe`
2. Create a test challenge in the app, enter it with two different test
   accounts via test-mode Checkout (card `4242 4242 4242 4242`, any future
   expiry/CVC).
3. Manually write `challengeSnapshots/{challengeId}/entries/{uid}` docs for
   both test users (or point your snapshot job at test data), with different
   `returnPct` values.
4. Set the challenge's `endDate` to the past (directly in Firestore).
5. `POST /internal/run-settlement` and confirm: correct transfer amounts
   (50/30/20 of the pool minus the platform fee) land on the right test
   Connect accounts, `challenges/{id}.settled` becomes `true`, and running
   it again is a no-op (idempotency - Stripe's Idempotency-Key prevents a
   duplicate transfer even if you re-trigger the sweep).
