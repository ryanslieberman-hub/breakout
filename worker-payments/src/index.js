import { verifyFirebaseIdToken, bearerToken } from './lib/auth.js';
import {
  firestoreGetDoc,
  firestorePatchDoc,
  firestoreSetNestedField,
  firestoreQuery,
} from './lib/firestore.js';
import { stripeClient, verifyStripeWebhookSignature } from './lib/stripe.js';
import { replayTrades, portfolioValue, START_VALUE } from './lib/tradeReplay.js';

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

// "This id isn't valid on this Stripe account" - which is what every stored
// Stripe id looks like after switching Stripe accounts, or between test and
// live. Stripe reports it differently per resource type: 404/resource_missing
// for most objects, but 403/account_invalid for Connect accounts (verified
// against the real API - assuming 404 everywhere silently missed the Connect
// case). Anything NOT matching here is a transient/real error and must keep
// throwing, so a blip is never mistaken for "this object is gone".
function isUnknownStripeObject(e) {
  return e.status === 404 || e.code === 'resource_missing' || e.code === 'account_invalid';
}

// Mirrors US_STATES/RESTRICTED_STATES in index.html - kept in sync manually,
// same as leagueForRank's rank-range comment below. This is the server-side
// copy that actually gates entry (see handleIdentitySession); the client-side
// list is only used for the pre-verification UI hint.
const RESTRICTED_STATES = ['AZ', 'CT', 'DE', 'IA', 'LA', 'MT', 'WA'];

async function requireUser(request, env) {
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, 'Missing Authorization header');
  try {
    return await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
  } catch (e) {
    throw new HttpError(401, `Invalid ID token: ${e.message}`);
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ── POST /challenges/:id/checkout ──
async function handleCheckout(request, env, challengeId) {
  const user = await requireUser(request, env);
  const challenge = await firestoreGetDoc(env, `challenges/${challengeId}`);
  if (!challenge) throw new HttpError(404, 'Challenge not found');
  if (Date.now() > challenge.joinDeadline) throw new HttpError(400, 'Join deadline has passed');
  if (challenge.participants && challenge.participants[user.uid]) {
    throw new HttpError(400, 'Already entered this challenge');
  }
  const entryFee = Number(challenge.entryFee);
  if (!entryFee || entryFee <= 0) throw new HttpError(400, 'This challenge has no entry fee configured');

  const stripe = stripeClient(env.STRIPE_SECRET_KEY);
  const session = await stripe.createCheckoutSession(
    {
      mode: 'payment',
      client_reference_id: user.uid,
      metadata: { challengeId, uid: user.uid },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(entryFee * 100),
            product_data: { name: `Breakout Challenge: ${challenge.name}` },
          },
        },
      ],
      success_url: env.CHECKOUT_SUCCESS_URL,
      cancel_url: env.CHECKOUT_CANCEL_URL,
    },
    `checkout:${challengeId}:${user.uid}`
  );
  return json({ url: session.url }, 200, env);
}

// ── POST /webhooks/stripe ──
// No CORS / no user auth here - this is called server-to-server by Stripe,
// authenticated instead by the webhook signing secret.
async function handleStripeWebhook(request, env) {
  const payload = await request.text();
  const sigHeader = request.headers.get('Stripe-Signature');
  try {
    await verifyStripeWebhookSignature(payload, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    // Log loudly. A rejected webhook is otherwise completely invisible: this
    // path returns 400 without throwing, and `wrangler tail` prints "Ok" for
    // any request that didn't raise an exception - so a silently rejected
    // delivery looks IDENTICAL to a successful one while paid entries quietly
    // never get recorded. That is exactly how a $20 test payment went through
    // with no participant written and nothing to show for it in the logs.
    console.error(
      `Stripe webhook signature verification FAILED: ${e.message}. ` +
      `STRIPE_WEBHOOK_SECRET is probably not the signing secret of the endpoint that sent this event.`
    );
    return new Response(`Signature verification failed: ${e.message}`, { status: 400 });
  }

  const event = JSON.parse(payload);
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { challengeId, uid } = session.metadata || {};
    if (!challengeId || !uid) {
      console.error('checkout.session.completed missing challengeId/uid metadata', session.id);
      return new Response('ok', { status: 200 }); // ack anyway - not retryable
    }
    const challenge = await firestoreGetDoc(env, `challenges/${challengeId}`);
    if (challenge?.participants && challenge.participants[uid]) {
      // Already recorded (webhook retry) - idempotent no-op.
      return new Response('ok', { status: 200 });
    }
    await firestoreSetNestedField(env, `challenges/${challengeId}`, `participants.${uid}`, {
      uid,
      joinedAt: Date.now(),
      amountPaidCents: session.amount_total,
      stripeSessionId: session.id,
    });
  }
  if (event.type === 'identity.verification_session.verified') {
    const session = event.data.object;
    const uid = session.metadata?.uid;
    if (!uid) {
      console.error('identity.verification_session.verified missing uid metadata', session.id);
      return new Response('ok', { status: 200 }); // ack anyway - not retryable
    }
    // Re-fetch through the shared helper rather than trusting the event payload:
    // some API versions omit verified_outputs from the webhook body, and an
    // absent dob must never be read as "not an adult". Idempotent, so webhook
    // retries and the client's own polling can both land here harmlessly.
    await syncIdentitySession(env, uid, session.id);
  }
  return new Response('ok', { status: 200 });
}

// dob: { day, month, year } as returned by Stripe Identity's verified_outputs.
function isAdultDob(dob) {
  const today = new Date();
  const birthDate = new Date(Date.UTC(dob.year, dob.month - 1, dob.day));
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  const hadBirthdayThisYear =
    today.getUTCMonth() > birthDate.getUTCMonth() ||
    (today.getUTCMonth() === birthDate.getUTCMonth() && today.getUTCDate() >= birthDate.getUTCDate());
  if (!hadBirthdayThisYear) age--;
  return age >= 18;
}

// ── POST /connect/onboard ──
async function handleConnectOnboard(request, env) {
  const user = await requireUser(request, env);
  const stripe = stripeClient(env.STRIPE_SECRET_KEY);
  const userDoc = (await firestoreGetDoc(env, `users/${user.uid}`)) || {};

  let accountId = userDoc.stripeConnectId;
  if (accountId) {
    // Confirm the stored Connect account actually exists on THIS platform
    // account. A leftover id from a different Stripe account (or the other
    // mode) can never be onboarded or paid out to, and without this check
    // createAccountLink below would 404 forever - permanently stranding the
    // user with no way to reach onboarding.
    try {
      await stripe.getAccount(accountId);
    } catch (e) {
      if (isUnknownStripeObject(e)) {
        console.warn(`Connect account ${accountId} unknown on this Stripe account for ${user.uid} - re-creating.`);
        accountId = null;
      } else throw e;
    }
  }
  if (!accountId) {
    const account = await stripe.createConnectAccount(
      { type: 'express', capabilities: { transfers: { requested: true } } },
      `connect-acct:${user.uid}`
    );
    accountId = account.id;
    await firestorePatchDoc(env, `users/${user.uid}`, { stripeConnectId: accountId });
  }

  // Connect gets its own return/refresh URLs. It used to borrow the checkout
  // ones, so finishing payout onboarding dumped the user on "?challenge_paid=1"
  // as though they'd just bought something.
  const connectReturn = env.CONNECT_RETURN_URL || env.CHECKOUT_SUCCESS_URL;
  const link = await stripe.createAccountLink({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: connectReturn,
    return_url: connectReturn,
  });
  return json({ url: link.url }, 200, env);
}

// ── GET /connect/status ──
async function handleConnectStatus(request, env) {
  const user = await requireUser(request, env);
  const userDoc = (await firestoreGetDoc(env, `users/${user.uid}`)) || {};
  if (!userDoc.stripeConnectId) return json({ connected: false }, 200, env);

  const stripe = stripeClient(env.STRIPE_SECRET_KEY);
  let account;
  try {
    account = await stripe.getAccount(userDoc.stripeConnectId);
  } catch (e) {
    // Unknown to this platform account (left over from a different Stripe
    // account or mode) - report it as simply not connected so the UI offers
    // onboarding again rather than erroring out.
    if (isUnknownStripeObject(e)) return json({ connected: false }, 200, env);
    throw e;
  }
  return json(
    { connected: true, payoutsEnabled: !!account.payouts_enabled, chargesEnabled: !!account.charges_enabled },
    200,
    env
  );
}

// Reads the live state of a user's Stripe Identity session and mirrors any
// finished result into Firestore. This is what keeps the flow working when the
// webhook doesn't do its job - a missing event subscription, a delayed delivery,
// a failed retry - because the client can always ask Stripe (through us) what
// actually happened rather than waiting forever on a push that isn't coming.
async function syncIdentitySession(env, uid, sessionId) {
  const stripe = stripeClient(env.STRIPE_SECRET_KEY);
  let session;
  try {
    session = await stripe.getVerificationSession(sessionId);
  } catch (e) {
    // A stored session id that THIS Stripe account/mode doesn't know about -
    // left behind by switching Stripe accounts, or by moving between test and
    // live. Report it as unusable so the caller starts a fresh session instead
    // of 500ing and bricking the compliance gate for that user. Anything else
    // (network blip, auth failure, Stripe outage) must still throw: silently
    // treating those as "missing" would abandon a real in-flight verification.
    if (isUnknownStripeObject(e)) {
      console.warn(`Verification session ${sessionId} not found on this Stripe account for ${uid} - starting fresh.`);
      return { status: 'unusable' };
    }
    throw e;
  }

  if (session.status === 'verified') {
    let dob = session.verified_outputs?.dob;
    // dob is a sensitive verification result: Stripe refuses it to the standard
    // secret key regardless of expand, so it can ONLY arrive via a restricted
    // key holding "Access recent sensitive verification results". That key is
    // optional - without it age simply stays unknown rather than the whole
    // verification failing.
    if (!dob && env.STRIPE_IDENTITY_RESTRICTED_KEY) {
      try {
        const rk = stripeClient(env.STRIPE_IDENTITY_RESTRICTED_KEY);
        const sensitive = await rk.getVerificationSessionSensitive(sessionId);
        dob = sensitive.verified_outputs?.dob;
      } catch (e) {
        console.warn(`Could not read sensitive verified_outputs for ${sessionId}: ${e.message}`);
      }
    }
    // Tri-state on purpose: true / false / null.
    // A missing DOB means "we could not determine an age", NOT "this person is
    // under 18" - not every accepted document carries one (Stripe's test-mode
    // passport has no dob field at all). Collapsing the two told a 20-year-old
    // they were underage, which is both false and indistinguishable from a
    // real underage block. Unknown still doesn't grant entry; it just says so
    // honestly.
    const adult = dob ? isAdultDob(dob) : null;
    await firestorePatchDoc(env, `users/${uid}`, {
      identityVerified: true,
      identityVerifiedAt: Date.now(),
      identityVerifiedAdult: adult,
    });
    return { status: 'verified', adult };
  }
  if (session.status === 'processing') return { status: 'processing' };
  if (session.status === 'canceled') return { status: 'canceled' };

  // requires_input: either never started, or an attempt failed / was abandoned.
  // The session's own url stays valid, so this doubles as the "they closed the
  // tab early, let them pick it back up" path.
  return {
    status: 'requires_input',
    url: session.url || null,
    errorCode: session.last_error?.code || null,
    errorReason: session.last_error?.reason || null,
  };
}

// ── POST /identity/session ──
// Starts (or resumes) real, server-verified identity + location checks for a
// paid-challenge entry. Geolocation comes from Cloudflare's own edge network
// (request.cf), never from anything the client claims.
async function handleIdentitySession(request, env) {
  const user = await requireUser(request, env);
  const userDoc = (await firestoreGetDoc(env, `users/${user.uid}`)) || {};

  const geoCountry = request.cf?.country || null;
  const geoState = request.cf?.regionCode || null;
  await firestorePatchDoc(env, `users/${user.uid}`, {
    geoCountry, geoState, geoCheckedAt: Date.now(),
  });

  const restricted = geoCountry !== 'US' || RESTRICTED_STATES.includes(geoState);
  if (restricted) {
    return json({ blocked: true, reason: 'restricted_location', geoState, geoCountry }, 200, env);
  }

  // Short-circuit only on a fully settled pass. If identity is verified but age
  // is unknown or failed, fall through and re-read Stripe: that self-heals rows
  // written by the earlier bug (which stored false for "no DOB") and picks up a
  // DOB that a later, better document supplied.
  if (userDoc.identityVerified === true && userDoc.identityVerifiedAdult === true) {
    return json({ alreadyVerified: true, adult: true, geoState, geoCountry }, 200, env);
  }

  // Resume the existing session rather than stacking up new ones on every open
  // of the gate. This also self-heals a verification that already succeeded but
  // never made it into Firestore because the webhook didn't deliver.
  if (userDoc.stripeIdentitySessionId) {
    const s = await syncIdentitySession(env, user.uid, userDoc.stripeIdentitySessionId);
    if (s.status === 'verified') {
      return json({ alreadyVerified: true, adult: s.adult, geoState, geoCountry }, 200, env);
    }
    if (s.status === 'processing') {
      return json({ blocked: false, processing: true, geoState, geoCountry }, 200, env);
    }
    if (s.status === 'requires_input' && s.url) {
      return json({ blocked: false, url: s.url, errorCode: s.errorCode, errorReason: s.errorReason, geoState, geoCountry }, 200, env);
    }
    // canceled, unusable (unknown to this account), or no resumable url -
    // fall through and start a fresh session.
  }

  // No idempotency key here on purpose: a fixed per-uid key pins this to the
  // FIRST session created in Stripe's 24h idempotency window, so a canceled or
  // unusable session could never be replaced. Duplicate sessions are harmless
  // (Stripe bills verification attempts, not created sessions) and the resume
  // branch above means we only ever reach this when there's nothing to reuse.
  const stripe = stripeClient(env.STRIPE_SECRET_KEY);
  const session = await stripe.createVerificationSession({
    type: 'document',
    metadata: { uid: user.uid },
    options: { document: { require_matching_selfie: true } },
    return_url: env.IDENTITY_RETURN_URL,
  });
  await firestorePatchDoc(env, `users/${user.uid}`, { stripeIdentitySessionId: session.id });
  return json({ blocked: false, url: session.url, geoState, geoCountry }, 200, env);
}

// ── GET /internal/stripe-info ──
// ADMIN ONLY, read-only. Reports which Stripe account this Worker is actually
// talking to and whether that key is live. Exists because a mis-set credential
// is otherwise invisible until money moves: a wrong secret key looks identical
// to "no data yet", and a wrong webhook secret rejects every delivery while the
// logs read as healthy. Returns no secret values - only whether each is set.
async function handleStripeInfo(request, env) {
  const user = await requireUser(request, env);
  if (!user.admin) throw new HttpError(403, 'Admin only');

  const stripe = stripeClient(env.STRIPE_SECRET_KEY);
  const [account, balance] = await Promise.all([stripe.getOwnAccount(), stripe.getBalance()]);
  const sum = arr => (arr || []).reduce((n, x) => n + x.amount, 0);

  // Probe Identity and Connect separately. "Enabled on the account" and "usable
  // by this key" are different things, and Stripe reports the difference only
  // when you actually call the product - which is otherwise not discovered
  // until a user is standing in front of the verification screen.
  let identityProbe;
  try {
    await stripe.listVerificationSessions({ limit: 1 });
    identityProbe = { ok: true };
  } catch (e) {
    identityProbe = { ok: false, status: e.status, code: e.code, message: e.message };
  }
  let connectProbe;
  try {
    await stripe.listConnectAccounts({ limit: 1 });
    connectProbe = { ok: true };
  } catch (e) {
    connectProbe = { ok: false, status: e.status, code: e.code, message: e.message };
  }

  return json({
    identity: identityProbe,
    connect: connectProbe,
    accountId: account.id,
    livemode: balance.livemode === true,
    chargesEnabled: !!account.charges_enabled,
    payoutsEnabled: !!account.payouts_enabled,
    detailsSubmitted: !!account.details_submitted,
    availableCents: sum(balance.available),
    pendingCents: sum(balance.pending),
    // Presence only - never the values themselves.
    webhookSecretConfigured: !!env.STRIPE_WEBHOOK_SECRET,
    identityRestrictedKeyConfigured: !!env.STRIPE_IDENTITY_RESTRICTED_KEY,
  }, 200, env);
}

// ── GET /identity/status ──
// Polled by the client while the compliance gate is open. Deliberately creates
// nothing and re-checks no geo - it only reports where the existing verification
// stands, re-read from Stripe, so the UI can react to a real outcome (including
// a failed or abandoned attempt) instead of waiting on a webhook indefinitely.
async function handleIdentityStatus(request, env) {
  const user = await requireUser(request, env);
  const userDoc = (await firestoreGetDoc(env, `users/${user.uid}`)) || {};
  // Same reasoning as handleIdentitySession: only a confirmed adult short-
  // circuits; anything else re-reads Stripe so a stale/unknown age can correct
  // itself rather than being frozen in.
  if (userDoc.identityVerified === true && userDoc.identityVerifiedAdult === true) {
    return json({ status: 'verified', adult: true }, 200, env);
  }
  if (!userDoc.stripeIdentitySessionId) return json({ status: 'none' }, 200, env);
  const s = await syncIdentitySession(env, user.uid, userDoc.stripeIdentitySessionId);
  // A session this account can't see is, from the client's point of view, the
  // same as never having started one - POST /identity/session will mint a new.
  return json(s.status === 'unusable' ? { status: 'none' } : s, 200, env);
}

// ── Settlement sweep (Cron Trigger) ──
// Settles any challenge whose endDate has passed and isn't marked `settled`.
// Winner rankings come from replaying each participant's own `trades` log
// (never the client-writable portfolios/{uid} snapshot) valued against
// worker-pricing-engine's server-computed closes (never config/prices or
// users/{uid}.portfolioValue) - see tradeReplay.js and the plan addendum for
// why both of those matter.
const SPLITS = [0.5, 0.3, 0.2]; // top-3, 50/30/20

// Rank ranges match RAW/MLB_RAW/GOLF_RAW/NFL_RAW in index.html.
function leagueForRank(rank) {
  if (rank <= 1000) return 'nba';
  if (rank <= 2000) return 'mlb';
  if (rank <= 3000) return 'golf';
  return 'nfl';
}

function easternDateStr(timestampMs) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestampMs));
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Picks the closing price on or before `asOfDateStr` from a priceEngine
// closes map - never a future close relative to the challenge's own endDate.
function closeAsOf(closes, asOfDateStr) {
  const dates = Object.keys(closes || {}).filter(d => d <= asOfDateStr).sort();
  if (!dates.length) return null;
  return closes[dates[dates.length - 1]];
}

export async function runSettlementSweep(env) {
  const ended = await firestoreQuery(env, 'challenges', [
    { field: 'endDate', op: 'LESS_THAN', value: Date.now() },
  ]);
  // settlementBlocked = tried, can't be priced, already escalated for manual
  // review (see settleChallenge). Excluded so it stops consuming every sweep.
  const unsettled = ended.filter(c => c.settled !== true && c.settlementBlocked !== true);

  let settledCount = 0;
  for (const challenge of unsettled) {
    try {
      if (await settleChallenge(env, challenge)) settledCount++;
    } catch (e) {
      console.error(`Failed to settle challenge ${challenge.id}:`, e.message);
    }
  }
  return { checked: ended.length, attempted: unsettled.length, settled: settledCount };
}

// Returns true if the challenge was actually marked settled, false if it was
// safely skipped (missing trusted price data, non-NBA holdings, etc.) - the
// sweep will simply retry it next time.
async function settleChallenge(env, challenge) {
  const participants = challenge.participants || {};
  const participantUids = Object.keys(participants);
  if (participantUids.length === 0) {
    await firestorePatchDoc(env, `challenges/${challenge.id}`, { settled: true, settledAt: Date.now(), payouts: [] });
    return true;
  }

  const asOfDate = easternDateStr(challenge.endDate);
  const priceEngineDocCache = {}; // rank -> priceEngine doc (or null), fetched at most once per rank per sweep

  async function priceEngineDoc(rank) {
    if (rank in priceEngineDocCache) return priceEngineDocCache[rank];
    const league = leagueForRank(rank);
    const doc = await firestoreGetDoc(env, `priceEngine/${league}_${rank}`);
    priceEngineDocCache[rank] = doc;
    return doc;
  }

  async function trustedPrice(rank) {
    const doc = await priceEngineDoc(rank);
    return doc ? closeAsOf(doc.closes, asOfDate) : null;
  }

  // Used by replayTrades to reject any trade priced outside the legitimate
  // AMM band for its rank - see tradeReplay.js's PRICE_BAND. Without this, a
  // client could write a trades/{tradeId} doc directly (firestore.rules only
  // checks uid on create, not price) with a fabricated low price and have it
  // replay as an almost-free buy, then get the resulting holdings valued at
  // the real trustedPrice() below.
  async function getStatPrice(rank) {
    const doc = await priceEngineDoc(rank);
    return doc ? doc.statPrice ?? null : null;
  }

  // Score ONLY what happened inside the challenge window. `trades` is a
  // lifetime, append-only log, so replaying all of it ranks people on activity
  // from before the challenge existed - and since every replay restarts from a
  // single $100k, a long history inevitably overdraws and gets mass-rejected
  // (one user showed 11 "tampered" trades that were nothing of the sort).
  // The product promises "same $100K start for everyone, no carryover"; this
  // is what makes settlement actually mean it.
  const windowStart = challenge.joinDeadline || challenge.createdAt || 0;
  const windowEnd = challenge.endDate;

  const valuations = [];
  for (const uid of participantUids) {
    const allTrades = await firestoreQuery(env, 'trades', [{ field: 'uid', op: 'EQUAL', value: uid }]);
    const trades = allTrades.filter(t => t.ts >= windowStart && t.ts <= windowEnd);
    const { cash, holdings, rejected } = await replayTrades(trades, getStatPrice);
    if (rejected.length) {
      console.warn(`${rejected.length} rejected (invalid) in-window trade(s) for ${uid} in challenge ${challenge.id}`);
    }

    const heldRanks = Object.keys(holdings).map(Number);
    const priceByRank = {};
    for (const rank of heldRanks) {
      const price = await trustedPrice(rank);
      if (price == null) {
        // Long-dead challenges whose price data never materialised were retrying
        // every hour forever, burning a sweep and filling the logs with the same
        // six errors. Past a grace period the data isn't coming, so flag it and
        // stop. Deliberately NOT marked `settled` - that would make an unpaid
        // challenge indistinguishable from one that paid out correctly. This
        // needs a human, so it's recorded as needing one.
        const STALE_MS = 14 * 24 * 60 * 60 * 1000;
        const reason = `no trusted ${leagueForRank(rank)} price for rank ${rank} (held by ${uid}) as of ${asOfDate}`;
        if (Date.now() - challenge.endDate > STALE_MS) {
          await firestorePatchDoc(env, `challenges/${challenge.id}`, {
            settlementBlocked: true,
            settlementBlockedReason: reason,
            settlementBlockedAt: Date.now(),
          });
          console.error(
            `Challenge ${challenge.id} ended over 14 days ago and still cannot be priced (${reason}) - ` +
            `flagged settlementBlocked and will no longer be retried. Needs manual review.`
          );
          return false;
        }
        console.error(`Challenge ${challenge.id}: ${reason} - skipping automatic settlement, will retry next sweep.`);
        return false;
      }
      priceByRank[rank] = price;
    }

    const value = portfolioValue({ cash, holdings }, priceByRank);
    const returnPct = ((value - START_VALUE) / START_VALUE) * 100;
    valuations.push({ uid, value, returnPct });
  }

  const ranked = valuations.sort((a, b) => b.returnPct - a.returnPct);

  const entryFee = Number(challenge.entryFee) || 0;
  const potCents = Math.round(participantUids.length * entryFee * 100);
  const feeBps = Number(env.PLATFORM_FEE_BPS) || 0;
  const netPotCents = Math.round(potCents * (1 - feeBps / 10000));

  const stripe = stripeClient(env.STRIPE_SECRET_KEY);
  const payouts = [];
  const attemptNo = (Number(challenge.payoutAttempts) || 0) + 1;

  // Ask Stripe what has already been paid for this challenge, and use THAT as
  // the double-payment guard. A fixed idempotency key cannot do that job: Stripe
  // replays the stored response for a key for 24h *including failures*, so a
  // transfer that failed once (insufficient balance, a blip) would keep
  // replaying that same error on every retry and the winner could never be paid
  // until the key aged out. Proven live - a $9 payout stayed "failed" across
  // retries even with $49.55 available. Keying on the attempt number makes each
  // retry a real request; this lookup is what keeps it safe.
  const paidByUid = {};
  try {
    const existing = await stripe.listTransfers({ transfer_group: challenge.id, limit: 100 });
    for (const t of existing.data || []) {
      if (t.metadata?.uid) paidByUid[t.metadata.uid] = t;
    }
  } catch (e) {
    // Can't confirm what's already out the door - refuse to send anything
    // rather than risk paying a winner twice.
    console.error(`Challenge ${challenge.id}: could not list existing transfers (${e.message}) - skipping payouts this sweep.`);
    return false;
  }

  for (let i = 0; i < Math.min(SPLITS.length, ranked.length); i++) {
    const winner = ranked[i];
    const amountCents = Math.round(netPotCents * SPLITS[i]);
    if (amountCents <= 0) continue;

    const already = paidByUid[winner.uid];
    if (already) {
      console.log(`Challenge ${challenge.id}: ${winner.uid} already paid via ${already.id} - not resending.`);
      payouts.push({ uid: winner.uid, amountCents, returnPct: winner.returnPct, status: 'paid', transferId: already.id });
      continue;
    }

    const winnerDoc = await firestoreGetDoc(env, `users/${winner.uid}`);
    if (!winnerDoc?.stripeConnectId) {
      console.error(`Winner ${winner.uid} in challenge ${challenge.id} has no Connect account - cannot pay out automatically.`);
      payouts.push({ uid: winner.uid, amountCents, returnPct: winner.returnPct, status: 'failed_no_connect_account' });
      continue;
    }

    try {
      const transfer = await stripe.createTransfer(
        {
          amount: amountCents,
          currency: 'usd',
          destination: winnerDoc.stripeConnectId,
          // transfer_group + uid metadata are what the lookup above reads.
          transfer_group: challenge.id,
          metadata: { challengeId: challenge.id, uid: winner.uid },
        },
        `settlement:${challenge.id}:${winner.uid}:${attemptNo}`
      );
      payouts.push({ uid: winner.uid, amountCents, returnPct: winner.returnPct, status: 'paid', transferId: transfer.id });
    } catch (e) {
      console.error(`Transfer failed for ${winner.uid} in challenge ${challenge.id}:`, e.message);
      payouts.push({ uid: winner.uid, amountCents, returnPct: winner.returnPct, status: 'failed', error: e.message });
    }
  }

  // A failed transfer must NOT close the challenge. Marking it settled while a
  // payout errored means the winner is never paid and the sweep never looks at
  // it again - the failure just sits in a field nobody reads. Retrying is safe
  // because of the transfer_group lookup above, which skips anyone Stripe has
  // already paid.
  const failed = payouts.filter(p => p.status !== 'paid');
  const attempts = attemptNo;
  // ~3 days at the hourly sweep. Must comfortably exceed Stripe's payout
  // availability window: in live mode card funds sit in `pending` for about two
  // business days, so a challenge that settles right after its entry fees were
  // collected will legitimately fail "insufficient available funds" for a while.
  // At 24 (~1 day) those retries ran out before the money became available and
  // the challenge was flagged payoutsIncomplete for no real reason.
  const MAX_PAYOUT_ATTEMPTS = 72;

  if (failed.length && attempts < MAX_PAYOUT_ATTEMPTS) {
    await firestorePatchDoc(env, `challenges/${challenge.id}`, {
      potCents, netPotCents, payouts,
      payoutAttempts: attempts,
      lastPayoutAttemptAt: Date.now(),
      lastPayoutError: failed[0].error || failed[0].status,
    });
    console.error(
      `Challenge ${challenge.id}: ${failed.length} payout(s) failed (${failed[0].error || failed[0].status}) - ` +
      `leaving unsettled, will retry next sweep (attempt ${attempts}/${MAX_PAYOUT_ATTEMPTS}).`
    );
    return false;
  }

  await firestorePatchDoc(env, `challenges/${challenge.id}`, {
    settled: true,
    settledAt: Date.now(),
    potCents,
    netPotCents,
    payouts,
    payoutAttempts: attempts,
    // Exhausted retries with something still unpaid: stop looping, but flag it
    // loudly rather than letting `settled` imply everyone got their money.
    ...(failed.length ? { payoutsIncomplete: true, lastPayoutError: failed[0].error || failed[0].status } : {}),
  });
  if (failed.length) {
    console.error(
      `Challenge ${challenge.id}: giving up after ${attempts} attempts with ${failed.length} unpaid payout(s) - ` +
      `flagged payoutsIncomplete, needs manual review.`
    );
  }
  return true;
}

// ── Router ──
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env) });

    try {
      if (request.method === 'POST' && /^\/challenges\/[^/]+\/checkout$/.test(url.pathname)) {
        const challengeId = url.pathname.split('/')[2];
        return await handleCheckout(request, env, challengeId);
      }
      if (request.method === 'POST' && url.pathname === '/webhooks/stripe') {
        return await handleStripeWebhook(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/connect/onboard') {
        return await handleConnectOnboard(request, env);
      }
      if (request.method === 'GET' && url.pathname === '/connect/status') {
        return await handleConnectStatus(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/identity/session') {
        return await handleIdentitySession(request, env);
      }
      if (request.method === 'GET' && url.pathname === '/identity/status') {
        return await handleIdentityStatus(request, env);
      }
      if (request.method === 'GET' && url.pathname === '/internal/stripe-info') {
        return await handleStripeInfo(request, env);
      }
      // Manual trigger for the settlement sweep. ADMIN ONLY: this moves real
      // money (it creates Stripe transfers), so it must never be reachable by
      // anyone who merely knows the URL - it was previously wide open.
      if (request.method === 'POST' && url.pathname === '/internal/run-settlement') {
        const user = await requireUser(request, env);
        if (!user.admin) throw new HttpError(403, 'Admin only');
        return json(await runSettlementSweep(env), 200, env);
      }
      return json({ error: 'Not found' }, 404, env);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return json({ error: e.message }, status, env);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSettlementSweep(env));
  },
};
