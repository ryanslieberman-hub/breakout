// Daily NBA season-average refresh (ppg/rpg/apg), matching the client's own
// daily cadence (index.html ~12830-12874). This updates the perf-formula's
// "expected" baseline; `statPrice` intentionally stays frozen at whatever
// ppg/rpg/apg were at initial load, matching current client behavior.
const API = 'https://api.balldontlie.io/v1/season_averages';

function normalizeName(name) {
  return (name || '').toLowerCase().trim().replace(/[.'-]/g, '').replace(/\s+/g, ' ');
}

// Returns { normalizedName -> { ppg, rpg, apg } }
export async function fetchSeasonAverages(season, apiKey) {
  const headers = apiKey ? { Authorization: apiKey } : {};
  const res = await fetch(`${API}?season=${season}&per_page=400`, { headers });
  if (!res.ok) throw new Error(`balldontlie fetch failed: ${res.status}`);
  const json = await res.json();
  const out = {};
  for (const row of json.data || []) {
    const name = `${row.player?.first_name || ''} ${row.player?.last_name || ''}`.trim();
    if (!name) continue;
    out[normalizeName(name)] = { ppg: row.pts || 0, rpg: row.reb || 0, apg: row.ast || 0 };
  }
  return out;
}

export { normalizeName };
