// Backfills NBA closes for games that went final after midnight ET and so
// were never closed (see tickNba's comment in src/index.js - fixed
// 2026-11-17). For each roster player, walks every game date since --since in
// order and rebuilds config/prices closes as one chain:
//   - a date with an existing close keeps that close's own move (its ratio
//     to the previous existing close), re-applied to the rebuilt prior;
//   - a date the player has a final box score for but no close gets the
//     same move tickNba would have written: prior * (1 + nbaPerf),
//     +/-15% a day, inside the statPrice band.
// liveP is set to the last rebuilt close, and the player's priceEngine doc
// gets the same history so the worker and the app agree.
//
// Only players with at least one missing game are touched.
// Usage: node scripts/backfill-nba-late-games.mjs [--since 2026-10-20] [--apply] [--only 261,9]

import { readFileSync } from 'node:fs';
import { nbaPerf } from '../src/engine.js';
import * as espnNba from '../src/espn.js';
import { firestoreBatchGetDocs, firestoreBatchWriteDocs, firestoreGetDoc, firestoreSetDeepFields } from '../src/lib/firestore.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const si = args.indexOf('--since');
const SINCE = si >= 0 ? args[si + 1] : '2026-10-20';
const oi = args.indexOf('--only');
const ONLY = oi >= 0 ? new Set(args[oi + 1].split(',').map(Number)) : null;

const raw = JSON.parse(readFileSync(new URL('../data/nba-raw.json', import.meta.url)));
const saText = readFileSync(new URL('../../worker-payments/service-account-key.json', import.meta.url), 'utf8');
const env = { FIREBASE_SERVICE_ACCOUNT: saText, FIREBASE_PROJECT_ID: JSON.parse(saText).project_id };
const byName = {};
for (const p of raw) byName[espnNba.normalizeName(p.name)] = p;

const TZ = 'America/New_York';
const etDate = ms => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ms));
const today = etDate(Date.now());

// 1. Every final box score since SINCE, keyed by the ET date the game tipped.
const statByRankDate = {}; // rank -> { date -> stat }
for (let t = Date.parse(SINCE + 'T12:00:00Z'); etDate(t) < today; t += 86400000) {
  const d = etDate(t);
  const sb = await espnNba.fetchScoreboard(d.replaceAll('-', ''));
  for (const ev of (sb.events || []).filter(e => e.status?.type?.completed)) {
    const stats = espnNba.extractNbaBoxScoreStats(await espnNba.fetchSummary(ev.id));
    for (const [name, stat] of Object.entries(stats)) {
      const p = byName[name];
      if (p) (statByRankDate[p.rank] ||= {})[d] = stat;
    }
  }
}

// 2. Current state.
const cfg = await firestoreGetDoc(env, 'config/prices');
const paths = raw.map(p => `priceEngine/nba_${p.rank}`);
const docs = {};
for (let i = 0; i < paths.length; i += 100) Object.assign(docs, await firestoreBatchGetDocs(env, paths.slice(i, i + 100)));

const cfgWrites = [], engineWrites = [], summary = [];
for (const p of raw) {
  if (ONLY && !ONLY.has(p.rank)) continue;
  const games = statByRankDate[p.rank] || {};
  const cc = { ...(cfg.closes?.[String(p.rank)] || {}) };
  const missing = Object.keys(games).filter(d => cc[d] === undefined).sort();
  if (!missing.length) continue;
  const st = docs[`priceEngine/nba_${p.rank}`] || {};
  const statPrice = st.statPrice;
  if (!(statPrice > 0)) { console.log(`skip #${p.rank} ${p.name}: no stored statPrice`); continue; }
  const lo = statPrice * 0.55, hi = statPrice * 1.70;
  const pp = { rank: p.rank, tier: st.tier || p.tier, ppg: st.ppg ?? p.ppg, rpg: st.rpg ?? p.rpg, apg: st.apg ?? p.apg, statPrice };

  const before = Object.keys(cc).filter(d => d < SINCE && cc[d] >= lo && cc[d] <= hi).sort();
  let prior = before.length ? cc[before[before.length - 1]] : statPrice;
  let prevOld = prior;
  const dates = [...new Set([...Object.keys(cc).filter(d => d >= SINCE && d < today), ...missing])].sort();
  const rebuilt = {};
  for (const d of dates) {
    let val;
    if (cc[d] !== undefined && cc[d] >= lo && cc[d] <= hi) {
      val = prior * (cc[d] / prevOld);       // keep the existing close's own move
      prevOld = cc[d];
    } else if (games[d]) {
      const perf = nbaPerf(pp, games[d]);
      val = prior * (1 + perf);
    } else continue;                           // out-of-band close with no game: leave it out of the chain
    val = Math.min(prior * 1.15, Math.max(prior * 0.85, val));
    val = Math.round(Math.min(statPrice * 1.68, Math.max(statPrice * 0.56, val)) * 100) / 100;
    rebuilt[d] = val;
    prior = val;
  }
  const oldLive = cfg.liveP?.[String(p.rank)] || 0;
  summary.push({ rank: p.rank, name: p.name, missing: missing.length, games: Object.keys(games).length, from: oldLive, to: prior });
  for (const [d, v] of Object.entries(rebuilt)) if (cc[d] !== v) cfgWrites.push({ segments: ['closes', String(p.rank), d], value: v });
  cfgWrites.push({ segments: ['liveP', String(p.rank)], value: prior });
  engineWrites.push({ path: `priceEngine/nba_${p.rank}`, fields: { closes: { ...(st.closes || {}), ...rebuilt }, base: null } });
}

summary.sort((a, b) => Math.abs(b.to / b.from - 1) - Math.abs(a.to / a.from - 1));
console.log(`${summary.length} NBA player(s) with games that never got a close (since ${SINCE}).\n`);
for (const s of summary.slice(0, 25)) {
  console.log(`  #${String(s.rank).padEnd(4)} ${s.name.padEnd(26)} ${String(s.missing).padStart(2)} of ${String(s.games).padStart(2)} games missing   ${s.from.toFixed(2).padStart(8)} -> ${s.to.toFixed(2).padStart(8)}  (${((s.to / s.from - 1) * 100).toFixed(1)}%)`);
}
const ups = summary.filter(s => s.to > s.from + 0.005).length, downs = summary.filter(s => s.to < s.from - 0.005).length;
console.log(`\n  ...${summary.length > 25 ? summary.length - 25 + ' more. ' : ''}${ups} up, ${downs} down, ${summary.length - ups - downs} unchanged.`);
const l = summary.find(s => s.rank === 261);
if (l) console.log(`  Yaxel Lendeborg: ${l.missing} of ${l.games} games had no close; ${l.from.toFixed(2)} -> ${l.to.toFixed(2)}`);
console.log(`\n${cfgWrites.length} config/prices field(s), ${engineWrites.length} priceEngine doc(s).`);
if (!APPLY) { console.log('Dry run - pass --apply to write.'); process.exit(0); }
await firestoreSetDeepFields(env, 'config/prices', cfgWrites);
await firestoreBatchWriteDocs(env, engineWrites);
console.log('Written.');
