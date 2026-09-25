// Companion to prune-stale-intraday.mjs: the age-based prune leaves recent
// (<30h old) synthetic intraday anchor points alone, but 11 NFL players who
// played 2026-09-24 still had a synthetic anchor point from the FIRST
// (buggy, wholesale-replace) backfill-nfl-closes.mjs run whose price no
// longer matches the corrected closes.2026-09-24 value written by the
// second, fixed run. Corrects those points' price to match the authoritative
// close for that date instead of leaving a stale value that 24H/Today
// calculations could read as a bogus recent move.
//
// Usage: node scripts/fix-intraday-mismatch.mjs [--apply]

import { readFileSync } from 'node:fs';
import { firestoreGetDoc, firestoreSetDeepFields } from '../src/lib/firestore.js';

const APPLY = process.argv.includes('--apply');

const sa = JSON.parse(readFileSync(new URL('../../worker-payments/service-account-key.json', import.meta.url)));
const env = { FIREBASE_PROJECT_ID: sa.project_id, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(sa) };
const nflRaw = JSON.parse(readFileSync(new URL('../data/nfl-raw.json', import.meta.url)));

const prices = await firestoreGetDoc(env, 'config/prices');
const entries = [];

for (const p of nflRaw) {
  const pts = prices.intraday?.[p.rank] || prices.intraday?.[String(p.rank)];
  const closes = prices.closes?.[p.rank] || prices.closes?.[String(p.rank)] || {};
  if (!pts || !pts.length) continue;
  let changed = false;
  const fixed = pts.map(pt => {
    const localDate = new Date(pt.t - 4 * 3600 * 1000).toISOString().slice(0, 10);
    const closeVal = closes[localDate];
    if (closeVal != null && Math.abs(closeVal - pt.price) > 0.02) {
      changed = true;
      console.log(`  #${p.rank} ${p.name}: intraday ${pt.price} -> ${closeVal} (${localDate})`);
      return { ...pt, price: closeVal };
    }
    return pt;
  });
  if (changed) entries.push({ segments: ['intraday', String(p.rank)], value: fixed });
}

console.log(`\n${entries.length} rank(s) with a mismatched point.`);
if (!APPLY) { console.log('Dry run only - pass --apply to write.'); process.exit(0); }
if (!entries.length) { console.log('Nothing to fix.'); process.exit(0); }

await firestoreSetDeepFields(env, 'config/prices', entries);
console.log('Applied.');
