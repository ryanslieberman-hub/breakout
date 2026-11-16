// Repairs NFL players whose priceEngine doc carried a statPrice/tier from an
// old price scale (see check-nfl-state-drift.mjs and the "re-based" block in
// src/index.js's tickNflDay). For each such player:
//   1. config/prices closes that fall outside the client's validity band
//      (statPrice * [0.55, 1.70]) are re-derived, oldest first, from the last
//      in-band close and that date's real box score - the same formula
//      tickNfl's mirrorClose uses (prior * (1 + nflPerf), +/-15% a day, band).
//   2. config/prices liveP is set to the newest repaired close.
//   3. The priceEngine doc gets the roster's statPrice/tier/fpts and the
//      repaired close history, with base cleared.
// Only the affected ranks and dates are written, each by its own field path.
//
// Usage: node scripts/repair-nfl-state-drift.mjs [--apply]

import { readFileSync } from 'node:fs';
import { statPriceFor, nflPerf } from '../src/engine.js';
import * as nfl from '../src/nfl.js';
import { firestoreBatchGetDocs, firestoreBatchWriteDocs, firestoreGetDoc, firestoreSetDeepFields } from '../src/lib/firestore.js';

const APPLY = process.argv.includes('--apply');
const raw = JSON.parse(readFileSync(new URL('../data/nfl-raw.json', import.meta.url)));
const saText = readFileSync(new URL('../../worker-payments/service-account-key.json', import.meta.url), 'utf8');
const env = { FIREBASE_SERVICE_ACCOUNT: saText, FIREBASE_PROJECT_ID: JSON.parse(saText).project_id };
const byName = {};
for (const p of raw) byName[nfl.normalizeName(p.name)] = p;

const paths = raw.map(p => `priceEngine/nfl_${p.rank}`);
const docs = {};
for (let i = 0; i < paths.length; i += 100) Object.assign(docs, await firestoreBatchGetDocs(env, paths.slice(i, i + 100)));
const cfg = await firestoreGetDoc(env, 'config/prices');

const drifted = raw.filter(p => {
  const st = docs[`priceEngine/nfl_${p.rank}`];
  const want = statPriceFor('nfl', p);
  return st && st.statPrice && (Math.abs(st.statPrice - want) / want > 0.02 || st.tier !== p.tier);
});
console.log(`${drifted.length} player(s) with a stored scale that disagrees with the roster: ${drifted.map(p => p.name).join(', ')}`);
if (!drifted.length) process.exit(0);

// Box scores for every date that needs re-deriving.
const badDates = new Set();
for (const p of drifted) {
  const want = statPriceFor('nfl', p), cc = cfg.closes?.[String(p.rank)] || {};
  for (const [d, v] of Object.entries(cc)) if (!(v >= want * 0.55 && v <= want * 1.70)) badDates.add(d);
}
const fptsByDate = {};
for (const date of [...badDates].sort()) {
  const sb = await nfl.fetchScoreboard(date.replaceAll('-', ''));
  const out = {};
  for (const ev of (sb.events || []).filter(e => e.status?.type?.completed)) {
    for (const [name, v] of Object.entries(nfl.extractNflFantasyPoints(await nfl.fetchSummary(ev.id)))) {
      const p = byName[name];
      if (p) out[p.rank] = (out[p.rank] || 0) + v;
    }
  }
  fptsByDate[date] = out;
}

const cfgWrites = [], engineWrites = [];
for (const p of drifted) {
  const want = statPriceFor('nfl', p), lo = want * 0.55, hi = want * 1.70;
  const cc = { ...(cfg.closes?.[String(p.rank)] || {}) };
  console.log(`\n#${p.rank} ${p.name}  roster statPrice ${want.toFixed(2)} (stored ${(+docs[`priceEngine/nfl_${p.rank}`].statPrice).toFixed(2)})`);
  for (const date of Object.keys(cc).sort()) {
    if (cc[date] >= lo && cc[date] <= hi) continue;
    const priorDates = Object.keys(cc).filter(d => d < date && cc[d] >= lo && cc[d] <= hi).sort();
    const prev = priorDates.length ? cc[priorDates[priorDates.length - 1]] : want;
    const fpts = fptsByDate[date]?.[p.rank];
    let val = prev; // no box score that day: hold flat rather than invent a move
    if (fpts != null) {
      const perf = nflPerf({ rank: p.rank, tier: p.tier, fpts: p.fpts, statPrice: want }, { fpts, gameFrac: 1 });
      val = Math.min(prev * 1.15, Math.max(prev * 0.85, prev * (1 + perf)));
    }
    val = Math.round(Math.min(want * 1.68, Math.max(want * 0.56, val)) * 100) / 100;
    console.log(`   ${date}: ${(+cc[date]).toFixed(2)} -> ${val.toFixed(2)}  (${fpts != null ? `game ${fpts.toFixed(1)} pts vs ${p.fpts} expected` : 'no box score'}, ${((val / prev - 1) * 100).toFixed(1)}% vs ${prev.toFixed(2)})`);
    cc[date] = val;
    cfgWrites.push({ segments: ['closes', String(p.rank), date], value: val });
  }
  const dates = Object.keys(cc).sort();
  const latest = dates.length ? cc[dates[dates.length - 1]] : want;
  if (Math.abs((cfg.liveP?.[String(p.rank)] || 0) - latest) > 0.005) {
    console.log(`   liveP: ${(+cfg.liveP?.[String(p.rank)] || 0).toFixed(2)} -> ${latest.toFixed(2)}`);
    cfgWrites.push({ segments: ['liveP', String(p.rank)], value: latest });
  }
  engineWrites.push({ path: `priceEngine/nfl_${p.rank}`, fields: { tier: p.tier, statPrice: want, fpts: p.fpts, closes: cc, base: null } });
}

console.log(`\n${cfgWrites.length} config/prices field(s) and ${engineWrites.length} priceEngine doc(s) to write.`);
if (!APPLY) { console.log('Dry run - pass --apply to write.'); process.exit(0); }
await firestoreSetDeepFields(env, 'config/prices', cfgWrites);
await firestoreBatchWriteDocs(env, engineWrites);
console.log('Written.');
