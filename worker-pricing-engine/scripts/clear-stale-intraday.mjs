// One-shot repair for config/prices.intraday - the client's rolling 24h
// price-history log (see index.html's _logPricePoint / get24hPct). It's
// synced to Firestore so every device sees a consistent 24H window, but a
// bug (fixed 2026-09-16) let it log a price point on every idle recompute,
// not just real game events - so a data correction (e.g. the mirror-drift
// repair from earlier the same day) got recorded as a phantom "the price
// jumped 20% in the last 24h" entry, and every device that synced afterward
// inherited it via loadPricesFromFirestore's wholesale-replace restore.
//
// intraday is a pure rolling cache with zero historical value (closes/
// priceHx are the real history) - the safe fix is just wiping it. Every
// client's next tick with a real game event repopulates it fresh under the
// now-fixed logging rule, and until then get24hPct's calendar-day fallback
// covers the gap.
//
// Read-only by default. Pass --apply to actually write.
// Usage: node scripts/clear-stale-intraday.mjs [--apply]

import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';

const APPLY = process.argv.includes('--apply');

const sa = JSON.parse(readFileSync(new URL('../../worker-payments/service-account-key.json', import.meta.url)));
async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(sa.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
    .setProtectedHeader({ alg: 'RS256' }).setIssuer(sa.client_email).setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  return (await res.json()).access_token;
}
function fromV(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('mapValue' in v) { const o = {}; for (const [k, vv] of Object.entries(v.mapValue.fields || {})) o[k] = fromV(vv); return o; }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromV);
  return null;
}

const token = await accessToken();
const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
const res = await fetch(`${base}/config/prices`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) throw new Error(`Firestore read failed: ${await res.text()}`);
const json = await res.json();
const intraday = fromV(json.fields.intraday) || {};
const rankCount = Object.keys(intraday).length;
const pointCount = Object.values(intraday).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);

console.log(`config/prices.intraday currently holds ${rankCount} rank(s), ${pointCount} total point(s).`);

if (!APPLY) {
  console.log('\nDry run only - pass --apply to wipe this field.');
  process.exit(0);
}

const patchRes = await fetch(`${base}/config/prices?updateMask.fieldPaths=intraday`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { intraday: { mapValue: { fields: {} } } } }),
});
if (!patchRes.ok) throw new Error(`Firestore patch failed: ${await patchRes.text()}`);
console.log('\nWiped config/prices.intraday.');
