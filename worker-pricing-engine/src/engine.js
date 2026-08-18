// Ported from index.html's `const ENGINE = (() => {...})()`, all four
// leagues. Kept as close to verbatim as the stateless Worker environment
// allows - the only real change is that `BASE`/`closes` (and, for MLB
// pitchers, `pitcherLastStart`) are passed in (backed by Firestore) instead
// of living in module-level vars backed by localStorage, since a Worker has
// no persistent memory between invocations.
//
// ONE RULE: price = base × (1 + todayPerf)

const MULT = { S: 1.35, A: 0.44, B: 0.10, C: 0.04, D: 0.018 };
const PRICE_SCALE = 1;

const UP = { S: 0.045, A: 0.048, B: 0.052, C: 0.056, D: 0.060 };
const DOWN = { S: 0.036, A: 0.038, B: 0.041, C: 0.044, D: 0.048 };
const CAP = 0.20;

// ── Fundamental / statPrice, per league ──
export function nbaStatPrice(p) {
  return Math.max(0.01, (p.ppg * 10 + p.apg * 7 + p.rpg * 5) * MULT[p.tier] * PRICE_SCALE);
}

export function mlbStatPrice(p) {
  if (p.role === 'H') {
    const raw = (p.ops || 0.700) * 200 + (p.hr || 0) * 3 + (p.rbi || 0) * 0.8;
    return Math.max(0.01, raw * MULT[p.tier] * PRICE_SCALE);
  }
  const eraFactor = Math.max(0.1, 6.5 - (p.era || 4.5));
  const kFactor = 1 + ((p.kper9 || 8) - 8) / 20;
  const ipFactor = p.role === 'RP' ? 0.5 : (p.ipp || 5.5) / 6;
  const raw = eraFactor * kFactor * ipFactor * 80;
  return Math.max(0.01, raw * MULT[p.tier] * PRICE_SCALE);
}

export function golfStatPrice(p) {
  const sgFactor = 1 + (p.sg || 0) * 0.6;
  const scoreFactor = Math.max(0.2, 73 - (p.scoring || 71));
  const fedexFactor = 1 + Math.max(0, (60 - (p.fedex || 60))) / 60;
  const winBonus = 1 + (p.wins || 0) * 0.05;
  const raw = scoreFactor * sgFactor * fedexFactor * winBonus * 22;
  return Math.max(0.01, raw * MULT[p.tier] * PRICE_SCALE);
}

// NFL's raw formula below borrows real fantasy-scoring weights, which top out
// around 15-20 raw points for a great QB/RB/WR game - NBA/MLB/Golf's formulas
// were each independently tuned so a tier-S superstar lands around $400-900
// (Jokic $586, Ohtani $645, Scheffler $885), but NFL's never got that same
// tuning pass and left every NFL player under $25 regardless of how good they
// were (Lamar Jackson priced at $22, next to nobody). NFL_SCALE closes that
// gap without touching the per-position weights, which already balance
// QB/RB/WR/TE reasonably against each other - it just moves the whole NFL
// price curve up to the same range every other league already sits in.
const NFL_SCALE = 25;
export function nflStatPrice(p) {
  let raw = 0;
  const r = p.role;
  if (r === 'QB') raw = (p.py || 0) * 0.04 + (p.ptd || 0) * 4 - (p.ints || 0) * 2 + (p.ry || 0) * 0.1;
  else if (r === 'RB') raw = (p.ry || 0) * 0.1 + (p.rtd || 0) * 6 + (p.rec || 0) * 1 + (p.recy || 0) * 0.1;
  else if (r === 'WR') raw = (p.rec || 0) * 1 + (p.recy || 0) * 0.1 + (p.rtd || 0) * 6;
  else if (r === 'TE') raw = (p.rec || 0) * 1 + (p.recy || 0) * 0.1 + (p.rtd || 0) * 6;
  else if (r === 'K') raw = (p.fgm || 0) * 3 + (p.xpm || 0) * 1;
  else raw = (p.tkl || 0) * 1 + (p.sack || 0) * 4 + (p.defint || 0) * 6; // DEF
  const within = (p.rank || 3001) - 3001;
  const spread = Math.max(0.35, 1 - within * 0.006);
  return Math.max(0.01, raw * (MULT[p.tier] || 1) * PRICE_SCALE * spread * NFL_SCALE);
}

export function statPriceFor(league, p) {
  if (league === 'nba') return nbaStatPrice(p);
  if (league === 'mlb') return mlbStatPrice(p);
  if (league === 'golf') return golfStatPrice(p);
  if (league === 'nfl') return nflStatPrice(p);
  throw new Error(`Unknown league: ${league}`);
}

export function band(p) {
  return [p.statPrice * 0.55, p.statPrice * 1.7];
}

function bound(p, raw) {
  const perf = Math.sign(raw) * Math.pow(Math.abs(raw), 0.75);
  const scaled = perf >= 0 ? perf * (UP[p.tier] || 0.05) : perf * (DOWN[p.tier] || 0.04);
  return Math.max(-CAP, Math.min(CAP, scaled));
}

// ── Performance functions, per league ──

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

// s: { ab, h, hr, rbi, k, bb, errors, dp, cs, assists, pos }
export function mlbHitterPerf(p, s) {
  if (!s) return 0;
  const ab = parseInt(s.ab) || 0, bb = s.bb || 0;
  if (ab < 1 && bb < 1) return 0;
  const h = s.h || 0, hr = s.hr || 0, rbi = s.rbi || 0, k = s.k || 0;

  let avgT = 0;
  if (ab >= 1) {
    const avg = h / ab;
    avgT = (avg - (p.avg || 0.260)) / Math.max(p.avg || 0.260, 0.1);
    if (ab < 3) avgT *= (ab / 3);
  }

  let raw = h * 0.22 + rbi * 0.18 + hr * 0.30 + bb * 0.06 + avgT * 0.25 - k * 0.11;
  raw -= Math.max(0, ab - h) * 0.035;
  if (ab >= 3 && h === 0) raw -= (0.10 + ab * 0.02);

  const pos = (s.pos || '').toUpperCase();
  const errors = s.errors || 0, dp = s.dp || 0, cs = s.cs || 0, assists = s.assists || 0;
  if (pos !== 'DH' && pos !== 'PH') {
    const premium = /(^C$|SS|2B|CF)/.test(pos) ? 1.0 : /(3B|LF|RF)/.test(pos) ? 0.5 : 0.35;
    let defRaw = 0;
    defRaw -= errors * 0.10;
    defRaw += dp * 0.05 * premium;
    defRaw += cs * 0.10;
    if (/(SS|2B|3B|^C$)/.test(pos)) defRaw += Math.min(assists, 5) * 0.012 * premium;
    raw += defRaw * 0.6;
  }

  const HIT_DOWN = { S: 0.043, A: 0.046, B: 0.049, C: 0.053, D: 0.058 };
  const perf = Math.sign(raw) * Math.pow(Math.abs(raw), 0.75);
  const scaled = perf >= 0 ? perf * (UP[p.tier] || 0.05) : perf * (HIT_DOWN[p.tier] || 0.049);
  return Math.max(-CAP, Math.min(CAP, scaled));
}

// s: { ip, kp, er, bb, h }. `pitcherLastStartDate` is this pitcher's own
// persisted last-start date (YYYY-MM-DD), needed for rotation-cycle drift on
// non-start days.
export function mlbPitcherPerf(p, s, todayStr, pitcherLastStartDate) {
  if (!s) return startAnticipation(p, todayStr, pitcherLastStartDate);
  const ip = parseFloat(s.ip) || 0;
  if (ip < 1) return startAnticipation(p, todayStr, pitcherLastStartDate);
  const k = s.kp || 0, er = s.er || 0;
  const eraPace = er * 9 / ip;
  const eraT = ((p.era || 4.5) - eraPace) / 4.5;
  const kT = ((k * 9 / ip) - (p.kper9 || 8)) / 8 + (k * 0.04);
  const ipT = Math.max(0, (ip - (p.ipp || 5.5)) / 9);
  const shutoutBonus = (er === 0 && ip >= 3) ? (0.06 + ip * 0.02) : 0;
  const raw = eraT * 0.42 + kT * 0.34 + ipT * 0.24 + shutoutBonus;
  const PITCH_UP = { S: 0.075, A: 0.070, B: 0.078, C: 0.085, D: 0.092 };
  const perf = Math.sign(raw) * Math.pow(Math.abs(raw), 0.75);
  const scaled = perf >= 0 ? perf * (PITCH_UP[p.tier] || 0.078) : perf * (DOWN[p.tier] || 0.04);
  return Math.max(-CAP, Math.min(CAP, scaled));
}

export function startAnticipation(p, todayStr, pitcherLastStartDate) {
  if (p.role !== 'SP') return 0;
  if (!pitcherLastStartDate) return 0;
  const days = Math.round((new Date(todayStr) - new Date(pitcherLastStartDate)) / 86400000);
  if (days === 4) return 0.006;
  if (days === 5) return 0.012;
  if (days === 6) return 0.008;
  if (days >= 7) return -0.006;
  return 0;
}

// s: { toPar }, today's round relative to par (a delta, NOT tournament
// cumulative). `fieldAvg` is the field's average round that day (0 if no
// reliable sample - see golf.js for how this is computed/snapshotted).
export function golfPerf(p, s, fieldAvg) {
  if (s == null || s.toPar == null) return 0;
  const vsField = (fieldAvg || 0) - s.toPar;
  if (vsField === 0) return 0;
  const under = Math.max(0, vsField), over = Math.max(0, -vsField);
  const upRaw = (under * 0.0115) * (1 + under * 0.022);
  const downRaw = -(over * 0.009) * (1 + over * 0.015);
  let move = upRaw + downRaw;
  const upScale = { S: 1.00, A: 1.06, B: 1.13, C: 1.22, D: 1.32 }[p.tier] || 1.1;
  const downScale = { S: 0.85, A: 0.92, B: 1.00, C: 1.08, D: 1.16 }[p.tier] || 1.0;
  move = move >= 0 ? move * upScale : move * downScale;
  return Math.max(-0.15, Math.min(0.22, move));
}

// stat: { fpts } - this game's synthesized fantasy points (see nfl.js).
export function nflPerf(p, stat) {
  if (!stat) return 0;
  const base = p.fpts || 8;
  const got = stat.fpts != null ? stat.fpts : base;
  const rel = (got - base) / Math.max(base, 4);
  return bound(p, rel);
}

// ── Shared engine mechanics (league-agnostic) ──

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

// Generic price computation - `perf` is a precomputed number (the caller
// picks the right perf function for the league/role; some, like MLB pitcher,
// need extra args golf/NBA don't).
export function priceFromPerf(p, perf, today, closesForRank, baseRecord) {
  const { base, newBaseRecord } = baseFor(p, today, closesForRank, baseRecord);
  const val = Math.max(0.01, base * (1 + (perf || 0)));
  return { value: val, base, newBaseRecord };
}

// NBA convenience wrapper (kept for the existing NBA call sites/tests).
export function price(p, stat, today, closesForRank, baseRecord) {
  return priceFromPerf(p, nbaPerf(p, stat), today, closesForRank, baseRecord);
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

// Kept for backwards compat with the earlier NBA-only export name.
export const statPrice = nbaStatPrice;
