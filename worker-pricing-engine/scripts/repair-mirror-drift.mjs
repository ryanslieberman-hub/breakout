// One-shot repair for the config/prices mirror-drift bug (see
// clampMirrorClose in src/index.js and reference_breakout_pricing_split
// memory). The 2026-09-14 tickMlb/tickNfl "mirror finalized closes into
// config/prices" fix clamped the mirrored value only to the wide
// statPrice*[0.56,1.68] band, not to config/prices's OWN prior close - so any
// rank whose priceEngine/* history had quietly drifted from the client-facing
// config/prices history teleported by however much the two tracks had
// diverged, instead of moving a realistic ±15%/day. This script finds every
// rank whose MOST RECENT config/prices close moved >15% from its own prior
// close, caps it back to a realistic ±15% move (matching what finalize()
// should have produced), and fixes liveP to match (mirroring finalize()'s own
// "keep live price consistent with the capped close" step).
//
// Read-only by default. Pass --apply to actually write the corrections.
// Usage: node scripts/repair-mirror-drift.mjs [--apply]

import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';
import { mlbStatPrice, nflStatPrice } from '../src/engine.js';

const APPLY = process.argv.includes('--apply');

const mlbRaw = JSON.parse(readFileSync(new URL('../data/mlb-raw.json', import.meta.url)))
  .map(p => ({ ...p, statPrice: mlbStatPrice(p) }));
const nflRaw = JSON.parse(readFileSync(new URL('../data/nfl-raw.json', import.meta.url)))
  .map(p => ({ ...p, statPrice: nflStatPrice(p) }));
const byRank = {};
for (const p of [...mlbRaw, ...nflRaw]) byRank[p.rank] = p;

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
  return null;
}

const token = await accessToken();
const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
const res = await fetch(`${base}/config/prices`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) throw new Error(`Firestore read failed: ${await res.text()}`);
const json = await res.json();
const closes = fromV(json.fields.closes) || {};
const liveP = fromV(json.fields.liveP) || {};

const fixes = [];
for (const [rank, c] of Object.entries(closes)) {
  const p = byRank[Number(rank)];
  if (!p || !c || typeof c !== 'object') continue;
  const dates = Object.keys(c).filter(d => c[d] > 0).sort();
  if (dates.length < 2) continue;
  const lastDate = dates[dates.length - 1];
  const prevDate = dates[dates.length - 2];
  const prev = c[prevDate], last = c[lastDate];
  const maxUp = prev * 1.15, maxDown = prev * 0.85;
  if (last > maxUp || last < maxDown) {
    const capped = Math.min(maxUp, Math.max(maxDown, last));
    fixes.push({
      rank: Number(rank), name: p.name, date: lastDate, prevDate, prev,
      bad: last, capped, pctBad: ((last - prev) / prev * 100).toFixed(1),
      pctCapped: ((capped - prev) / prev * 100).toFixed(1),
      liveP: liveP[rank],
    });
  }
}

fixes.sort((a, b) => Math.abs(b.pctBad) - Math.abs(a.pctBad));
console.log(`Found ${fixes.length} rank(s) with a >15%/day mirror-drift jump on their most recent close:\n`);
for (const f of fixes) {
  console.log(`  #${f.rank} ${f.name.padEnd(24)} ${f.prevDate}=${f.prev.toFixed(2)} -> ${f.date}=${f.bad.toFixed(2)} (${f.pctBad}%)  =>  capped ${f.capped.toFixed(2)} (${f.pctCapped}%)  [liveP was ${f.liveP?.toFixed?.(2)}]`);
}

if (!APPLY) {
  console.log(`\nDry run only - pass --apply to write these ${fixes.length} correction(s) to config/prices.`);
  process.exit(0);
}

const { firestoreSetDeepFields } = await import('../src/lib/firestore.js');
const env = { FIREBASE_PROJECT_ID: sa.project_id, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(sa) };
const entries = [];
for (const f of fixes) {
  entries.push({ segments: ['closes', String(f.rank), f.date], value: Math.round(f.capped * 100) / 100 });
  // Only fix liveP if it still matches the bad close (a live game since then may have moved it further - don't clobber that).
  if (f.liveP != null && Math.abs(f.liveP - f.bad) < 0.01) {
    entries.push({ segments: ['liveP', String(f.rank)], value: Math.round(f.capped * 100) / 100 });
  }
}
await firestoreSetDeepFields(env, 'config/prices', entries);
console.log(`\nApplied ${fixes.length} correction(s) to config/prices.`);
