// One-off (2026-10-29): NBA repricing. Compresses the NBA tier multipliers
// (A .44->.60, B .10->.28, C .04->.14, D .018->.08; S unchanged) and moves a
// hand-picked list of players up a tier, then rescales every stored NBA price
// by newStatPrice/oldStatPrice so every chart keeps its exact shape (% moves
// unchanged) - only the dollar level changes. Holder share counts and
// totalCost are NOT touched (positions revalue by the same factor).
//
// Scales, per NBA rank: config/prices closes + liveP; priceEngine/nba_<rank>
// statPrice, tier, base.price, closes, recentValues[].value. todayHx is empty
// for NBA at write time and intraday has no NBA ranks (verified).
//
// Usage (from worker-pricing-engine/):
//   node scripts/reprice-nba.mjs            # dry run, prints table
//   node scripts/reprice-nba.mjs --apply    # write Firestore (deploy code + this together)
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { firestoreGetDoc, firestoreBatchGetDocs, firestoreBatchWriteDocs, getAccessToken, toFirestoreValue } from '../src/lib/firestore.js';
import { nbaStatPrice } from '../src/engine.js';

export const TIER_UP = {
  'Dylan Harper': 'A', 'Jalen Duren': 'B', 'Brandon Miller': 'B', 'Anthony Davis': 'A',
  'Tyrese Maxey': 'A', 'Kawhi Leonard': 'A', 'James Harden': 'A',
  'Caleb Wilson': 'B', 'Keaton Wagler': 'B', 'Mikel Brown': 'B', 'Darius Acuff': 'B', 'Kingston Flemings': 'B', 'Morez Johnson': 'B', 'Brayden Burries': 'B',
  'Alexandre Sarr': 'C', 'Jerami Grant': 'C', 'Grayson Allen': 'C',
};
const APPLY = process.argv.includes('--apply');
// --config-only: finish a run whose priceEngine batchWrite already landed (re-running that would double-scale).
// Old tiers then come from git HEAD's nba-raw.json (run BEFORE committing the new tiers).
const CONFIG_ONLY = process.argv.includes('--config-only');
const headTier = CONFIG_ONLY ? Object.fromEntries(JSON.parse(execSync('git show HEAD:worker-pricing-engine/data/nba-raw.json', { cwd: new URL('../..', import.meta.url), maxBuffer: 1 << 26 }).toString()).map(p => [p.rank, p.tier])) : null;
const sa = JSON.parse(readFileSync(new URL('../../worker-payments/service-account-key.json', import.meta.url)));
const env = { FIREBASE_PROJECT_ID: sa.project_id, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(sa) };
const raw = JSON.parse(readFileSync(new URL('../data/nba-raw.json', import.meta.url)));

// "Old" = pre-change multipliers + the tier still stored in priceEngine; "new" =
// engine.js with the TIER_UP tiers already applied in data/nba-raw.json.
const OLD_MULT = { S: 1.35, A: 0.44, B: 0.10, C: 0.04, D: 0.018 };
const prices = await firestoreGetDoc(env, 'config/prices');
const docPaths = raw.map(p => `priceEngine/nba_${p.rank}`);
const docs = await firestoreBatchGetDocs(env, docPaths);

const rows = [], plan = [];
for (const p of raw) {
  const doc = docs[`priceEngine/nba_${p.rank}`] || {};
  const oldT = headTier ? (headTier[p.rank] || p.tier) : (doc.tier || p.tier); // priceEngine still holds the pre-change tier
  const oldSP = (p.ppg * 10 + p.apg * 7 + p.rpg * 5) * OLD_MULT[oldT];
  const newSP = nbaStatPrice(p);
  const k = newSP / oldSP;
  rows.push({ rank: p.rank, name: p.name, oldT, newT: p.tier, oldSP, newSP, k });
  plan.push({ p, doc, k, newSP });
}
rows.sort((a, b) => b.newSP - a.newSP);
for (const r of rows.filter(r => TIER_UP[r.name] || r.rank % 15 === 0 || r.name === 'Nikola Jokic'))
  console.log(`#${r.rank} ${r.name.padEnd(24)} ${r.oldT}->${r.newT}  $${r.oldSP.toFixed(2)} -> $${r.newSP.toFixed(2)}  x${r.k.toFixed(2)}`);
const u10 = rows.filter(r => r.newSP < 10).length;
console.log(`\nplayers under $10: before ${rows.filter(r => r.oldSP < 10).length}, after ${u10}; min new $${Math.min(...rows.map(r => r.newSP)).toFixed(2)}`);

const mul = (obj, k) => Object.fromEntries(Object.entries(obj || {}).map(([d, v]) => [d, typeof v === 'number' ? +(v * k).toFixed(6) : v]));
const engineUpdates = [], cfgEntries = [];
for (const { p, doc, k, newSP } of plan) {
  if (!Object.keys(doc).length) continue;
  const f = { statPrice: +newSP.toFixed(4), tier: p.tier };
  if (doc.base?.price) f.base = { ...doc.base, price: doc.base.price * k };
  if (doc.closes) f.closes = mul(doc.closes, k);
  if (doc.recentValues) f.recentValues = doc.recentValues.map(rv => ({ ...rv, value: rv.value * k }));
  engineUpdates.push({ path: `priceEngine/nba_${p.rank}`, fields: f });
}
for (const { p, k } of plan) {
  const c = prices.closes?.[p.rank];
  if (c) for (const [d, v] of Object.entries(c)) cfgEntries.push({ segments: ['closes', String(p.rank), d], value: +(v * k).toFixed(6) });
  if (prices.liveP?.[p.rank] > 0) cfgEntries.push({ segments: ['liveP', String(p.rank)], value: +(prices.liveP[p.rank] * k).toFixed(6) });
}
console.log(`\nWould write ${engineUpdates.length} priceEngine docs and ${cfgEntries.length} config/prices fields.`);
if (!APPLY) { console.log('Dry run - pass --apply to write.'); process.exit(0); }

if (!CONFIG_ONLY) await firestoreBatchWriteDocs(env, engineUpdates);
const CHUNK = 60; // 400 field paths in the query string made Google answer 400
for (let i = 0; i < cfgEntries.length; i += CHUNK) {
  const slice = cfgEntries.slice(i, i + CHUNK);
  const rootFields = {}, fieldPaths = [];
  for (const { segments, value } of slice) {
    let cur = rootFields;
    segments.forEach((s, j) => {
      if (j === segments.length - 1) cur[s] = toFirestoreValue(value);
      else { cur[s] = cur[s] || { mapValue: { fields: {} } }; cur = cur[s].mapValue.fields; }
    });
    fieldPaths.push(segments.map(s => '`' + s + '`').join('.'));
  }
  const qs = fieldPaths.map(x => `updateMask.fieldPaths=${encodeURIComponent(x)}`).join('&');
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/config/prices?${qs}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${await getAccessToken(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: rootFields }),
  });
  if (!res.ok) throw new Error(await res.text());
  console.log(`config/prices chunk ${i / CHUNK + 1}: ${slice.length} fields`);
}
console.log('Applied.');
