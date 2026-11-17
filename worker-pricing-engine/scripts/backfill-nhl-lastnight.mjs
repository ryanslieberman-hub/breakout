// Seeds config/lastNight ("Last game" tiles) for NHL players from the finished
// games on the given dates, newest game per player. Written for the NHL launch
// (2026-11-17) so players show their most recent game straight away; after
// that, tickNhl writes these itself. Per-rank field paths only. Never replaces
// a newer stored game.
// Usage: node scripts/backfill-nhl-lastnight.mjs [--write] YYYY-MM-DD [...]
import { readFileSync } from 'node:fs';
import * as nhl from '../src/nhl.js';
import { firestoreGetDoc, firestoreSetDeepFields } from '../src/lib/firestore.js';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const dates = args.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a)).sort();
if (!dates.length) { console.log('Usage: node scripts/backfill-nhl-lastnight.mjs [--write] YYYY-MM-DD [...]'); process.exit(1); }
const raw = JSON.parse(readFileSync(new URL('../data/nhl-raw.json', import.meta.url)));
const byName = {}; for (const p of raw) byName[nhl.normalizeName(p.name)] = p;
const saText = readFileSync(new URL('../../worker-payments/service-account-key.json', import.meta.url), 'utf8');
const env = { FIREBASE_SERVICE_ACCOUNT: saText, FIREBASE_PROJECT_ID: JSON.parse(saText).project_id };
const stored = (await firestoreGetDoc(env, 'config/lastNight'))?.data || {};
const latest = {};
for (const date of dates) {
  const sb = await nhl.fetchScoreboard(date.replaceAll('-', ''));
  const finals = (sb.events || []).filter(e => e.status?.type?.completed);
  let n = 0;
  for (const ev of finals) {
    for (const [name, line] of Object.entries(nhl.extractNhlLines(await nhl.fetchSummary(ev.id)))) {
      const p = byName[name]; if (!p) continue;
      const cur = latest[p.rank] || stored[String(p.rank)];
      if (cur && cur.date >= date) continue;
      latest[p.rank] = nhl.lastNightEntry(line, date); n++;
    }
  }
  console.log(`${date}: ${finals.length} final(s), ${n} line(s)`);
}
const writes = Object.entries(latest).map(([r, v]) => ({ segments: ['data', r], value: v }));
console.log(`${writes.length} NHL player(s) of ${raw.length} get a last game.`);
const mc = raw.find(p => p.name === 'Connor McDavid'); if (mc) console.log('  McDavid:', JSON.stringify(latest[mc.rank] || '(none)'));
if (!WRITE) { console.log('Dry run - pass --write.'); process.exit(0); }
if (writes.length) { writes.push({ segments: ['updatedAt'], value: Date.now() }); await firestoreSetDeepFields(env, 'config/lastNight', writes); }
console.log('Written.');
