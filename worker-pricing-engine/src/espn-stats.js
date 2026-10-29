// NBA season per-game averages from ESPN's public stats feed. Replaces
// balldontlie.js, which now answers 401 without a paid key - the daily refresh
// had been silently failing, so every player's ppg/rpg/apg (the perf formula's
// "expected" baseline) sat frozen at the initial roster values, including
// rookies on placeholder lines.
const BASE = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete';

// ESPN labels a season by the year it ENDS: 2026-27 is 2027. The season rolls
// over in autumn, so Sept+ belongs to next year's label.
export function espnSeasonLabel(d = new Date()) {
  return d.getUTCMonth() >= 8 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}

// Blend season-to-date with the roster's prior line so 4 hot (or cold) games
// don't swing a player's baseline all the way; trusts the season more as GP grows.
export const PRIOR_GAMES = 8;
export function blendAverage(prior, current, gp) {
  const w = gp / (gp + PRIOR_GAMES);
  return Math.round((prior * (1 - w) + current * w) * 10) / 10;
}

// Returns { normalizedName -> { ppg, rpg, apg, gp } } for every player with >=1 GP.
export async function fetchSeasonAverages(season, normalizeName) {
  const out = {};
  let page = 1, pages = 1;
  do {
    const url = `${BASE}?region=us&lang=en&contentorigin=espn&isqualified=false&page=${page}&limit=100&season=${season}&seasontype=2`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN NBA season stats fetch failed: ${res.status}`);
    const json = await res.json();
    pages = json.pagination?.pages || 1;
    const idx = {};
    for (const c of json.categories || []) (c.names || []).forEach((n, i) => { idx[`${c.name}.${n}`] = i; });
    for (const row of json.athletes || []) {
      const cat = name => (row.categories || []).find(c => c.name === name)?.values || [];
      const gen = cat('general'), off = cat('offensive');
      const gp = gen[idx['general.gamesPlayed']] || 0;
      if (gp < 1) continue;
      out[normalizeName(row.athlete?.displayName)] = {
        gp,
        ppg: off[idx['offensive.avgPoints']] || 0,
        rpg: gen[idx['general.avgRebounds']] || 0,
        apg: off[idx['offensive.avgAssists']] || 0,
      };
    }
    page++;
  } while (page <= pages);
  return out;
}
