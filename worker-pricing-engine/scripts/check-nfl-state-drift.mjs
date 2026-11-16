// Read-only: compares each NFL player's stored priceEngine state (statPrice,
// tier, latest closes) and config/prices closes against what the current
// roster data says the player is worth. Written 2026-11-16 after Joe Burrow,
// Ja'Marr Chase and Chase Brown showed no movement after a game: their
// mirrored closes had been written at a fraction of their real price.
//
// Usage: node scripts/check-nfl-state-drift.mjs [--all]
//   Default prints only players that look wrong; --all prints everyone.

import { readFileSync } from 'node:fs';
import { nflStatPrice } from '../src/engine.js';
import { firestoreBatchGetDocs, firestoreGetDoc } from '../src/lib/firestore.js';

const ALL = process.argv.includes('--all');
const nflRaw = JSON.parse(readFileSync(new URL('../data/nfl-raw.json', import.meta.url)));
const saText = readFileSync(new URL('../../worker-payments/service-account-key.json', import.meta.url), 'utf8');
const env = { FIREBASE_SERVICE_ACCOUNT: saText, FIREBASE_PROJECT_ID: JSON.parse(saText).project_id };

const paths = nflRaw.map(p => `priceEngine/nfl_${p.rank}`);
const docs = {};
for (let i = 0; i < paths.length; i += 100) Object.assign(docs, await firestoreBatchGetDocs(env, paths.slice(i, i + 100)));
const cfg = (await firestoreGetDoc(env, 'config/prices')) || {};

let bad = 0;
for (const p of nflRaw) {
  const want = nflStatPrice(p);
  const st = docs[`priceEngine/nfl_${p.rank}`];
  const cc = cfg.closes?.[String(p.rank)] || {};
  const lo = want * 0.55, hi = want * 1.70;
  const badCfg = Object.entries(cc).filter(([, v]) => !(v >= lo && v <= hi)).map(([d, v]) => `${d.slice(5)}:${(+v).toFixed(2)}`);
  const stOff = st && st.statPrice && Math.abs(st.statPrice - want) / want > 0.02;
  const stCloses = st?.closes ? Object.entries(st.closes).sort().slice(-2).map(([d, v]) => `${d.slice(5)}:${(+v).toFixed(2)}`).join(' ') : '-';
  const baseVal = st?.base ? JSON.stringify(st.base) : '-';
  if (!ALL && !stOff && !badCfg.length) continue;
  bad++;
  console.log(`${String(p.rank).padEnd(5)}${p.name.padEnd(24)} roster statPrice ${want.toFixed(2).padStart(8)} | stored ${st ? (+st.statPrice).toFixed(2) : '(none)'} tier ${st?.tier}/${p.tier} | engine closes ${stCloses} | base ${baseVal} | config out-of-range: ${badCfg.join(' ') || '-'} | liveP ${(+cfg.liveP?.[String(p.rank)] || 0).toFixed(2)}`);
}
console.log(`\n${bad} of ${nflRaw.length} players listed.`);
