// Golf is the stateful, tricky one: ESPN never gives a raw "today's round"
// number, only a cumulative tournament score-to-par. Today's round has to be
// derived as the delta between today's cumulative and the last one we have on
// file - which means, unlike the other three leagues, golf pricing depends on
// history we persisted ourselves, not just today's fetch. Ported as closely as
// possible to index.html's fetchGolfLiveStats (~9533-9784), including its
// known limitation: a daily close only gets locked in when ESPN marks the
// whole EVENT completed (typically Sunday), not after each individual round -
// so Thu/Fri/Sat rounds move the live price but are never finalized into
// `closes` until the tournament ends. That's existing client behavior, not
// something introduced by this port.
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga';

export function normalizeName(n) {
  return (n || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchScoreboard() {
  const res = await fetch(`${BASE}/scoreboard`);
  if (!res.ok) throw new Error(`ESPN golf scoreboard fetch failed: ${res.status}`);
  return res.json();
}

function parseScore(sc) {
  if (typeof sc === 'string') {
    if (/^e$/i.test(sc.trim())) return 0;
    const n = parseInt(sc.replace('+', ''));
    return isNaN(n) ? null : n;
  }
  if (typeof sc === 'number') return sc;
  return null;
}

// Returns { relevantEvents, isLive, isComplete, byName } where byName maps
// normalizedName -> { cumToPar, thru, rounds, posName, evDate, evLive }.
export function extractCompetitors(sb, todayStr) {
  const events = sb?.events || [];
  const relevantEvents = events.filter(e => {
    const st = e.status?.type;
    return st && (st.state === 'in' || st.completed === true);
  });
  const eventsToProcess = relevantEvents.length ? relevantEvents : events.slice(0, 1);
  const anyLive = eventsToProcess.some(e => e.status?.type?.state === 'in');
  const isComplete = !anyLive && eventsToProcess.some(e => e.status?.type?.completed === true);

  const byName = {};
  for (const ev of eventsToProcess) {
    const evLive = ev.status?.type?.state === 'in';
    let evDate = todayStr;
    const rawDate = ev.competitions?.[0]?.date || ev.date || ev.endDate;
    if (rawDate) {
      const d = new Date(rawDate);
      if (!isNaN(d)) evDate = d.toISOString().slice(0, 10);
    }
    if (evLive) evDate = todayStr;

    const comp = ev.competitions?.[0];
    const competitors = comp?.competitors || ev.competitors || [];
    for (const c of competitors) {
      const nm = normalizeName(c.athlete?.displayName || c.athlete?.fullName || c.displayName);
      if (!nm) continue;
      let cumToPar = parseScore(c.score ?? c.statistics?.find?.(s => /score|topar/i.test(s.name))?.value);
      if (cumToPar != null && (cumToPar < -30 || cumToPar > 30)) cumToPar = null;

      const posName = c.status?.position?.displayName || c.status?.position?.id
        || (c.status?.position != null ? String(c.status.position) : null);
      const thru = c.status?.thru != null ? c.status.thru : (c.status?.hole != null ? c.status.hole : null);
      const rounds = (c.linescores || []).length;

      const existing = byName[nm];
      const candidate = { cumToPar, thru, rounds, posName, evDate, evLive };
      if (!existing) byName[nm] = candidate;
      else if (existing.posName == null && posName != null) byName[nm] = { ...existing, ...candidate };
    }
  }
  return { eventsToProcess, isLive: anyLive, isComplete, byName };
}

// Field average round, relative to which every priced golfer's round is
// judged (par is a fixed yardstick, the field is the real one). Needs >= 8
// samples to trust, else falls back to 0 (par). `cumHxByRank` is trusted,
// server-persisted cumulative history for OUR rostered golfers only (Firestore-
// backed) - matches the client's approach of using stored history where
// available and raw cumulative otherwise.
export function computeFieldAverage(byName, rankByNormName, cumHxByRank) {
  const fieldRounds = [];
  for (const [nm, rec] of Object.entries(byName)) {
    if (!rec || rec.cumToPar == null) continue;
    const played = (rec.thru != null && rec.thru > 0) || rec.rounds > 0 || rec.cumToPar !== 0;
    if (!played) continue;
    let r = rec.cumToPar;
    const rk = rankByNormName[nm];
    const hx = rk != null ? cumHxByRank[rk] : null;
    if (hx) {
      const priorDates = Object.keys(hx).filter(d => d < (rec.evDate)).sort();
      if (priorDates.length) r = rec.cumToPar - hx[priorDates[priorDates.length - 1]];
    }
    if (r >= -13 && r <= 18) fieldRounds.push(r);
  }
  if (fieldRounds.length < 8) return 0;
  return fieldRounds.reduce((a, b) => a + b, 0) / fieldRounds.length;
}

// For one rostered golfer: derive today's round-to-par delta from their own
// cumulative history, clamp to a realistic single round, and return both the
// stat to feed the engine and the updated history to persist.
export function deriveRoundForGolfer(rec, cumHxForRank) {
  const cum = rec.cumToPar;
  if (cum == null) return null;
  const startedPlay = (rec.thru != null && rec.thru > 0) || rec.rounds > 0 || cum !== 0;
  if (!startedPlay) return null;

  const hx = { ...(cumHxForRank || {}) };
  const roundDate = rec.evDate;
  const priorDates = Object.keys(hx).filter(d => d < roundDate).sort();
  const hasPrior = priorDates.length > 0;
  const priorCum = hasPrior ? hx[priorDates[priorDates.length - 1]] : null;

  let tp = hasPrior ? cum - priorCum : cum;
  tp = Math.max(-13, Math.min(18, tp));
  tp = Math.round(tp);

  hx[roundDate] = cum;
  return { toPar: tp, date: roundDate, updatedHx: hx };
}
