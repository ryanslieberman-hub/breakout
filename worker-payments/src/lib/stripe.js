// Minimal Stripe REST client over fetch - deliberately not the stripe-node
// SDK, to avoid Node-API compatibility questions in the Workers runtime.
// Stripe's API takes application/x-www-form-urlencoded bodies with
// PHP-style bracket nesting for objects/arrays (e.g. metadata[uid]=abc).

const API_BASE = 'https://api.stripe.com/v1';

function flatten(obj, prefix, out) {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        const arrKey = `${paramKey}[${i}]`;
        if (v !== null && typeof v === 'object') flatten(v, arrKey, out);
        else out.push([arrKey, String(v)]);
      });
    } else if (typeof value === 'object') {
      flatten(value, paramKey, out);
    } else {
      out.push([paramKey, String(value)]);
    }
  }
  return out;
}

function encodeBody(params) {
  const pairs = flatten(params, '', []);
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

export function stripeClient(secretKey) {
  async function request(method, path, params, idempotencyKey) {
    const headers = {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: params ? encodeBody(params) : undefined,
    });
    const json = await res.json();
    if (!res.ok) {
      const msg = json?.error?.message || JSON.stringify(json);
      const err = new Error(`Stripe ${method} ${path} failed: ${msg}`);
      // Surface the HTTP status and Stripe's own error code so callers can tell
      // "this object doesn't exist on this account" (404 / resource_missing -
      // e.g. an ID stored under a different Stripe account or the other mode)
      // apart from a transient failure that should NOT be treated as missing.
      err.status = res.status;
      err.code = json?.error?.code || null;
      throw err;
    }
    return json;
  }

  return {
    createCheckoutSession: (params, idempotencyKey) =>
      request('POST', '/checkout/sessions', params, idempotencyKey),
    createConnectAccount: (params, idempotencyKey) =>
      request('POST', '/accounts', params, idempotencyKey),
    getAccount: (accountId) => request('GET', `/accounts/${accountId}`),
    createAccountLink: (params) => request('POST', '/account_links', params),
    createTransfer: (params, idempotencyKey) =>
      request('POST', '/transfers', params, idempotencyKey),
    createVerificationSession: (params, idempotencyKey) =>
      request('POST', '/identity/verification_sessions', params, idempotencyKey),
    getVerificationSession: (id) => request('GET', `/identity/verification_sessions/${id}`),
  };
}

// Verifies Stripe's webhook signature header without the SDK.
// header format: "t=<timestamp>,v1=<hex signature>[,v1=<hex signature>...]"
export async function verifyStripeWebhookSignature(payload, header, secret, toleranceSeconds = 300) {
  if (!header) throw new Error('Missing Stripe-Signature header');
  const parts = Object.fromEntries(
    header.split(',').map(p => {
      const [k, v] = p.split('=');
      return [k, v];
    })
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) throw new Error('Malformed Stripe-Signature header');

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > toleranceSeconds) throw new Error('Stripe webhook timestamp outside tolerance');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signedPayload = `${timestamp}.${payload}`;
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = [...new Uint8Array(sigBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');

  if (expected.length !== signature.length) throw new Error('Stripe webhook signature mismatch');
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (mismatch !== 0) throw new Error('Stripe webhook signature mismatch');
}
