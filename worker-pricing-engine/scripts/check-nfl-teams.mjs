// Read-only: compares every NFL roster player's team (and position) in
// data/nfl-raw.json against ESPN's current 32 team rosters, matched by ESPN
// athlete id (NFL_IDS in index.html), falling back to name for the few
// players with no id. Use after the trade deadline, cut-down day, or any time
// teams look stale.
//
// Usage: node scripts/check-nfl-teams.mjs [--json out.json]
//   Prints players whose team changed and players on no active roster.

import { readFileSync, writeFileSync } from 'node:fs';
import * as nfl from '../src/nfl.js';

const raw = JSON.parse(readFileSync(new URL('../data/nfl-raw.json', import.meta.url)));
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const ids = JSON.parse(html.match(/const NFL_IDS = (\{[^\n]*\});/)[1]);

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const teams = (await (await fetch(`${BASE}/teams?limit=40`)).json()).sports[0].leagues[0].teams.map(t => t.team);
const byId = {}, byName = {};
for (const t of teams) {
  const r = await (await fetch(`${BASE}/teams/${t.id}/roster`)).json();
  for (const group of r.athletes || []) {
    for (const a of group.items || []) {
      const rec = { team: t.displayName, pos: a.position?.abbreviation, name: a.displayName, status: a.status?.type || a.status?.name || '', injuries: (a.injuries || []).map(i => i.status).join(',') };
      byId[String(a.id)] = rec;
      byName[nfl.normalizeName(a.displayName)] = rec;
    }
  }
}
console.log(`ESPN: ${teams.length} teams, ${Object.keys(byId).length} players on active rosters\n`);

const changed = [], missing = [];
for (const p of raw) {
  const id = ids[String(p.rank)];
  const cur = (id && byId[String(id)]) || (!id && byName[nfl.normalizeName(p.name)]) || null;
  if (!cur) { missing.push({ rank: p.rank, name: p.name, team: p.team, pos: p.pos, id: id || null }); continue; }
  if (cur.team !== p.team) changed.push({ rank: p.rank, name: p.name, from: p.team, to: cur.team, pos: p.pos, espnPos: cur.pos });
}
console.log(`TEAM CHANGED (${changed.length}):`);
for (const c of changed) console.log(`  #${c.rank} ${c.name.padEnd(26)} ${c.pos.padEnd(4)} ${c.from}  ->  ${c.to}`);
console.log(`\nNOT ON ANY ESPN ACTIVE ROSTER (${missing.length}):`);
for (const m of missing) console.log(`  #${m.rank} ${m.name.padEnd(26)} ${m.pos.padEnd(4)} listed with ${m.team}  (espn id ${m.id})`);

const out = process.argv.indexOf('--json');
if (out >= 0) writeFileSync(process.argv[out + 1], JSON.stringify({ changed, missing }, null, 1));
