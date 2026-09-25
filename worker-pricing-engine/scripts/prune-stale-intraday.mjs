// Emergency fix 2026-09-25: backfill-nfl-closes.mjs's buildIntradayFields
// injects a synthetic ~11pm intraday point for every date it backfills, and
// after re-running the script twice (once with the old wholesale-replace bug,
// once with the fix), some of those synthetic points went stale/orphaned -
// e.g. Kyle Pitts had a 09-24 synthetic intraday point at 28.39 while his
// actual closes.2026-09-24 had since been corrected to 26.40. Combined with
// weeks of never-pruned real intraday ticks (the client's own 30h prune is
// LOCAL/in-memory only - see smartTracker's _pruneCutoff comment - it never
// cleaned the SHARED Firestore copy), this left thousands of days-old
// intraday points sitting in config/prices.intraday, which the 24H/Today
// move calculations can pick up as a bogus "recent" reference (same bug
// class as several earlier fixes this repo already made for stale-log-point
// 24H readings - see f310d11/24e9172/e48209b/377e9a7 in git log).
//
// This restores the app's own documented invariant (intraday should only
// hold ~last 30h of real data) by pruning every rank's intraday array to
// points newer than 30h old, matching smartTracker's own _pruneCutoff. Only
// deletes; never invents or alters a value. Safe to re-run.
//
// Usage: node scripts/prune-stale-intraday.mjs [--apply] [nba|mlb|golf|nfl]

import { readFileSync } from 'node:fs';
import { firestoreGetDoc, firestoreSetDeepFields } from '../src/lib/firestore.js';

const APPLY = process.argv.includes('--apply');
const LEAGUE_ARG = process.argv.find(a => ['nba', 'mlb', 'golf', 'nfl'].includes(a));
const FILES = { nba: 'nba-raw.json', mlb: 'mlb-raw.json', golf: 'golf-raw.json', nfl: 'nfl-raw.json' };
const leagues = LEAGUE_ARG ? [LEAGUE_ARG] : Object.keys(FILES);

const sa = JSON.parse(readFileSync(new URL('../../worker-payments/service-account-key.json', import.meta.url)));
const env = { FIREBASE_PROJECT_ID: sa.project_id, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(sa) };

const CUTOFF = Date.now() - 30 * 3600 * 1000;

const prices = await firestoreGetDoc(env, 'config/prices');
const intraday = prices.intraday || {};

const entries = [];
let totalBefore = 0, totalAfter = 0, ranksTouched = 0;
for (const league of leagues) {
  const raw = JSON.parse(readFileSync(new URL(`../data/${FILES[league]}`, import.meta.url)));
  for (const p of raw) {
    const pts = intraday[p.rank] || intraday[String(p.rank)];
    if (!pts || !pts.length) continue;
    totalBefore += pts.length;
    const fresh = pts.filter(pt => pt.t >= CUTOFF);
    totalAfter += fresh.length;
    if (fresh.length !== pts.length) {
      ranksTouched++;
      entries.push({ segments: ['intraday', String(p.rank)], value: fresh });
    }
  }
}

console.log(`Leagues: ${leagues.join(', ')}`);
console.log(`Intraday points: ${totalBefore} -> ${totalAfter} (removing ${totalBefore - totalAfter} stale points across ${ranksTouched} ranks).`);

if (!APPLY) {
  console.log('\nDry run only - pass --apply to write.');
  process.exit(0);
}
if (!entries.length) { console.log('Nothing to prune.'); process.exit(0); }

await firestoreSetDeepFields(env, 'config/prices', entries);
console.log('Applied.');
