// Builds the NHL roster (data/nhl-raw.json) from ESPN: every player on a
// current team roster, with last season's and this season's stats.
//
//   expected fantasy points per game (fpts) = the price baseline
//     skater: G*3 + A*2 + SOG*0.5 per game
//     goalie: W*3 + SV*0.2 - GA*1 + SO*2 per game
//   blended: last season's rate and this season's, trusting this season more
//   as games pile up (same blend the NBA daily refresh uses).
//
// Display stats are this season's (last season's if fewer than 5 games):
//   skater g, a, pts, gp      goalie w, gaa, svpct, gp
//
// Usage: node scripts/build-nhl-roster.mjs [--write]
//   Prints the roster summary; --write saves data/nhl-raw.json and
//   data/nhl-ids.json (rank -> ESPN athlete id, for headshots).

import { writeFileSync } from 'node:fs';
import { normalizeName } from '../src/nhl.js';

const WRITE = process.argv.includes('--write');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl';
const STATS = 'https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl/statistics/byathlete';
const now = new Date();
const CUR = now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(); // ESPN labels a season by its end year
const PREV = CUR - 1;

async function seasonStats(season) {
  const out = {};
  let page = 1, pages = 1;
  do {
    const res = await fetch(`${STATS}?region=us&lang=en&contentorigin=espn&isqualified=false&page=${page}&limit=100&season=${season}&seasontype=2`);
    if (!res.ok) throw new Error(`ESPN NHL stats ${season} p${page}: ${res.status}`);
    const j = await res.json();
    pages = j.pagination?.pages || 1;
    const idx = {};
    for (const c of j.categories || []) (c.names || []).forEach((n, i) => { idx[`${c.name}.${n}`] = i; });
    for (const row of j.athletes || []) {
      const cat = n => (row.categories || []).find(c => c.name === n)?.values || [];
      const gen = cat('general'), off = cat('offensive'), def = cat('defensive');
      const v = (arr, key) => +(arr[idx[key]] ?? 0) || 0;
      out[String(row.athlete?.id)] = {
        gp: v(gen, 'general.games'), wins: v(gen, 'general.wins'),
        g: v(off, 'offensive.goals'), a: v(off, 'offensive.assists'), pts: v(off, 'offensive.points'),
        sog: v(off, 'offensive.shotsTotal'),
        ga: v(def, 'defensive.goalsAgainst'), sv: v(def, 'defensive.saves'),
        svpct: v(def, 'defensive.savePct'), gaa: v(def, 'defensive.avgGoalsAgainst'), so: v(def, 'defensive.shutouts'),
      };
    }
    page++;
  } while (page <= pages);
  return out;
}

// probe the field names once, so a renamed ESPN key fails loudly instead of zeroing everyone
{
  const j = await (await fetch(`${STATS}?region=us&lang=en&isqualified=false&limit=1&season=${PREV}&seasontype=2`)).json();
  const names = (j.categories || []).flatMap(c => (c.names || []).map(n => `${c.name}.${n}`));
  const need = ['general.games', 'general.wins', 'offensive.goals', 'offensive.assists', 'offensive.points', 'offensive.shotsTotal',
    'defensive.goalsAgainst', 'defensive.saves', 'defensive.savePct', 'defensive.avgGoalsAgainst', 'defensive.shutouts'];
  const missing = need.filter(n => !names.includes(n));
  if (missing.length) { console.log('ESPN stat keys missing:', missing.join(', '), '\navailable:', names.join(', ')); process.exit(1); }
}

const [prev, cur] = await Promise.all([seasonStats(PREV), seasonStats(CUR)]);

const teams = (await (await fetch(`${SITE}/teams?limit=40`)).json()).sports[0].leagues[0].teams.map(t => t.team);
const roster = [];
for (const t of teams) {
  const r = await (await fetch(`${SITE}/teams/${t.id}/roster`)).json();
  for (const grp of r.athletes || []) for (const a of grp.items || []) {
    roster.push({ id: String(a.id), name: a.displayName, team: t.displayName, pos: a.position?.abbreviation });
  }
}
console.log(`ESPN: ${teams.length} teams, ${roster.length} rostered players; seasons ${PREV} and ${CUR}`);

const rate = (s, goalie) => {
  if (!s || !s.gp) return null;
  return goalie ? (s.wins * 3 + s.sv * 0.2 - s.ga * 1 + s.so * 2) / s.gp
                : (s.g * 3 + s.a * 2 + s.sog * 0.5) / s.gp;
};
const PRIOR_GAMES = 8;
const candidates = [];
for (const p of roster) {
  const goalie = p.pos === 'G';
  const sp = prev[p.id], sc = cur[p.id];
  const rp = rate(sp, goalie), rc = rate(sc, goalie);
  const gpP = sp?.gp || 0, gpC = sc?.gp || 0;
  if (goalie ? (gpP < 15 && gpC < 5) : (gpP < 25 && gpC < 8)) continue; // not enough NHL games to price
  let fpts;
  if (rp != null && rc != null) { const w = gpC / (gpC + PRIOR_GAMES); fpts = rp * (1 - w) + rc * w; }
  else fpts = rc ?? rp;
  const shown = gpC >= 5 ? sc : sp; // display this season once it means something
  const seasonLabel = gpC >= 5 ? CUR : PREV;
  candidates.push({ ...p, goalie, fpts, shown, seasonLabel });
}

const skaters = candidates.filter(c => !c.goalie).sort((a, b) => b.fpts - a.fpts).slice(0, 220);
const goalies = candidates.filter(c => c.goalie).sort((a, b) => b.fpts - a.fpts).slice(0, 40);
const tierOf = (i, cuts) => cuts.findIndex(n => i < n) >= 0 ? 'SABCD'[cuts.findIndex(n => i < n)] : 'D';
const posOf = pos => (pos === 'C' || pos === 'LW' || pos === 'RW' || pos === 'D' || pos === 'G') ? pos : (pos === 'F' ? 'C' : pos);

const out = [], ids = {};
let rank = 4001;
const r1 = n => Math.round(n * 10) / 10;
skaters.forEach((c, i) => {
  const s = c.shown || {};
  ids[rank] = c.id;
  out.push({ rank: rank++, name: c.name, team: c.team, pos: posOf(c.pos), role: c.pos === 'D' ? 'D' : 'F',
    tier: tierOf(i, [10, 40, 100, 170]), fpts: r1(c.fpts),
    gp: s.gp || 0, g: s.g || 0, a: s.a || 0, pts: s.pts || 0, season: c.seasonLabel });
});
goalies.forEach((c, i) => {
  const s = c.shown || {};
  ids[rank] = c.id;
  out.push({ rank: rank++, name: c.name, team: c.team, pos: 'G', role: 'GK',
    tier: tierOf(i, [3, 10, 22, 32]), fpts: r1(c.fpts),
    gp: s.gp || 0, w: s.wins || 0, gaa: +((s.gaa || 0).toFixed(2)), svpct: +((s.svpct || 0).toFixed(3)), season: c.seasonLabel });
});

const byTier = {}; out.forEach(p => byTier[p.tier] = (byTier[p.tier] || 0) + 1);
console.log(`Roster: ${out.length} players (${skaters.length} skaters, ${goalies.length} goalies). Tiers:`, JSON.stringify(byTier));
for (const p of [...out.slice(0, 8), ...out.filter(p => p.role === 'GK').slice(0, 3)]) console.log('  ', JSON.stringify(p));
const dupNames = Object.entries(out.reduce((m, p) => (m[normalizeName(p.name)] = (m[normalizeName(p.name)] || 0) + 1, m), {})).filter(([, n]) => n > 1);
if (dupNames.length) console.log('DUPLICATE NAMES (box-score matching is by name):', dupNames.map(d => d[0]).join(', '));
if (!WRITE) { console.log('\nDry run - pass --write to save.'); process.exit(0); }
writeFileSync(new URL('../data/nhl-raw.json', import.meta.url), JSON.stringify(out));
writeFileSync(new URL('../data/nhl-ids.json', import.meta.url), JSON.stringify(ids));
console.log('Wrote data/nhl-raw.json and data/nhl-ids.json');
