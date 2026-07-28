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

  const link = await stripe.createAccountLink({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: env.CHECKOUT_CANCEL_URL,
    return_url: env.CHECKOUT_SUCCESS_URL,
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
    const dob = session.verified_outputs?.dob;
    const adult = dob ? isAdultDob(dob) : false;
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

  if (userDoc.identityVerified === true) {
    return json({ alreadyVerified: true, adult: userDoc.identityVerifiedAdult === true, geoState, geoCountry }, 200, env);
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

// ── GET /identity/status ──
// Polled by the client while the compliance gate is open. Deliberately creates
// nothing and re-checks no geo - it only reports where the existing verification
// stands, re-read from Stripe, so the UI can react to a real outcome (including
// a failed or abandoned attempt) instead of waiting on a webhook indefinitely.
async function handleIdentityStatus(request, env) {
  const user = await requireUser(request, env);
  const userDoc = (await firestoreGetDoc(env, `users/${user.uid}`)) || {};
  if (userDoc.identityVerified === true) {
    return json({ status: 'verified', adult: userDoc.identityVerifiedAdult === true }, 200, env);
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
  const unsettled = ended.filter(c => c.settled !== true);

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
  const priceCache = {}; // rank -> trusted close, fetched at most once per rank per sweep

  async function trustedPrice(rank) {
    if (rank in priceCache) return priceCache[rank];
    const league = leagueForRank(rank);
    const doc = await firestoreGetDoc(env, `priceEngine/${league}_${rank}`);
    const val = doc ? closeAsOf(doc.closes, asOfDate) : null;
    priceCache[rank] = val;
    return val;
  }

  const valuations = [];
  for (const uid of participantUids) {
    const trades = await firestoreQuery(env, 'trades', [{ field: 'uid', op: 'EQUAL', value: uid }]);
    const { cash, holdings, rejected } = replayTrades(trades);
    if (rejected.length) {
      console.warn(`${rejected.length} rejected (tampered/invalid) trade(s) for ${uid} in challenge ${challenge.id}`);
    }

    const heldRanks = Object.keys(holdings).map(Number);
    const priceByRank = {};
    for (const rank of heldRanks) {
      const price = await trustedPrice(rank);
      if (price == null) {
        console.error(
          `Challenge ${challenge.id}: no trusted ${leagueForRank(rank)} price for rank ${rank} (held by ${uid}) ` +
          `as of ${asOfDate} - skipping automatic settlement, will retry next sweep.`
        );
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

  for (let i = 0; i < Math.min(SPLITS.length, ranked.length); i++) {
    const winner = ranked[i];
    const amountCents = Math.round(netPotCents * SPLITS[i]);
    if (amountCents <= 0) continue;

    const winnerDoc = await firestoreGetDoc(env, `users/${winner.uid}`);
    if (!winnerDoc?.stripeConnectId) {
      console.error(`Winner ${winner.uid} in challenge ${challenge.id} has no Connect account - cannot pay out automatically.`);
      payouts.push({ uid: winner.uid, amountCents, returnPct: winner.returnPct, status: 'failed_no_connect_account' });
      continue;
    }

    try {
      const transfer = await stripe.createTransfer(
        { amount: amountCents, currency: 'usd', destination: winnerDoc.stripeConnectId },
        `settlement:${challenge.id}:${winner.uid}`
      );
      payouts.push({ uid: winner.uid, amountCents, returnPct: winner.returnPct, status: 'paid', transferId: transfer.id });
    } catch (e) {
      console.error(`Transfer failed for ${winner.uid} in challenge ${challenge.id}:`, e.message);
      payouts.push({ uid: winner.uid, amountCents, returnPct: winner.returnPct, status: 'failed', error: e.message });
    }
  }

  await firestorePatchDoc(env, `challenges/${challenge.id}`, {
    settled: true,
    settledAt: Date.now(),
    potCents,
    netPotCents,
    payouts,
  });
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
      // Manual trigger for local/dev testing of the settlement sweep - remove
      // or protect further before going to production with real money.
      if (request.method === 'POST' && url.pathname === '/internal/run-settlement') {
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
