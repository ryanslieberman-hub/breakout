// Read-only: compares every NBA roster player's team in data/nba-raw.json
// against ESPN's current 30 team rosters, matched by name (the client's
// ESPN_IDS map has duplicate ids, so it can't be trusted as the key).
// Our roster spells some teams differently from ESPN ("LA Lakers",
// "OKC Thunder"), so teams are compared by franchise, and a suggested new
// team uses the spelling our roster already uses most for that franchise.
//
// Usage: node scripts/check-nba-teams.mjs [--json out.json]

import { readFileSync, writeFileSync } from 'node:fs';
import { normalizeName } from '../src/espn.js';

const raw = JSON.parse(readFileSync(new URL('../data/nba-raw.json', import.meta.url)));
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

// franchise key: last word of the team name ("Lakers", "Thunder", "Cavs"->"Cavaliers")
const fkey = t => { const w = (t || '').trim().split(/\s+/).pop().toLowerCase(); return w === 'cavs' ? 'cavaliers' : w; };
// our preferred spelling per franchise = the one used most in our roster
const spelling = {};
for (const p of raw) { const k = fkey(p.team); (spelling[k] ||= {})[p.team] = (spelling[k][p.team] || 0) + 1; }
const ours = k => { const s = spelling[k]; return s ? Object.entries(s).sort((a, b) => b[1] - a[1])[0][0] : null; };

const teams = (await (await fetch(`${BASE}/teams?limit=40`)).json()).sports[0].leagues[0].teams.map(t => t.team);
const byName = {};
for (const t of teams) {
  const r = await (await fetch(`${BASE}/teams/${t.id}/roster`)).json();
  for (const a of r.athletes || []) byName[normalizeName(a.displayName)] = { team: t.displayName, espnId: a.id, name: a.displayName };
}
console.log(`ESPN: ${teams.length} teams, ${Object.keys(byName).length} players\n`);

const changed = [], missing = [];
for (const p of raw) {
  const cur = byName[normalizeName(p.name)];
  if (!cur) { missing.push({ rank: p.rank, name: p.name, team: p.team }); continue; }
  if (fkey(cur.team) !== fkey(p.team)) {
    changed.push({ rank: p.rank, name: p.name, from: p.team, to: ours(fkey(cur.team)) || cur.team, espnTeam: cur.team, espnId: cur.espnId });
  }
}
console.log(`TEAM CHANGED (${changed.length}):`);
for (const c of changed) console.log(`  #${c.rank} ${c.name.padEnd(26)} ${c.from}  ->  ${c.to}`);
console.log(`\nNOT ON ANY ESPN ROSTER (${missing.length}):`);
for (const m of missing) console.log(`  #${m.rank} ${m.name.padEnd(26)} listed with ${m.team}`);
const oi = process.argv.indexOf('--json');
if (oi >= 0) writeFileSync(process.argv[oi + 1], JSON.stringify({ changed, missing }, null, 1));
