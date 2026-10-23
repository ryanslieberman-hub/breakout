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

// ESPN reports each round as a linescore: displayValue is that round's score to
// par ("-3", "E", "+2", or "-" if not started) and its nested linescores are
// one entry per hole played. That is the only trustworthy per-round signal -
// the competitor-level score is the whole tournament's cumulative, and
// deriving a round from it (cum minus a stored prior) produced a phantom
// whole-tournament "round" whenever no prior was on file (first sighting
// mid-event, or history left over from last week's event).
export function parseRounds(c) {
  const out = [];
  for (const l of c.linescores || []) {
    const holes = (l.linescores || []).length;
    if (!holes) continue;
    const dv = l.displayValue;
    let toPar = null;
    if (typeof dv === 'string') toPar = /^e$/i.test(dv.trim()) ? 0 : parseScore(dv);
    if (toPar == null) continue;
    out.push({ period: l.period ?? out.length + 1, toPar, holes });
  }
  return out;
}

function easternDate(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Returns { eventsToProcess, isLive, isComplete, currentPeriod, byName } where
// byName maps normalizedName -> { cumToPar, rounds: [{period,toPar,holes}],
// posName, evStart, evLive }.
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
  let currentPeriod = 0;
  for (const ev of eventsToProcess) {
    const evLive = ev.status?.type?.state === 'in';
    const rawDate = ev.competitions?.[0]?.date || ev.date;
    const t = rawDate ? new Date(rawDate).getTime() : NaN;
    const evStart = isNaN(t) ? todayStr : easternDate(t);

    const comp = ev.competitions?.[0];
    const competitors = comp?.competitors || ev.competitors || [];
    for (const c of competitors) {
      const nm = normalizeName(c.athlete?.displayName || c.athlete?.fullName || c.displayName);
      if (!nm) continue;
      let cumToPar = parseScore(c.score ?? c.statistics?.find?.(s => /score|topar/i.test(s.name))?.value);
      if (cumToPar != null && (cumToPar < -30 || cumToPar > 30)) cumToPar = null;

      const posName = c.status?.position?.displayName || c.status?.position?.id
        || (c.status?.position != null ? String(c.status.position) : null);
      const rounds = parseRounds(c);
      for (const r of rounds) currentPeriod = Math.max(currentPeriod, r.period);

      const existing = byName[nm];
      const candidate = { cumToPar, rounds, posName, evStart, evLive };
      if (!existing) byName[nm] = candidate;
      else if (existing.posName == null && posName != null) byName[nm] = { ...existing, ...candidate };
    }
  }
  return { eventsToProcess, isLive: anyLive, isComplete, currentPeriod, byName };
}

function currentRound(rec, currentPeriod) {
  return (rec.rounds || []).find(r => r.period === currentPeriod) || null;
}

// Field's average strokes-to-par PER HOLE in the current round, across every
// golfer in the event (not just rostered ones). Per hole rather than per
// round so golfers mid-round are judged against what the field shot over the
// same number of holes. Needs >= 8 samples to trust, else 0 (par).
export function computeFieldRate(byName, currentPeriod) {
  let strokes = 0, holes = 0, n = 0;
  for (const rec of Object.values(byName)) {
    const r = rec && currentRound(rec, currentPeriod);
    if (!r) continue;
    strokes += r.toPar; holes += r.holes; n++;
  }
  return n >= 8 && holes > 0 ? strokes / holes : 0;
}

// For one rostered golfer: today's round to par + holes played, straight from
// ESPN's linescores. `roundDay` ({ period -> date first counted }) is the only
// persisted state: a COMPLETED round must stop counting once its day is over,
// otherwise Friday morning would re-price Thursday's finished round on top of
// Thursday's move. Returns null when there is nothing to price today (hasn't
// teed off, missed the cut, or the latest round belongs to an earlier day).
export function deriveRoundForGolfer(rec, currentPeriod, roundDay, todayStr) {
  const r = currentRound(rec, currentPeriod);
  if (!r) return null;
  const days = { ...(roundDay || {}) };
  if (days[r.period]) {
    if (days[r.period] !== todayStr) return null;
  } else {
    const scheduled = addDays(rec.evStart, r.period - 1);
    if (!(r.holes < 18 || scheduled >= todayStr)) return null;
    days[r.period] = todayStr;
  }
  const toPar = Math.round(Math.max(-13, Math.min(18, r.toPar)));
  return { toPar, holes: r.holes, period: r.period, date: todayStr, updatedRoundDay: days };
}
