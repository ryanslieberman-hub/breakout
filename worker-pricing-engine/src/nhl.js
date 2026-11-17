// NHL live data from ESPN's public hockey feed - same shape as nfl.js.
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl';

export function normalizeName(n) {
  return (n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/[.'-]/g, '').replace(/\s+/g, ' ').trim();
}

// Fraction (0-1) of a 60-minute NHL game elapsed. Final (incl. OT/SO) = 1.
// Mirrors the client's _nhlGameFrac in index.html - keep in sync.
export function gameFrac(status) {
  if (!status) return 1;
  if (status.type?.completed || status.type?.state === 'post') return 1;
  const period = status.period || 1;
  if (period >= 4) return 1;
  const [m, s] = (status.displayClock || '20:00').split(':').map(Number);
  const left = (m || 0) * 60 + (s || 0);
  const elapsed = (period - 1) * 1200 + Math.max(0, 1200 - left);
  return Math.min(1, Math.max(0, elapsed / 3600));
}

export async function fetchScoreboard(dateYYYYMMDD) {
  const res = await fetch(`${BASE}/scoreboard?dates=${dateYYYYMMDD}`);
  if (!res.ok) throw new Error(`ESPN NHL scoreboard fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchSummary(eventId) {
  const res = await fetch(`${BASE}/summary?event=${eventId}`);
  if (!res.ok) throw new Error(`ESPN NHL summary fetch failed: ${res.status}`);
  return res.json();
}

// One player's line for one game, read by label (ESPN's hockey column order
// differs between skaters and goalies). Same field names the client writes
// to lastNight (index.html _nhlRawLine) - keep in sync.
export function rawLine(labels, stats) {
  const L = (labels || []).map(l => (l || '').toUpperCase());
  const get = name => { const i = L.indexOf(name); return i < 0 ? null : (stats[i] ?? null); };
  const num = v => (v == null ? 0 : parseFloat(String(v).replace(/[^0-9.\-]/g, '')) || 0);
  if (L.includes('SV') || L.includes('SA') || L.includes('GA')) {
    return { goalie: true, sa: num(get('SA')), ga: num(get('GA')), sv: num(get('SV')),
      svpct: num(get('SV%')), toi: String(get('TOI') ?? '') };
  }
  return { goalie: false, g: num(get('G')), a: num(get('A')), sog: num(get('S') ?? get('SOG')),
    blk: num(get('BS') ?? get('BLK')), hits: num(get('HT') ?? get('HIT')), pm: num(get('+/-')),
    pim: num(get('PIM')), toi: String(get('TOI') ?? '') };
}

// Fantasy points for a line. Goalie win/shutout come from the game result.
export function fpts(line) {
  if (line.goalie) return (line.sv || 0) * 0.2 - (line.ga || 0) * 1 + (line.win ? 3 : 0) + (line.so ? 2 : 0);
  // Same formula as the season baseline (build-nhl-roster.mjs): ESPN's season
  // stats have no blocked shots, so counting them here made every defenseman
  // look like he beat expectations every night.
  return (line.g || 0) * 3 + (line.a || 0) * 2 + (line.sog || 0) * 0.5;
}

// { normalizedName -> line } from an ESPN summary, with goalie win/shutout filled in.
export function extractNhlLines(summary) {
  const out = {};
  const comp = summary?.header?.competitions?.[0];
  const winnerTeamId = comp?.competitors?.find(c => c.winner)?.team?.id;
  const final = !!comp?.status?.type?.completed;
  const secs = t => { const [m, s] = String(t || '0:00').split(':').map(Number); return (m || 0) * 60 + (s || 0); };
  for (const tm of summary?.boxscore?.players || []) {
    const teamId = tm.team?.id;
    const teamGoalies = [];
    for (const cat of tm.statistics || []) {
      for (const a of cat.athletes || []) {
        const nm = a.athlete?.displayName;
        if (!nm || !(a.stats || []).length) continue;
        const line = rawLine(cat.labels, a.stats);
        if (line.goalie) {
          if (!(secs(line.toi) > 0)) continue; // dressed but didn't play
          line.so = final && line.ga === 0 && line.sa > 0;
          teamGoalies.push(line);
        }
        out[normalizeName(nm)] = line;
      }
    }
    // ESPN doesn't flag the starter here; the win goes to the winning team's
    // goalie who played the most minutes (the goalie of record in practice).
    if (final && teamId === winnerTeamId && teamGoalies.length) {
      teamGoalies.sort((x, y) => secs(y.toi) - secs(x.toi))[0].win = true;
    }
    teamGoalies.forEach(g => { if (g.win !== true) g.win = false; });
  }
  return out;
}

// This season's line for every NHL player ESPN has stats for, keyed by ESPN
// athlete id. ESPN labels a season by the year it ends (2026-27 = 2027).
export function seasonLabel(d = new Date()) {
  return d.getUTCMonth() >= 8 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}
export async function fetchSeasonStats(season) {
  const STATS = 'https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl/statistics/byathlete';
  const out = {};
  let page = 1, pages = 1;
  do {
    const res = await fetch(`${STATS}?region=us&lang=en&contentorigin=espn&isqualified=false&page=${page}&limit=100&season=${season}&seasontype=2`);
    if (!res.ok) throw new Error(`ESPN NHL season stats fetch failed: ${res.status}`);
    const j = await res.json();
    pages = j.pagination?.pages || 1;
    const idx = {};
    for (const c of j.categories || []) (c.names || []).forEach((n, i) => { idx[`${c.name}.${n}`] = i; });
    for (const row of j.athletes || []) {
      const cat = n => (row.categories || []).find(c => c.name === n)?.values || [];
      const gen = cat('general'), off = cat('offensive'), def = cat('defensive');
      const v = (arr, key) => +(arr[idx[key]] ?? 0) || 0;
      out[String(row.athlete?.id)] = {
        gp: v(gen, 'general.games'), w: v(gen, 'general.wins'),
        g: v(off, 'offensive.goals'), a: v(off, 'offensive.assists'), pts: v(off, 'offensive.points'), sog: v(off, 'offensive.shotsTotal'),
        ga: v(def, 'defensive.goalsAgainst'), sv: v(def, 'defensive.saves'), so: v(def, 'defensive.shutouts'),
        svpct: v(def, 'defensive.savePct'), gaa: v(def, 'defensive.avgGoalsAgainst'),
      };
    }
    page++;
  } while (page <= pages);
  return out;
}

// config/nhlSeason's data map: each roster player's line for the app header
// plus a refreshed expected rate (roster rate blended with this season's,
// trusting this season more as games pile up).
export function buildSeasonData(roster, ids, stats, priorGames = 8) {
  const data = {};
  for (const p of roster) {
    const s = stats[String(ids[p.rank])];
    if (!s || !s.gp) continue;
    const goalie = p.role === 'GK';
    const rate = goalie ? (s.w * 3 + s.sv * 0.2 - s.ga + s.so * 2) / s.gp : (s.g * 3 + s.a * 2 + s.sog * 0.5) / s.gp;
    const w = s.gp / (s.gp + priorGames);
    const fpts = Math.round((p.fpts * (1 - w) + rate * w) * 10) / 10;
    data[String(p.rank)] = goalie
      ? { gp: s.gp, w: s.w, gaa: Math.round(s.gaa * 100) / 100, svpct: Math.round(s.svpct * 1000) / 1000, fpts }
      : { gp: s.gp, g: s.g, a: s.a, pts: s.pts, fpts };
  }
  return data;
}

// The config/lastNight entry for one finished game.
export function lastNightEntry(line, date) {
  return { played: true, date, live: false, nhl: true, fpts: Math.round(fpts(line) * 10) / 10,
    ts: Date.parse(date + 'T21:00:00-05:00'), ...line };
}
