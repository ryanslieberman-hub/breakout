// Builds NHL price history for the season so far, so charts and 7D/30D
// moves have real data from launch day (2026-11-17) instead of starting flat.
//
// For every NHL date from --since to yesterday (ET), each roster player who
// played gets one close: prior * (1 + nhlPerf(game)), +/-15% a day, inside
// the statPrice band - the same thing tickNhl writes after each game. The
// chain starts at the player's statPrice before his first game.
//
// Writes, per NHL rank only: config/prices closes + liveP (last close), and
// the priceEngine/nhl_<rank> doc's closes (base cleared). Refuses to touch a
// rank that anyone holds, or one that already has closes, unless --force.
//
// Usage: node scripts/backfill-nhl-history.mjs [--since 2026-10-01] [--apply] [--force]

import { readFileSync } from 'node:fs';
import * as nhl from '../src/nhl.js';
import { statPriceFor, nhlPerf } from '../src/engine.js';
import { firestoreBatchGetDocs, firestoreBatchWriteDocs, firestoreGetDoc, firestoreSetDeepFields, firestoreQuery, firestoreListCollection } from '../src/lib/firestore.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply'), FORCE = args.includes('--force');
const si = args.indexOf('--since');
const SINCE = si >= 0 ? args[si + 1] : '2026-10-01';
const raw = JSON.parse(readFileSync(new URL('../data/nhl-raw.json', import.meta.url)));
const saText = readFileSync(new URL('../../worker-payments/service-account-key.json', import.meta.url), 'utf8');
const env = { FIREBASE_SERVICE_ACCOUNT: saText, FIREBASE_PROJECT_ID: JSON.parse(saText).project_id };
const byName = {}; for (const p of raw) byName[nhl.normalizeName(p.name)] = p;
const etDate = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
const today = etDate(Date.now());

// 1. Safety: nobody holds an NHL player, and no NHL history exists yet.
const ranks = new Set(raw.map(p => p.rank));
let held = 0;
for (const pf of await firestoreQuery(env, 'portfolios')) {
  const docs = [pf, ...(await firestoreListCollection(env, `portfolios/${pf.id}/wallets?pageSize=300`).catch(() => [])),
                    ...(await firestoreListCollection(env, `portfolios/${pf.id}/challenges?pageSize=300`).catch(() => []))];
  for (const d of docs) for (const [r, h] of Object.entries(d.holdings || {})) if (ranks.has(+r) && h?.shares > 0) held++;
}
const cfg = await firestoreGetDoc(env, 'config/prices');
const existing = raw.filter(p => Object.keys(cfg.closes?.[String(p.rank)] || {}).length).length;
console.log(`NHL holdings: ${held}. NHL players with closes already: ${existing}.`);
if ((held || existing) && !FORCE) { console.log('Refusing without --force.'); process.exit(1); }

// 2. Every finished game since SINCE.
const fptsByRankDate = {};
let days = 0, games = 0;
for (let t = Date.parse(SINCE + 'T12:00:00Z'); etDate(t) < today; t += 86400000) {
  const d = etDate(t);
  const sb = await nhl.fetchScoreboard(d.replaceAll('-', ''));
  const finals = (sb.events || []).filter(e => e.status?.type?.completed && (e.season?.type ?? 2) === 2); // regular season only
  if (!finals.length) continue;
  days++; games += finals.length;
  for (const ev of finals) {
    for (const [name, line] of Object.entries(nhl.extractNhlLines(await nhl.fetchSummary(ev.id)))) {
      const p = byName[name]; if (p) (fptsByRankDate[p.rank] ||= {})[d] = nhl.fpts(line);
    }
  }
}
console.log(`${games} games on ${days} days since ${SINCE}.`);

// 3. Chain closes per player.
const cfgWrites = [], engineWrites = [], summary = [];
for (const p of raw) {
  const statPrice = statPriceFor('nhl', p);
  const lo = statPrice * 0.56, hi = statPrice * 1.68;
  const pp = { rank: p.rank, tier: p.tier, fpts: p.fpts, statPrice };
  const gd = fptsByRankDate[p.rank] || {};
  let prior = statPrice;
  const closes = {};
  for (const d of Object.keys(gd).sort()) {
    const perf = nhlPerf(pp, { fpts: gd[d], gameFrac: 1 });
    let v = Math.min(prior * 1.15, Math.max(prior * 0.85, prior * (1 + perf)));
    v = Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100;
    closes[d] = v; prior = v;
  }
  if (!Object.keys(closes).length) continue;
  summary.push({ name: p.name, games: Object.keys(closes).length, from: statPrice, to: prior });
  // Skip fields already holding this exact value, so a re-run after an
  // interrupted write only sends what's missing.
  const have = cfg.closes?.[String(p.rank)] || {};
  for (const [d, v] of Object.entries(closes)) if (have[d] !== v) cfgWrites.push({ segments: ['closes', String(p.rank), d], value: v });
  if (cfg.liveP?.[String(p.rank)] !== prior) cfgWrites.push({ segments: ['liveP', String(p.rank)], value: prior });
  engineWrites.push({ path: `priceEngine/nhl_${p.rank}`, fields: { closes, base: null, tier: p.tier, statPrice, fpts: p.fpts } });
}
summary.sort((a, b) => (b.to / b.from) - (a.to / a.from));
const show = s => `  ${s.name.padEnd(24)} ${String(s.games).padStart(2)} games  ${s.from.toFixed(2).padStart(7)} -> ${s.to.toFixed(2).padStart(7)} (${((s.to / s.from - 1) * 100).toFixed(1)}%)`;
console.log(`\n${summary.length} players get history. Biggest risers:`); summary.slice(0, 5).forEach(s => console.log(show(s)));
console.log('Biggest fallers:'); summary.slice(-5).forEach(s => console.log(show(s)));
const mc = summary.find(s => s.name === 'Connor McDavid'); if (mc) console.log('McDavid:\n' + show(mc));
const ch = summary.map(s => s.to / s.from - 1).sort((a, b) => a - b);
console.log(`Median move ${(ch[Math.floor(ch.length / 2)] * 100).toFixed(1)}%, ${ch.filter(x => x > 0).length} up / ${ch.filter(x => x < 0).length} down.`);
console.log(`\n${cfgWrites.length} config/prices fields, ${engineWrites.length} priceEngine docs.`);
if (!APPLY) { console.log('Dry run - pass --apply to write.'); process.exit(0); }
// config/prices is one hot document (every open app writes it), and Firestore
// caps write bandwidth per document - a straight bulk write got 429
// RESOURCE_EXHAUSTED after ~15 players. Small batches, spaced out, with
// exponential backoff on 429. Re-running is safe: each field is set, not added.
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < cfgWrites.length; i += 20) {
  const chunk = cfgWrites.slice(i, i + 20);
  for (let attempt = 0; ; attempt++) {
    try { await firestoreSetDeepFields(env, 'config/prices', chunk); break; }
    catch (e) {
      if (!/429|RESOURCE_EXHAUSTED|ABORTED|503/.test(e.message) || attempt >= 8) throw e;
      await sleep(1000 * 2 ** attempt);
    }
  }
  if ((i / 20) % 25 === 0) console.log(`  ${Math.min(i + 20, cfgWrites.length)} / ${cfgWrites.length}`);
  await sleep(1500);
}
await firestoreBatchWriteDocs(env, engineWrites);
console.log('Written.');
