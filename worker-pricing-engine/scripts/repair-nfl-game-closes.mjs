// One-off (2026-09-29): re-scores a finished NFL date's closes in config/prices.
// Monday night's PHI @ CHI game was finalized flat (every close == the player's
// prior close) because the client's post-midnight reconcile path repriced at base
// before finalize(). This re-derives each box-scored player's close the same way
// the worker's tickNfl mirrors it: clientPriorClose * (1 + nflPerf), +/-15% cap,
// statPrice band. Only overwrites a date that is missing or exactly flat vs its
// prior close - never a close that already moved.
//
// Usage: node scripts/repair-nfl-game-closes.mjs <YYYY-MM-DD> [--apply]
import { readFileSync } from 'node:fs';
import { firestoreGetDoc, getAccessToken, toFirestoreValue } from '../src/lib/firestore.js';
import { statPriceFor, nflPerf } from '../src/engine.js';
import * as nfl from '../src/nfl.js';

const DATE = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE || '')) { console.error('Usage: node repair-nfl-game-closes.mjs <YYYY-MM-DD> [--apply]'); process.exit(1); }

const sa = JSON.parse(readFileSync(new URL('../../worker-payments/service-account-key.json', import.meta.url)));
const env = { FIREBASE_PROJECT_ID: sa.project_id, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(sa) };
const raw = JSON.parse(readFileSync(new URL('../data/nfl-raw.json', import.meta.url)));
const byName = {};
for (const p of raw) byName[nfl.normalizeName(p.name)] = p;

const sb = await nfl.fetchScoreboard(DATE.replaceAll('-', ''));
const finals = (sb.events || []).filter(e => e.status?.type?.completed);
console.log(`${finals.length} final game(s) on ${DATE}: ${finals.map(e => e.shortName).join(', ')}`);

const fptsByRank = {};
for (const ev of finals) {
  const pts = nfl.extractNflFantasyPoints(await nfl.fetchSummary(ev.id));
  for (const [name, v] of Object.entries(pts)) {
    const p = byName[name];
    if (p) fptsByRank[p.rank] = (fptsByRank[p.rank] || 0) + v;
  }
}

const prices = await firestoreGetDoc(env, 'config/prices');
const closes = prices.closes || {};
const entries = [];
for (const [rankStr, fpts] of Object.entries(fptsByRank)) {
  const rank = +rankStr;
  const player = raw.find(p => p.rank === rank);
  const c = closes[rankStr] || {};
  const prior = Object.keys(c).filter(d => d < DATE && c[d] > 0).sort();
  if (!prior.length) { console.log(`  skip #${rank} ${player.name}: no prior close`); continue; }
  const prev = c[prior[prior.length - 1]];
  const existing = c[DATE];
  if (existing !== undefined && Math.abs(existing - prev) > 0.005) { console.log(`  keep #${rank} ${player.name}: ${DATE} close ${existing} already moved`); continue; }
  const statPrice = statPriceFor('nfl', player);
  const perf = nflPerf({ rank, tier: player.tier, fpts: player.fpts, statPrice }, { fpts, gameFrac: 1 });
  let val = Math.min(prev * 1.15, Math.max(prev * 0.85, prev * (1 + perf)));
  val = Math.round(Math.min(statPrice * 1.68, Math.max(statPrice * 0.56, val)) * 100) / 100;
  console.log(`  #${rank} ${player.name.padEnd(22)} fpts ${fpts.toFixed(1)} (base ${player.fpts})  ${prev} -> ${val}  (${((val / prev - 1) * 100).toFixed(1)}%)`);
  entries.push({ segments: ['closes', String(rank), DATE], value: val });
}
console.log(`\n${entries.length} close(s) to write.`);
if (!APPLY) { console.log('Dry run - pass --apply to write.'); process.exit(0); }

const rootFields = {}, fieldPaths = [];
for (const { segments, value } of entries) {
  let cur = rootFields;
  segments.forEach((s, j) => {
    if (j === segments.length - 1) cur[s] = toFirestoreValue(value);
    else { cur[s] = cur[s] || { mapValue: { fields: {} } }; cur = cur[s].mapValue.fields; }
  });
  fieldPaths.push(segments.map(s => '`' + s + '`').join('.'));
}
const qs = fieldPaths.map(p => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&');
const res = await fetch(`https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/config/prices?${qs}`, {
  method: 'PATCH', headers: { Authorization: `Bearer ${await getAccessToken(env)}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: rootFields }),
});
if (!res.ok) throw new Error(await res.text());
console.log(`Applied ${entries.length} close(s).`);
