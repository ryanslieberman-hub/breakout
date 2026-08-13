// Official MLB Stats API - no CORS proxy needed server-side (this is what
// the client itself uses directly too, since MLB's API allows browser CORS).
const API_BASE = 'https://statsapi.mlb.com/api/v1';

export function normalizeName(n) {
  return (n || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns { live: [gamePk...], final: [gamePk...] }
export async function fetchSchedule(dateStr) {
  const res = await fetch(`${API_BASE}/schedule?sportId=1&date=${dateStr}&hydrate=team`);
  if (!res.ok) throw new Error(`MLB schedule fetch failed: ${res.status}`);
  const data = await res.json();
  const out = { live: [], final: [] };
  for (const d of data.dates || []) {
    for (const g of d.games || []) {
      const state = g.status?.abstractGameState;
      if (state === 'Live') out.live.push(g.gamePk);
      else if (state === 'Final') out.final.push(g.gamePk);
    }
  }
  return out;
}

// Returns an array of stat rows: hitters get {h,hr,rbi,ab,k,bb,errors,dp,assists,cs,pos},
// pitchers get {ip,kp,er,bb,h}, matched against `rosterByName` (normalized name -> {rank, role}).
export async function fetchBoxscore(gamePk, rosterByName) {
  const res = await fetch(`${API_BASE}/game/${gamePk}/boxscore`);
  if (!res.ok) throw new Error(`MLB boxscore fetch failed (${gamePk}): ${res.status}`);
  const data = await res.json();
  const results = [];
  for (const side of ['home', 'away']) {
    const players = data.teams?.[side]?.players || {};
    for (const pl of Object.values(players)) {
      const full = pl.person?.fullName;
      const rp = rosterByName[normalizeName(full)];
      if (!rp) continue;
      const bat = pl.stats?.batting || {};
      const pit = pl.stats?.pitching || {};
      const fld = pl.stats?.fielding || {};
      const posAbbr = pl.position?.abbreviation || '';
      const isPitcher = rp.role === 'SP' || rp.role === 'RP';
      if (isPitcher && pit.inningsPitched != null) {
        results.push({
          rank: rp.rank,
          ip: parseFloat(pit.inningsPitched) || 0,
          kp: pit.strikeOuts || 0,
          er: pit.earnedRuns || 0,
          bb: pit.baseOnBalls || 0,
          h: pit.hits || 0,
        });
      } else if (!isPitcher && (bat.atBats != null || bat.baseOnBalls != null)) {
        results.push({
          rank: rp.rank,
          h: bat.hits || 0,
          hr: bat.homeRuns || 0,
          rbi: bat.rbi || 0,
          ab: bat.atBats || 0,
          k: bat.strikeOuts || 0,
          bb: bat.baseOnBalls || 0,
          errors: fld.errors || 0,
          dp: fld.doublePlays || 0,
          assists: fld.assists || 0,
          cs: fld.caughtStealing || 0,
          pos: posAbbr,
        });
      }
    }
  }
  return results;
}

// Daily season-stat refresh: iterates all 30 teams' active rosters (hydrated
// with season hitting/pitching stats) and returns { normalizedName -> {avg,
// hr, rbi, ops} | {era, kper9, ipp} }. mlbStatPrice's inputs (avg/hr/rbi/ops
// for hitters, era/kper9/ipp for pitchers) drift daily this way, same as the
// client - `statPrice` itself is never recomputed from this refresh.
export async function fetchSeasonStats(season) {
  const teamsRes = await fetch('https://statsapi.mlb.com/api/v1/teams?sportId=1');
  if (!teamsRes.ok) throw new Error(`MLB teams fetch failed: ${teamsRes.status}`);
  const teamsData = await teamsRes.json();
  const statMap = {};

  for (const t of teamsData.teams || []) {
    const url = `${API_BASE}/teams/${t.id}/roster?rosterType=active&hydrate=person(stats(group=[hitting,pitching],type=[season],season=${season}))`;
    let rd;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      rd = await res.json();
    } catch (e) { continue; }

    for (const entry of rd.roster || []) {
      const per = entry.person || {};
      if (!per.fullName) continue;
      const splits = (per.stats || []).flatMap(s => (s.splits || []).map(sp => ({ stat: sp.stat })));
      const hitStat = splits.find(s => s.stat && (s.stat.avg != null || s.stat.homeRuns != null) && s.stat.era == null)?.stat;
      const pitStat = splits.find(s => s.stat && s.stat.era != null)?.stat;
      const out = {};
      if (hitStat) {
        if (hitStat.avg != null) out.avg = parseFloat(hitStat.avg);
        if (hitStat.homeRuns != null) out.hr = +hitStat.homeRuns;
        if (hitStat.rbi != null) out.rbi = +hitStat.rbi;
        if (hitStat.ops != null) out.ops = parseFloat(hitStat.ops);
      }
      if (pitStat) {
        const era = parseFloat(pitStat.era), ip = parseFloat(pitStat.inningsPitched), so = +pitStat.strikeOuts;
        if (!isNaN(era)) out.era = era;
        if (!isNaN(ip) && ip > 0 && !isNaN(so)) out.kper9 = Math.round((so * 9 / ip) * 10) / 10;
        if (!isNaN(ip)) {
          const gs = +pitStat.gamesStarted || +pitStat.gamesPitched || 1;
          if (gs > 0) out.ipp = Math.round((ip / gs) * 10) / 10;
        }
      }
      if (Object.keys(out).length) statMap[normalizeName(per.fullName)] = out;
    }
  }
  return statMap;
}

// Fetches several games and merges into { rank: statRow }, summing counting
// stats for players who played a doubleheader (two games same day) instead of
// letting the second game silently overwrite the first.
//
// Also stamps each player's row with `final` - true only once EVERY game that
// player appears in (all of, for a doubleheader) is final. This must be
// computed per-player, not once for the whole day's slate: MLB slates are
// staggered (afternoon games finish hours before West Coast night games), so
// gating on "is the entire day final" meant closes almost never got written
// for anyone, even players whose own game ended hours earlier - silently
// freezing their price/close history (stale 1W/1M %, frozen portfolio-summary
// value, spurious mover alerts off a stale anchor).
export async function fetchBoxscores(gamePks, rosterByName, finalGamePks) {
  const map = {};
  const gamesByRank = {};
  const settled = await Promise.allSettled(
    gamePks.map(pk => fetchBoxscore(pk, rosterByName).then(rows => ({ pk, rows })))
  );
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const { pk, rows } = s.value;
    for (const st of rows) {
      const prior = map[st.rank];
      if (!prior) { map[st.rank] = st; }
      else {
        const add = k => (prior[k] || 0) + (st[k] || 0);
        map[st.rank] = {
          ...prior,
          h: add('h'), hr: add('hr'), rbi: add('rbi'), ab: add('ab'), k: add('k'), bb: add('bb'),
          ip: add('ip'), kp: add('kp'), er: add('er'),
        };
      }
      (gamesByRank[st.rank] || (gamesByRank[st.rank] = new Set())).add(pk);
    }
  }
  if (finalGamePks) {
    for (const rank of Object.keys(map)) {
      map[rank].final = [...gamesByRank[rank]].every(pk => finalGamePks.has(pk));
    }
  }
  return map;
}
