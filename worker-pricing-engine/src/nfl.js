const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

export function normalizeName(n) {
  return (n || '').toLowerCase().trim()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')          // strip suffixes
    .replace(/[.'-]/g, '').replace(/\s+/g, ' ').trim();
}

// Fraction (0-1) of the 60-minute NFL game clock elapsed, from an ESPN
// scoreboard event's status. Mirrors the client's _nflGameFrac (index.html) -
// keep both in sync, this worker computes nflPerf independently of the
// client and needs the same pace-confidence signal.
export function gameFrac(status) {
  if (!status) return 1;
  if (status.type?.completed || status.type?.state === 'post') return 1;
  const period = status.period || 1;
  if (period >= 5) return 1; // OT - game is effectively over
  const clock = (status.displayClock || '15:00').split(':').map(Number);
  const secsLeftInPeriod = (clock[0] || 0) * 60 + (clock[1] || 0);
  const secsElapsed = (period - 1) * 900 + Math.max(0, 900 - secsLeftInPeriod);
  return Math.min(1, Math.max(0, secsElapsed / 3600));
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

// Raw per-player stat line for one game, in exactly the shape the client's
// _nflRawLine()/nflTick() write to lastNight (index.html) - the hero panel's
// "Last game" tiles and the Last 10 log read these individual fields. Keep in
// sync with the client; a field renamed on one side blanks a tile on the other.
function mergeRawLine(cat, labels, stats, into) {
  const n = i => parseFloat((stats[i] || '0').toString().replace(/[^0-9.\-]/g, '')) || 0;
  const byLabel = name => {
    const idx = (labels || []).findIndex(l => (l || '').toUpperCase() === name);
    return idx >= 0 ? (stats[idx] || '0').toString() : null;
  };
  const num = v => (v == null ? 0 : parseFloat(v.replace(/[^0-9.\-]/g, '')) || 0);
  if (cat === 'passing') {
    into.py = (into.py || 0) + n(1); into.ptd = (into.ptd || 0) + n(3); into.ints = (into.ints || 0) + n(4);
  } else if (cat === 'rushing') {
    into.car = (into.car || 0) + n(0); into.ry = (into.ry || 0) + n(1); into.rtd = (into.rtd || 0) + n(3);
  } else if (cat === 'receiving') {
    into.rec = (into.rec || 0) + n(0); into.recy = (into.recy || 0) + n(1);
    into.rectd = (into.rectd || 0) + n(3); into.tgt = (into.tgt || 0) + n(5);
  } else if (cat === 'defensive' || cat === 'interceptions') {
    const get = names => { for (const nm of names) { const v = byLabel(nm); if (v != null) return num(v); } return 0; };
    into.tkl = (into.tkl || 0) + (get(['TOT', 'TACK', 'TCKL']) || get(['SOLO']));
    into.sack = (into.sack || 0) + get(['SACK', 'SCK']);
    into.defint = (into.defint || 0) + (cat === 'interceptions' ? get(['INT']) : 0);
    into.ffum = (into.ffum || 0) + get(['FF']);
    into.deftd = (into.deftd || 0) + get(['TD']);
  } else if (cat === 'fumbles') {
    into.fuml = (into.fuml || 0) + num(byLabel('LOST'));
  } else if (cat === 'kicking') {
    const frac = name => {
      const [m, a] = (byLabel(name) || '0/0').split('/').map(x => parseInt(x) || 0);
      return { m: m || 0, a: a || (m || 0) };
    };
    const fg = frac('FG'), xp = frac('XP');
    into.fgm = (into.fgm || 0) + fg.m; into.fga = (into.fga || 0) + fg.a;
    into.xpm = (into.xpm || 0) + xp.m; into.xpa = (into.xpa || 0) + xp.a;
  }
  return into;
}

// The DISPLAY fantasy score shown beside that line - the client's
// _nflFptsFromRaw weights, not this worker's pricing weights above.
export function displayFpts(s) {
  const v = (s.py || 0) * 0.04 + (s.ptd || 0) * 4 - (s.ints || 0) * 2
    + (s.ry || 0) * 0.1 + (s.rtd || 0) * 6
    + (s.rec || 0) * 0.5 + (s.recy || 0) * 0.1 + (s.rectd || 0) * 6
    - (s.fuml || 0) * 2
    + (s.tkl || 0) * 1 + (s.sack || 0) * 2 + (s.defint || 0) * 3 + (s.ffum || 0) * 2 + (s.deftd || 0) * 6
    + (s.fgm || 0) * 3 + (s.xpm || 0) * 1;
  return Math.round(v * 10) / 10;
}

// Returns { normalizedName -> rawStatLine } from an ESPN summary response.
export function extractNflRawLines(summary) {
  const out = {};
  for (const tm of summary?.boxscore?.players || []) {
    for (const cat of tm.statistics || []) {
      if (!['passing', 'rushing', 'receiving', 'defensive', 'interceptions', 'kicking', 'fumbles'].includes(cat.name)) continue;
      for (const a of cat.athletes || []) {
        const nm = a.athlete?.displayName;
        if (!nm) continue;
        const key = normalizeName(nm);
        mergeRawLine(cat.name, cat.labels, a.stats || [], out[key] || (out[key] = {}));
      }
    }
  }
  return out;
}

// The config/lastNight entry for one finished game.
export function lastNightEntry(line, date) {
  return { played: true, date, live: false, nfl: true, fpts: displayFpts(line),
    ts: Date.parse(date + 'T20:00:00-05:00'), ...line };
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
