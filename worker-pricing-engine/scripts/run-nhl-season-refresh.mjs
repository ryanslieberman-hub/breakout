// Runs the NHL daily season-stats refresh by hand (the worker does it every
// morning at 11:00 UTC - runNhlDailyRefresh). Writes config/nhlSeason.
// Usage: node scripts/run-nhl-season-refresh.mjs [--write]
import { readFileSync } from 'node:fs';
import * as nhl from '../src/nhl.js';
import { firestorePatchDoc } from '../src/lib/firestore.js';

const roster = JSON.parse(readFileSync(new URL('../data/nhl-raw.json', import.meta.url)));
const ids = JSON.parse(readFileSync(new URL('../data/nhl-ids.json', import.meta.url)));
const season = nhl.seasonLabel();
const data = nhl.buildSeasonData(roster, ids, await nhl.fetchSeasonStats(season));
console.log(`Season ${season}: ${Object.keys(data).length} of ${roster.length} players have stats.`);
for (const r of ['4001', '4002', String(roster.find(p => p.role === 'GK').rank)]) {
  const p = roster.find(x => String(x.rank) === r);
  console.log(`  ${p.name}: roster fpts ${p.fpts} ->`, JSON.stringify(data[r]));
}
if (!process.argv.includes('--write')) { console.log('Dry run - pass --write.'); process.exit(0); }
const saText = readFileSync(new URL('../../worker-payments/service-account-key.json', import.meta.url), 'utf8');
const env = { FIREBASE_SERVICE_ACCOUNT: saText, FIREBASE_PROJECT_ID: JSON.parse(saText).project_id };
await firestorePatchDoc(env, 'config/nhlSeason', { season, updatedAt: Date.now(), data });
console.log('Written config/nhlSeason.');
