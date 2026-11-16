// Backfill config/lastNight ("Last game" stat tiles) for EVERY roster player
// from the finished NFL games on the given dates. Written 2026-11-16, when the
// doc turned out to hold no NFL game later than 11-01: only a signed-in
// browser open on game day ever wrote there. tickNfl now writes it itself
// (see src/index.js), so this is only for catching up games that finished
// before that shipped, or after an outage.
//
// Uses the worker's own extractNflRawLines/lastNightEntry, so a backfilled
// entry is identical to one the cron would have written.
//
// Safe to re-run: a player is only written when the stored entry is OLDER
// than the game being backfilled (or missing). Per-rank field paths only -
// never a whole-map write (see reference: syncPricesToFirestore 2026-09-14).
//
// Usage: node scripts/backfill-nfl-lastnight-dates.mjs [--write] YYYY-MM-DD [YYYY-MM-DD ...]
//   Dates are processed oldest first so each player ends on their latest game.

import { readFileSync } from 'node:fs';
import * as nfl from '../src/nfl.js';
import { firestoreGetDoc, firestoreSetDeepFields } from '../src/lib/firestore.js';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const dates = args.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a)).sort();
if (!dates.length) {
  console.log('Usage: node scripts/backfill-nfl-lastnight-dates.mjs [--write] YYYY-MM-DD [YYYY-MM-DD ...]');
  process.exit(1);
}

const nflRaw = JSON.parse(readFileSync(new URL('../data/nfl-raw.json', import.meta.url)));
const byName = {};
for (const p of nflRaw) byName[nfl.normalizeName(p.name)] = p;

const saText = readFileSync(new URL('../../worker-payments/service-account-key.json', import.meta.url), 'utf8');
const env = { FIREBASE_SERVICE_ACCOUNT: saText, FIREBASE_PROJECT_ID: JSON.parse(saText).project_id };

const stored = (await firestoreGetDoc(env, 'config/lastNight'))?.data || {};
const latest = {}; // rank -> entry to write
for (const date of dates) {
  const sb = await nfl.fetchScoreboard(date.replaceAll('-', ''));
  const finals = (sb.events || []).filter(e => e.status?.type?.completed);
  let n = 0;
  for (const ev of finals) {
    const lines = nfl.extractNflRawLines(await nfl.fetchSummary(ev.id));
    for (const [name, line] of Object.entries(lines)) {
      const p = byName[name];
      if (!p) continue;
      const cur = latest[p.rank] || stored[String(p.rank)];
      if (cur && cur.date >= date) continue;
      latest[p.rank] = nfl.lastNightEntry(line, date);
      n++;
    }
  }
  console.log(`${date}: ${finals.length} finished game(s), ${n} player line(s) newer than what is stored`);
}

const writes = Object.entries(latest).map(([rank, value]) => ({ segments: ['data', String(rank)], value }));
console.log(`\n${writes.length} player(s) to update.`);
for (const name of ['Bijan Robinson', 'George Pickens', 'Ryan Flournoy']) {
  const p = byName[nfl.normalizeName(name)];
  if (p) console.log(`  ${name} (#${p.rank}):`, JSON.stringify(latest[p.rank] || '(no change)'));
}

if (!WRITE) { console.log('\nDry run only. Re-run with --write to update config/lastNight.'); process.exit(0); }
if (!writes.length) process.exit(0);
writes.push({ segments: ['updatedAt'], value: Date.now() });
await firestoreSetDeepFields(env, 'config/lastNight', writes);
console.log(`Wrote ${writes.length - 1} entries to config/lastNight.`);
