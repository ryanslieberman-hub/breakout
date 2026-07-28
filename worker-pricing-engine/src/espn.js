// Server-side ESPN fetches for NBA - no CORS proxy needed here (that only
// exists client-side to work around browser CORS; a Worker can call ESPN
// directly).

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

export async function fetchScoreboard(dateYYYYMMDD) {
  const res = await fetch(`${BASE}/scoreboard?dates=${dateYYYYMMDD}&limit=20`);
  if (!res.ok) throw new Error(`ESPN scoreboard fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchSummary(eventId) {
  const res = await fetch(`${BASE}/summary?event=${eventId}`);
  if (!res.ok) throw new Error(`ESPN summary fetch failed: ${res.status}`);
  return res.json();
}

function normalizeName(name) {
  return (name || '').toLowerCase().trim().replace(/[.'-]/g, '').replace(/\s+/g, ' ');
}

// Extracts { normalizedName -> { pts, reb, ast, stl, blk, tov, min } } from an
// ESPN summary response, using the response's own `labels` array to locate
// each stat by name rather than a hardcoded index (ESPN's column order isn't
// guaranteed stable).
export function extractNbaBoxScoreStats(summary) {
  const out = {};
  const groups = summary?.boxscore?.players || [];
  for (const teamGroup of groups) {
    for (const statBlock of teamGroup.statistics || []) {
      const labels = (statBlock.labels || statBlock.names || []).map(l => l.toUpperCase());
      const idx = {
        MIN: labels.indexOf('MIN'),
        PTS: labels.indexOf('PTS'),
        REB: labels.indexOf('REB'),
        AST: labels.indexOf('AST'),
        STL: labels.indexOf('STL'),
        BLK: labels.indexOf('BLK'),
        TO: labels.indexOf('TO'),
      };
      for (const athleteRow of statBlock.athletes || []) {
        const name = athleteRow.athlete?.displayName;
        if (!name) continue;
        const stats = athleteRow.stats || [];
        const num = i => (i >= 0 && stats[i] != null ? parseFloat(stats[i]) || 0 : 0);
        const minStr = idx.MIN >= 0 ? stats[idx.MIN] : '0';
        const min = minStr && minStr !== '--' ? parseFloat(minStr) || 0 : 0;
        out[normalizeName(name)] = {
          min,
          pts: num(idx.PTS),
          reb: num(idx.REB),
          ast: num(idx.AST),
          stl: num(idx.STL),
          blk: num(idx.BLK),
          tov: num(idx.TO),
        };
      }
    }
  }
  return out;
}

export { normalizeName };
