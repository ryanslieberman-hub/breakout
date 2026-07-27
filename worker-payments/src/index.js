import { verifyFirebaseIdToken, bearerToken } from './lib/auth.js';
import {
  firestoreGetDoc,
  firestorePatchDoc,
  firestoreSetNestedField,
  firestoreQuery,
  firestoreListCollection,
} from './lib/firestore.js';
import { stripeClient, verifyStripeWebhookSignature } from './lib/stripe.js';

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
  return new Response('ok', { status: 200 });
}

// ── POST /connect/onboard ──
async function handleConnectOnboard(request, env) {
  const user = await requireUser(request, env);
  const stripe = stripeClient(env.STRIPE_SECRET_KEY);
  const userDoc = (await firestoreGetDoc(env, `users/${user.uid}`)) || {};

  let accountId = userDoc.stripeConnectId;
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
  const account = await stripe.getAccount(userDoc.stripeConnectId);
  return json(
    { connected: true, payoutsEnabled: !!account.payouts_enabled, chargesEnabled: !!account.charges_enabled },
    200,
    env
  );
}

// ── Settlement sweep (Cron Trigger) ──
// Settles any challenge whose endDate has passed and isn't marked `settled`.
// Reads winner rankings ONLY from challengeSnapshots (never from client-
// writable users/{uid} fields) - if a challenge has no snapshots yet, it is
// skipped with a logged error rather than guessed at.
const SPLITS = [0.5, 0.3, 0.2]; // top-3, 50/30/20

export async function runSettlementSweep(env) {
  const ended = await firestoreQuery(env, 'challenges', [
    { field: 'endDate', op: 'LESS_THAN', value: Date.now() },
  ]);
  const unsettled = ended.filter(c => c.settled !== true);

  for (const challenge of unsettled) {
    try {
      await settleChallenge(env, challenge);
    } catch (e) {
      console.error(`Failed to settle challenge ${challenge.id}:`, e.message);
    }
  }
  return { checked: ended.length, settled: unsettled.length };
}

async function settleChallenge(env, challenge) {
  const participants = challenge.participants || {};
  const participantUids = Object.keys(participants);
  if (participantUids.length === 0) {
    await firestorePatchDoc(env, `challenges/${challenge.id}`, { settled: true, settledAt: Date.now(), payouts: [] });
    return;
  }

  const snapshots = await firestoreListCollection(env, `challengeSnapshots/${challenge.id}/entries`);
  if (snapshots.length === 0) {
    console.error(`No trusted snapshots for challenge ${challenge.id} - skipping settlement, will retry next sweep.`);
    return;
  }

  const ranked = snapshots
    .filter(s => participantUids.includes(s.id))
    .sort((a, b) => (b.returnPct || 0) - (a.returnPct || 0));

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

    const winnerDoc = await firestoreGetDoc(env, `users/${winner.id}`);
    if (!winnerDoc?.stripeConnectId) {
      console.error(`Winner ${winner.id} in challenge ${challenge.id} has no Connect account - cannot pay out automatically.`);
      payouts.push({ uid: winner.id, amountCents, status: 'failed_no_connect_account' });
      continue;
    }

    try {
      const transfer = await stripe.createTransfer(
        { amount: amountCents, currency: 'usd', destination: winnerDoc.stripeConnectId },
        `settlement:${challenge.id}:${winner.id}`
      );
      payouts.push({ uid: winner.id, amountCents, status: 'paid', transferId: transfer.id });
    } catch (e) {
      console.error(`Transfer failed for ${winner.id} in challenge ${challenge.id}:`, e.message);
      payouts.push({ uid: winner.id, amountCents, status: 'failed', error: e.message });
    }
  }

  await firestorePatchDoc(env, `challenges/${challenge.id}`, {
    settled: true,
    settledAt: Date.now(),
    potCents,
    netPotCents,
    payouts,
  });
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
