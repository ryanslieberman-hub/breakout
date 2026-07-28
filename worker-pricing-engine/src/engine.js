// Ported from index.html's `const ENGINE = (() => {...})()` (NBA slice only).
// Kept as close to verbatim as the stateless Worker environment allows - the
// only real change is that `BASE`/`closes` are passed in (backed by
// Firestore) instead of living in module-level vars backed by localStorage,
// since a Worker has no persistent memory between invocations.
//
// ONE RULE: price = base × (1 + todayPerf)

const MULT = { S: 1.35, A: 0.44, B: 0.10, C: 0.04, D: 0.018 };
const PRICE_SCALE = 1;

const UP = { S: 0.045, A: 0.048, B: 0.052, C: 0.056, D: 0.060 };
const DOWN = { S: 0.036, A: 0.038, B: 0.041, C: 0.044, D: 0.048 };
const CAP = 0.20;

export function statPrice(p) {
  return Math.max(0.01, (p.ppg * 10 + p.apg * 7 + p.rpg * 5) * MULT[p.tier] * PRICE_SCALE);
}

export function band(p) {
  return [p.statPrice * 0.55, p.statPrice * 1.7];
}

function bound(p, raw) {
  const perf = Math.sign(raw) * Math.pow(Math.abs(raw), 0.75);
  const scaled = perf >= 0 ? perf * (UP[p.tier] || 0.05) : perf * (DOWN[p.tier] || 0.04);
  return Math.max(-CAP, Math.min(CAP, scaled));
}

// s: { pts, reb, ast, stl, blk, tov, min }
export function nbaPerf(p, s) {
  if (!s) return 0;
  const min = s.min || 0;
  if (min < 1) return 0;
  const expPts = p.ppg || 0, expReb = p.rpg || 0, expAst = p.apg || 0;
  const ptsT = ((s.pts || 0) - expPts) / Math.max(expPts, 8);
  const rebT = ((s.reb || 0) - expReb) / Math.max(expReb, 4);
  const astT = ((s.ast || 0) - expAst) / Math.max(expAst, 3);
  const extras = ((s.stl || 0) + (s.blk || 0)) * 0.05 - (s.tov || 0) * 0.03;
  const raw = ptsT * 0.45 + rebT * 0.25 + astT * 0.25 + extras;
  return bound(p, raw);
}

// today's opening price: validated prior close, else fundamental stat price. Never liveP.
// `closesForRank` = { 'YYYY-MM-DD': price }, `baseRecord` = { date, price } | null
export function baseFor(p, today, closesForRank, baseRecord) {
  const [lo, hi] = band(p);
  if (baseRecord && baseRecord.date === today && baseRecord.price >= lo && baseRecord.price <= hi) {
    return { base: baseRecord.price, newBaseRecord: baseRecord };
  }
  const c = closesForRank || {};
  const priorValid = Object.keys(c)
    .filter(d => d < today && c[d] >= lo && c[d] <= hi)
    .sort();
  let base = priorValid.length ? c[priorValid[priorValid.length - 1]] : p.statPrice;
  base = Math.min(Math.max(base, lo), hi);
  return { base, newBaseRecord: { date: today, price: base } };
}

// The single price computation. Returns the live price for today given a
// stat line (or null for no game). Does not mutate anything - caller decides
// what to persist.
export function price(p, stat, today, closesForRank, baseRecord) {
  const { base, newBaseRecord } = baseFor(p, today, closesForRank, baseRecord);
  const perf = stat ? nbaPerf(p, stat) : nbaPerf(p, null);
  const val = Math.max(0.01, base * (1 + (perf || 0)));
  return { value: val, base, newBaseRecord };
}

// Locks today's price as today's close, applying the ±15%/day-vs-prior-close
// cap (history-dependent - must be called in date order across a backfill).
export function finalize(liveValue, dateStr, closesForRank) {
  const prior = closesForRank || {};
  const pds = Object.keys(prior).filter(d => d < dateStr && prior[d] > 0).sort();
  let val = liveValue;
  if (pds.length) {
    const prev = prior[pds[pds.length - 1]];
    const maxUp = prev * 1.15, maxDown = prev * 0.85;
    val = Math.min(maxUp, Math.max(maxDown, val));
  }
  return val;
}
