const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

export function normalizeName(n) {
  return (n || '').toLowerCase().trim().replace(/[.'-]/g, '').replace(/\s+/g, ' ');
}

export async function fetchScoreboard(dateYYYYMMDD) {
  const res = await fetch(`${BASE}/scoreboard?dates=${dateYYYYMMDD}`);
  if (!res.ok) throw new Error(`ESPN NFL scoreboard fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchSummary(eventId) {
  const res = await fetch(`${BASE}/summary?event=${eventId}`);
  if (!res.ok) throw new Error(`ESPN NFL summary fetch failed: ${res.status}`);
  return res.json();
}

function fantasyPoints(cat, stats) {
  const n = i => parseFloat((stats[i] || '0').toString().replace(/[^0-9.\-]/g, '')) || 0;
  if (cat === 'passing') return n(1) * 0.04 + n(3) * 4 - n(4) * 2;
  if (cat === 'rushing') return n(1) * 0.1 + n(3) * 6;
  if (cat === 'receiving') return n(0) * 0.5 + n(1) * 0.1 + n(3) * 6;
  return 0;
}

// Defensive scoring is label-driven, not fixed-index (ESPN's defensive column
// order isn't stable the way passing/rushing/receiving is).
function defPoints(cat, labels, stats) {
  if (!labels || !stats) return 0;
  const get = names => {
    for (const name of names) {
      const idx = labels.findIndex(l => (l || '').toUpperCase() === name);
      if (idx >= 0) return parseFloat((stats[idx] || '0').toString().replace(/[^0-9.\-]/g, '')) || 0;
    }
    return 0;
  };
  const tot = get(['TOT', 'TACK', 'TCKL']);
  const solo = get(['SOLO']);
  const sacks = get(['SACK', 'SCK']);
  const tfl = get(['TFL']);
  const pd = get(['PD', 'PDEF']);
  const ints = cat === 'interceptions' ? get(['INT']) : 0;
  const ffum = get(['FF']);
  const td = get(['TD']);
  const tackles = tot || solo;
  return tackles * 1 + sacks * 2 + tfl * 0.5 + pd * 1 + ints * 3 + ffum * 2 + td * 6;
}

// Kicker scoring - ESPN's kicking category is [FG, XP, PTS] with FG/XP as
// "made/attempted" strings (e.g. "2/3"); only the made count matters for
// fantasy value. Same weights as the client's _nflFptsFromRaw.
function kickPoints(labels, stats) {
  if (!labels || !stats) return 0;
  const made = name => {
    const idx = labels.findIndex(l => (l || '').toUpperCase() === name);
    const raw = idx >= 0 ? (stats[idx] || '0/0').toString() : '0/0';
    return parseInt(raw.split('/')[0]) || 0;
  };
  return made('FG') * 3 + made('XP') * 1;
}

// Offensive fumbles lost - the counterpart to defensive FF above. ESPN's
// fumbles category is [FUM, LOST, REC]; only a lost fumble costs value.
function fumblePoints(labels, stats) {
  if (!labels || !stats) return 0;
  const idx = labels.findIndex(l => (l || '').toUpperCase() === 'LOST');
  const lost = idx >= 0 ? parseFloat((stats[idx] || '0').toString().replace(/[^0-9.\-]/g, '')) || 0 : 0;
  return -lost * 2;
}

// Returns { normalizedName -> totalFantasyPointsThisGame } from an ESPN
// summary response, summed across all offense/defense stat categories.
export function extractNflFantasyPoints(summary) {
  const out = {};
  const teams = summary?.boxscore?.players || [];
  for (const tm of teams) {
    for (const cat of tm.statistics || []) {
      const isOffense = ['passing', 'rushing', 'receiving'].includes(cat.name);
      const isDefense = ['defensive', 'interceptions'].includes(cat.name);
      const isKicking = cat.name === 'kicking';
      const isFumbles = cat.name === 'fumbles';
      if (!isOffense && !isDefense && !isKicking && !isFumbles) continue;
      for (const a of cat.athletes || []) {
        const nm = a.athlete?.displayName;
        if (!nm) continue;
        const pts = isDefense
          ? defPoints(cat.name, cat.labels, a.stats || [])
          : isKicking
          ? kickPoints(cat.labels, a.stats || [])
          : isFumbles
          ? fumblePoints(cat.labels, a.stats || [])
          : fantasyPoints(cat.name, a.stats || []);
        const key = normalizeName(nm);
        out[key] = (out[key] || 0) + pts;
      }
    }
  }
  return out;
}
