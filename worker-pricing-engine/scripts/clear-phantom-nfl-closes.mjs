// One-shot repair: remove a bogus flat "2026-09-15" close that 133 NFL
// players have sitting in config/prices.closes. 2026-09-15 had ZERO
// completed NFL games (verified directly against ESPN's scoreboard), yet
// these 133 ranks each have EXACTLY ONE close entry, dated 2026-09-15, at a
// value identical to their statPrice (i.e. a flat/zero-move phantom, not a
// real game result). Root cause unclear (predates this script and wasn't
// written by backfill-nfl-closes.mjs - its own before/after rank-count was
// unchanged by the run that surfaced this) - not chasing it further, just
// clearing the bad data so the real close-history fix (backfill-nfl-closes.mjs)
// can do its job. Without this, that script would add a real 9/13 (or 9/10)
// close ALONGSIDE this bogus one rather than replacing it, and the phantom
// 2026-09-15 entry - being the chronologically LATEST date - would still win
// as "most recent close" and keep masking the real data.
//
// Deletes via dotted per-rank field paths (closes.<rank>.2026-09-15), never
// a wholesale rewrite of the closes map - see backfill-nfl-closes.mjs and
// index.html's syncPricesToFirestore fix (2026-09-14) for why that matters.
//
// Read-only by default. Pass --apply to actually write.
// Usage: node scripts/clear-phantom-nfl-closes.mjs [--apply]

import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';
import { nflStatPrice } from '../src/engine.js';

const APPLY = process.argv.includes('--apply');
const PHANTOM_DATE = '2026-09-15';

const nflRaw = JSON.parse(readFileSync(new URL('../data/nfl-raw.json', import.meta.url)))
  .map(p => ({ ...p, statPrice: nflStatPrice(p) }));
const byRank = {};
for (const p of nflRaw) byRank[p.rank] = p;

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

const phantoms = [];
for (const [rank, c] of Object.entries(closes)) {
  const r = Number(rank);
  const p = byRank[r];
  if (!p || !c || typeof c !== 'object') continue;
  const dates = Object.keys(c);
  const v = c[PHANTOM_DATE];
  if (v != null && dates.length === 1 && Math.abs(v - p.statPrice) < 0.005) {
    phantoms.push({ rank: r, name: p.name, value: v, statPrice: p.statPrice });
  }
}

console.log(`Found ${phantoms.length} rank(s) with a phantom flat ${PHANTOM_DATE} close as their ONLY close entry:\n`);
for (const ph of phantoms) {
  console.log(`  #${ph.rank} ${ph.name.padEnd(24)} ${PHANTOM_DATE}=${ph.value.toFixed(2)} (statPrice ${ph.statPrice.toFixed(2)})`);
}

if (!phantoms.length) { console.log('\nNothing to do.'); process.exit(0); }

if (!APPLY) {
  console.log(`\nDry run only - pass --apply to delete these ${phantoms.length} phantom entries from config/prices.closes.`);
  console.log('After --apply, re-run backfill-nfl-closes.mjs --write to populate their real Week 1 close.');
  process.exit(0);
}

// PATCH with updateMask naming each leaf but omitting it from the body ==
// delete that field. Chunked to stay well under request size limits.
const CHUNK = 100;
for (let i = 0; i < phantoms.length; i += CHUNK) {
  const chunk = phantoms.slice(i, i + CHUNK);
  const fieldPaths = chunk.map(ph => `closes.\`${ph.rank}\`.\`${PHANTOM_DATE}\``);
  const qs = fieldPaths.map(fp => `updateMask.fieldPaths=${encodeURIComponent(fp)}`).join('&');
  const patchRes = await fetch(`${base}/config/prices?${qs}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {} }),
  });
  if (!patchRes.ok) throw new Error(`patch failed (chunk ${i}): ${await patchRes.text()}`);
  console.log(`  deleted ${chunk.length} phantom entries (${Math.min(i + CHUNK, phantoms.length)}/${phantoms.length})`);
}
console.log(`\nDone. Deleted ${phantoms.length} phantom ${PHANTOM_DATE} close(s).`);
console.log('Now re-run: node scripts/backfill-nfl-closes.mjs --write');
