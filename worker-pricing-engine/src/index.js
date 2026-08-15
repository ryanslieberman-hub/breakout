import nbaRaw from '../data/nba-raw.json' assert { type: 'json' };
import mlbRaw from '../data/mlb-raw.json' assert { type: 'json' };
import golfRaw from '../data/golf-raw.json' assert { type: 'json' };
import nflRaw from '../data/nfl-raw.json' assert { type: 'json' };

import {
  statPriceFor, nbaPerf, mlbHitterPerf, mlbPitcherPerf, nflPerf,
  golfPerf, priceFromPerf, finalize,
} from './engine.js';
import * as espnNba from './espn.js';
import { fetchSeasonAverages } from './balldontlie.js';
import * as mlb from './mlb.js';
import * as golf from './golf.js';
import * as nfl from './nfl.js';
import {
  firestoreBatchGetDocs, firestoreBatchWriteDocs, firestoreListCollection, firestorePatchDoc,
} from './lib/firestore.js';
import { notifyAllTokens, notifyUid } from './lib/notify.js';
import { verifyFirebaseIdToken, bearerToken } from './lib/auth.js';

const TZ = 'America/New_York';

// Two distinct kinds of "worth telling everyone about" move, both market-wide
// (not just holders - a stock-app-style "TICKER up 10% today" alert is
// interesting to anyone watching the market, not only people who own it):
//   - DAY: cumulative move off today's opening base (engine.js's `perf`),
//     deduped to once per player per day via bigMoveDate.
//   - FAST: a sharp move within a ~30 min window even if the day-total isn't
//     there yet (a slow grind to 10% over 6 hours isn't the same signal as
//     7% in 30 min) - deduped with a cooldown via fastMoveNotifiedAt so a
//     move that stays elevated across several 15-min ticks doesn't re-fire
//     every tick.
const DAY_MOVE_THRESHOLD = 0.10;
const FAST_MOVE_THRESHOLD = 0.07;
const FAST_MOVE_LOOKBACK_MS = 25 * 60 * 1000; // ticks run every 15 min, so "~30 min ago" lands 2 ticks back
const FAST_MOVE_HISTORY_MS = 65 * 60 * 1000;
const FAST_MOVE_COOLDOWN_MS = 30 * 60 * 1000;

// Figures out whether this tick's price for one player crosses either
// threshold, and returns both the mover events (for notification) and the
// state fields to merge into this player's Firestore write (dedup markers +
// trimmed value history) - callers just Object.assign the fields in.
export function detectMovers({ rank, name, perf, value, st, dateKey, now }) {
  const events = [];
  const fields = {};

  if (Math.abs(perf) >= DAY_MOVE_THRESHOLD && st.bigMoveDate !== dateKey) {
    fields.bigMoveDate = dateKey;
    events.push({ kind: 'day', rank, name, pct: perf, value });
  }

  // Same-day only. Without this, a sample from just before midnight (still within
  // the 65-min history window) gets compared against today's freshly-reset opening
  // base right after the day rolls over - yesterday's live price vs today's base is
  // not a "move", but the raw delta between them can easily clear FAST_MOVE_THRESHOLD,
  // firing a spurious mover push right at/after midnight for no real reason.
  const history = (Array.isArray(st.recentValues) ? st.recentValues : [])
    .filter(e => easternDateStrOf(e.t) === dateKey);
  const ref = [...history].reverse().find(e => now - e.t >= FAST_MOVE_LOOKBACK_MS);
  if (ref && ref.value > 0) {
    const fastPct = (value - ref.value) / ref.value;
    const cooledDown = !st.fastMoveNotifiedAt || (now - st.fastMoveNotifiedAt) >= FAST_MOVE_COOLDOWN_MS;
    if (Math.abs(fastPct) >= FAST_MOVE_THRESHOLD && cooledDown) {
      fields.fastMoveNotifiedAt = now;
      events.push({ kind: 'fast', rank, name, pct: fastPct, value });
    }
  }
  fields.recentValues = [...history, { t: now, value }].filter(e => now - e.t <= FAST_MOVE_HISTORY_MS);

  return { events, fields };
}

const SPORT_EMOJI = { nba: '🏀', mlb: '⚾', golf: '⛳', nfl: '🏈' };

// Formats and fires one push per mover event, broadcast to every opted-in
// device. Returns how many devices got at least one push (for tick stats).
async function announceMovers(env, movers) {
  let notified = 0;
  for (const m of movers) {
    const up = m.pct >= 0;
    const direction = up ? 'up' : 'down';
    const pct = (Math.abs(m.pct) * 100).toFixed(1);
    const windowText = m.kind === 'fast' ? 'in the last 30 min' : 'today';
    const sportEmoji = SPORT_EMOJI[rankToLeague[m.rank]] || '';
    const moveEmoji = up ? '🔥' : '🧊';
    const sent = await notifyAllTokens(env, {
      title: `${moveEmoji}${sportEmoji} ${m.name} is ${direction} ${pct}% ${windowText}`,
      body: `Now $${m.value.toFixed(2)}`,
    }, { rank: String(m.rank), kind: `${m.kind}_move` });
    notified += sent;
  }
  return notified;
}

// Fixed-timezone date boundary, replacing the client's device-local-clock
// localDateStr() - a Worker has no "local" timezone, so this must be
// hardcoded to match the US-centric leagues this prices.
function easternDateStr(offsetDays = 0) {
  return easternDateStrOf(Date.now() - offsetDays * 86400000);
}

function easternDateStrOf(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function docPath(league, rank) {
  return `priceEngine/${league}_${rank}`;
}

// portfolios/{uid}.holdings is keyed by bare rank (no league prefix) - ranks
// are globally unique across the four raw rosters (nba 1-285, mlb 1001+,
// golf 2001+, nfl 3001+), so this is a safe one-time lookup rather than
// guessing a league from the rank's numeric range.
const rankToLeague = {};
for (const p of nbaRaw) rankToLeague[p.rank] = 'nba';
for (const p of mlbRaw) rankToLeague[p.rank] = 'mlb';
for (const p of golfRaw) rankToLeague[p.rank] = 'golf';
for (const p of nflRaw) rankToLeague[p.rank] = 'nfl';

function defaultState(league, player) {
  return {
    rank: player.rank, tier: player.tier,
    statPrice: statPriceFor(league, player),
    base: null, closes: {}, bigMoveDate: null, recentValues: [], fastMoveNotifiedAt: null,
    // league-specific baseline fields carried through as-is
    ppg: player.ppg, rpg: player.rpg, apg: player.apg, // nba
    avg: player.avg, hr: player.hr, rbi: player.rbi, ops: player.ops, // mlb hitter
    era: player.era, kper9: player.kper9, ipp: player.ipp, // mlb pitcher
    fpts: player.fpts, // nfl
    cumHx: {}, // golf
    pitcherLastStart: null, // mlb SP
  };
}

// Batch-fetches every given player's state in ONE Firestore request instead
// of one-per-player - Cloudflare caps subrequests per Worker invocation, and
// processing a full slate one-doc-at-a-time blew through that limit in
// production (never showed up locally - wrangler dev doesn't enforce the
// same cap). Merges with defaults for the same reason as before: a doc that
// only ever had a few fields patched shouldn't come back missing statPrice.
async function loadStatesBatch(env, league, players) {
  const paths = players.map(p => docPath(league, p.rank));
  const docs = await firestoreBatchGetDocs(env, paths);
  const out = {};
  for (const player of players) {
    const doc = docs[docPath(league, player.rank)];
    const defaults = defaultState(league, player);
    out[player.rank] = doc ? { ...defaults, ...doc } : defaults;
  }
  return out;
}

// ── NBA ──
async function tickNba(env, today) {
  const dateCompact = today.replaceAll('-', '');
  const sb = await espnNba.fetchScoreboard(dateCompact);
  const events = sb.events || [];
  const byName = {};
  for (const p of nbaRaw) byName[espnNba.normalizeName(p.name)] = p;

  // Phase 1: gather every (player, stat, isFinal) this tick touches, no Firestore yet.
  const toProcess = [];
  for (const ev of events) {
    const state = ev.status?.type?.state;
    if (state === 'pre') continue;
    const isFinal = !!ev.status?.type?.completed;
    const summary = await espnNba.fetchSummary(ev.id);
    const stats = espnNba.extractNbaBoxScoreStats(summary);
    for (const [name, stat] of Object.entries(stats)) {
      const player = byName[name];
      if (player) toProcess.push({ player, stat, isFinal });
    }
  }
  if (!toProcess.length) return { league: 'nba', games: events.length, processed: 0, finalized: 0 };

  // Phase 2: one batched read.
  const states = await loadStatesBatch(env, 'nba', toProcess.map(t => t.player));

  // Phase 3: compute every update in memory.
  const updates = [];
  const movers = [];
  const now = Date.now();
  let finalized = 0;
  for (const { player, stat, isFinal } of toProcess) {
    const st = states[player.rank];
    const p = { rank: player.rank, tier: st.tier, ppg: st.ppg, rpg: st.rpg, apg: st.apg, statPrice: st.statPrice };
    const perf = nbaPerf(p, stat);
    const { value, newBaseRecord } = priceFromPerf(p, perf, today, st.closes, st.base);
    const fields = { base: newBaseRecord, tier: st.tier, statPrice: st.statPrice, ppg: st.ppg, rpg: st.rpg, apg: st.apg };
    if (isFinal) { fields.closes = { ...st.closes, [today]: finalize(value, today, st.closes) }; finalized++; }
    const { events, fields: moveFields } = detectMovers({ rank: player.rank, name: player.name, perf, value, st, dateKey: today, now });
    Object.assign(fields, moveFields);
    movers.push(...events);
    updates.push({ path: docPath('nba', player.rank), fields });
  }

  // Phase 4: one batched write.
  await firestoreBatchWriteDocs(env, updates);
  const notified = await announceMovers(env, movers);
  return { league: 'nba', games: events.length, processed: toProcess.length, finalized, movers: movers.length, notified };
}

export async function runNbaDailyRefresh(env) {
  const season = new Date().getFullYear();
  const averages = await fetchSeasonAverages(season, env.BALLDONTLIE_API_KEY);
  const toUpdate = nbaRaw.filter(p => averages[espnNba.normalizeName(p.name)]);
  if (!toUpdate.length) return { league: 'nba', updated: 0, totalPlayers: nbaRaw.length };

  const states = await loadStatesBatch(env, 'nba', toUpdate);
  const updates = toUpdate.map(player => {
    const avg = averages[espnNba.normalizeName(player.name)];
    const existing = states[player.rank];
    return {
      path: docPath('nba', player.rank),
      fields: { ppg: avg.ppg, rpg: avg.rpg, apg: avg.apg, statPrice: existing.statPrice, tier: existing.tier },
    };
  });
  await firestoreBatchWriteDocs(env, updates);
  return { league: 'nba', updated: updates.length, totalPlayers: nbaRaw.length };
}

// ── MLB ──
async function tickMlb(env, today) {
  const schedule = await mlb.fetchSchedule(today);
  const gamePks = [...schedule.live, ...schedule.final];
  if (!gamePks.length) return { league: 'mlb', games: 0, processed: 0, finalized: 0 };

  const rosterByName = {};
  for (const p of mlbRaw) rosterByName[mlb.normalizeName(p.name)] = { rank: p.rank, role: p.role };
  const finalSet = new Set(schedule.final);
  const statsByRank = await mlb.fetchBoxscores(gamePks, rosterByName, finalSet);

  const toProcess = mlbRaw
    .map(player => ({ player, stat: statsByRank[player.rank] }))
    .filter(t => t.stat);
  if (!toProcess.length) return { league: 'mlb', games: gamePks.length, processed: 0, finalized: 0 };

  const states = await loadStatesBatch(env, 'mlb', toProcess.map(t => t.player));

  const updates = [];
  const movers = [];
  const now = Date.now();
  let finalized = 0;
  for (const { player, stat } of toProcess) {
    const st = states[player.rank];
    const isPitcher = player.role === 'SP' || player.role === 'RP';
    const p = { rank: player.rank, tier: st.tier, avg: st.avg, era: st.era, kper9: st.kper9, ipp: st.ipp, role: player.role };
    const perf = isPitcher ? mlbPitcherPerf(p, stat, today, st.pitcherLastStart) : mlbHitterPerf(p, stat);
    const { value, newBaseRecord } = priceFromPerf({ ...p, statPrice: st.statPrice }, perf, today, st.closes, st.base);
    const fields = {
      base: newBaseRecord, tier: st.tier, statPrice: st.statPrice,
      avg: st.avg, hr: st.hr, rbi: st.rbi, ops: st.ops, era: st.era, kper9: st.kper9, ipp: st.ipp,
    };
    if (isPitcher && stat.ip >= 1) fields.pitcherLastStart = today;
    if (stat.final) { fields.closes = { ...st.closes, [today]: finalize(value, today, st.closes) }; finalized++; }
    const { events, fields: moveFields } = detectMovers({ rank: player.rank, name: player.name, perf, value, st, dateKey: today, now });
    Object.assign(fields, moveFields);
    movers.push(...events);
    updates.push({ path: docPath('mlb', player.rank), fields });
  }

  await firestoreBatchWriteDocs(env, updates);
  const notified = await announceMovers(env, movers);
  return { league: 'mlb', games: gamePks.length, processed: toProcess.length, finalized, movers: movers.length, notified };
}

export async function runMlbDailyRefresh(env) {
  const season = new Date().getFullYear();
  const stats = await mlb.fetchSeasonStats(season);
  const toUpdate = mlbRaw
    .map(player => ({ player, s: stats[mlb.normalizeName(player.name)] }))
    .filter(t => t.s);
  if (!toUpdate.length) return { league: 'mlb', updated: 0, totalPlayers: mlbRaw.length };

  const states = await loadStatesBatch(env, 'mlb', toUpdate.map(t => t.player));
  const updates = toUpdate.map(({ player, s }) => {
    const existing = states[player.rank];
    return {
      path: docPath('mlb', player.rank),
      fields: { ...s, statPrice: existing.statPrice, tier: existing.tier },
    };
  });
  await firestoreBatchWriteDocs(env, updates);
  return { league: 'mlb', updated: updates.length, totalPlayers: mlbRaw.length };
}

// ── Golf ──
// Note: matches the client's own finalize condition (event.completed) - see
// golf.js's header comment for the known limitation this carries over
// (intermediate tournament-day rounds move the live price but are never
// locked into a persisted close until the whole event ends).
async function tickGolf(env, today) {
  const sb = await golf.fetchScoreboard();
  const { isComplete, byName } = golf.extractCompetitors(sb, today);
  if (!Object.keys(byName).length) return { league: 'golf', players: 0, processed: 0, finalized: 0 };

  const rankByNorm = {};
  for (const p of golfRaw) rankByNorm[golf.normalizeName(p.name)] = p.rank;

  const tracked = golfRaw.filter(p => byName[golf.normalizeName(p.name)]);
  if (!tracked.length) return { league: 'golf', players: Object.keys(byName).length, processed: 0, finalized: 0 };

  const states = await loadStatesBatch(env, 'golf', tracked);
  const cumHxByRank = {};
  for (const player of tracked) cumHxByRank[player.rank] = states[player.rank].cumHx || {};

  const fieldAvg = golf.computeFieldAverage(byName, rankByNorm, cumHxByRank);

  const updates = [];
  const movers = [];
  const now = Date.now();
  let finalized = 0;
  for (const player of tracked) {
    const rec = byName[golf.normalizeName(player.name)];
    const st = states[player.rank];
    const derived = golf.deriveRoundForGolfer(rec, st.cumHx || {});
    if (!derived) continue;

    const p = { rank: player.rank, tier: st.tier, statPrice: st.statPrice };
    const perf = golfPerf(p, { toPar: derived.toPar }, fieldAvg);
    const { value, newBaseRecord } = priceFromPerf(p, perf, today, st.closes, st.base);
    const fields = { base: newBaseRecord, cumHx: derived.updatedHx, tier: st.tier, statPrice: st.statPrice };
    if (isComplete) { fields.closes = { ...st.closes, [derived.date]: finalize(value, derived.date, st.closes) }; finalized++; }
    const { events, fields: moveFields } = detectMovers({ rank: player.rank, name: player.name, perf, value, st, dateKey: derived.date, now });
    Object.assign(fields, moveFields);
    movers.push(...events);
    updates.push({ path: docPath('golf', player.rank), fields });
  }

  await firestoreBatchWriteDocs(env, updates);
  const notified = await announceMovers(env, movers);
  return { league: 'golf', players: Object.keys(byName).length, processed: updates.length, finalized, movers: movers.length, notified };
}

// ── NFL ──
// The client's nflTick() never calls ENGINE.finalize() for NFL - confirmed by
// reading index.html directly, not an assumption. That looks like a genuine
// gap (NBA/MLB/Golf all finalize on game completion; NFL doesn't), which
// would mean NFL prices never lock in a persisted daily close in production
// today. For this trusted server-side engine, finalize is called here when
// the game is complete, matching every other league's pattern, rather than
// silently reproducing what looks like an oversight.
async function tickNfl(env, today) {
  const dateCompact = today.replaceAll('-', '');
  const sb = await nfl.fetchScoreboard(dateCompact);
  const events = sb.events || [];
  const finals = events.filter(e => e.status?.type?.completed);
  const live = events.filter(e => e.status?.type?.state === 'in');
  const relevant = [...finals, ...live];
  if (!relevant.length) return { league: 'nfl', games: 0, processed: 0, finalized: 0 };

  const fptsByRank = {};
  const byName = {};
  const byRank = {};
  for (const p of nflRaw) { byName[nfl.normalizeName(p.name)] = p; byRank[p.rank] = p; }

  for (const ev of relevant) {
    const summary = await nfl.fetchSummary(ev.id);
    const points = nfl.extractNflFantasyPoints(summary);
    for (const [name, pts] of Object.entries(points)) {
      const player = byName[name];
      if (!player) continue;
      fptsByRank[player.rank] = (fptsByRank[player.rank] || 0) + pts;
    }
  }

  const isFinal = live.length === 0; // every relevant event this tick is complete
  const toProcess = Object.keys(fptsByRank).map(Number).filter(r => byRank[r]).map(r => byRank[r]);
  if (!toProcess.length) return { league: 'nfl', games: relevant.length, processed: 0, finalized: 0 };

  const states = await loadStatesBatch(env, 'nfl', toProcess);
  const updates = [];
  const movers = [];
  const now = Date.now();
  let finalized = 0;
  for (const player of toProcess) {
    const fpts = fptsByRank[player.rank];
    const st = states[player.rank];
    const p = { rank: player.rank, tier: st.tier, fpts: st.fpts, statPrice: st.statPrice };
    const perf = nflPerf(p, { fpts });
    const { value, newBaseRecord } = priceFromPerf(p, perf, today, st.closes, st.base);
    const fields = { base: newBaseRecord, tier: st.tier, statPrice: st.statPrice, fpts: st.fpts };
    if (isFinal) { fields.closes = { ...st.closes, [today]: finalize(value, today, st.closes) }; finalized++; }
    const { events, fields: moveFields } = detectMovers({ rank: player.rank, name: player.name, perf, value, st, dateKey: today, now });
    Object.assign(fields, moveFields);
    movers.push(...events);
    updates.push({ path: docPath('nfl', player.rank), fields });
  }

  await firestoreBatchWriteDocs(env, updates);
  const notified = await announceMovers(env, movers);
  return { league: 'nfl', games: relevant.length, processed: toProcess.length, finalized, movers: movers.length, notified };
}

export async function runGameDayTick(env) {
  const today = easternDateStr(0);
  const results = [];
  for (const fn of [tickNba, tickMlb, tickGolf, tickNfl]) {
    try {
      results.push(await fn(env, today));
    } catch (e) {
      console.error(`${fn.name} failed:`, e.message);
      results.push({ league: fn.name, error: e.message });
    }
  }
  return { date: today, results };
}

// Once-daily "here's how your day went" push. Runs after essentially all
// games have finished (see wrangler.toml's cron comment) so `closes[today]`
// is set for anyone whose game wrapped; anyone who didn't play today still
// gets priced off their carried-forward `base`, same as the live app.
// Idempotent per day - `lastDailySummary.date` guards against a re-run
// (retry, manual trigger) double-sending the same day's push.
export async function runPortfolioSummary(env) {
  const today = easternDateStr(0);
  const [allPortfolios, users] = await Promise.all([
    firestoreListCollection(env, 'portfolios'),
    firestoreListCollection(env, 'users'),
  ]);
  // portfolios/{uid} docs get created (default $100k, no holdings) the moment
  // someone so much as opens the app pre-signup, and outlive that visit even
  // if they never actually create an account - only summarize real accounts.
  const realUids = new Set(users.map(u => u.id));
  const portfolios = allPortfolios.filter(p => realUids.has(p.id));
  if (!portfolios.length) return { date: today, portfolios: 0, updated: 0 };

  const ranks = new Set();
  for (const p of portfolios) {
    for (const [rank, h] of Object.entries(p.holdings || {})) {
      if (h && h.shares > 0) ranks.add(Number(rank));
    }
  }
  const rankList = [...ranks].filter(r => rankToLeague[r]);
  const priceDocs = await firestoreBatchGetDocs(env, rankList.map(r => docPath(rankToLeague[r], r)));
  const priceByRank = {};
  for (const r of rankList) {
    const doc = priceDocs[docPath(rankToLeague[r], r)];
    if (!doc) continue;
    priceByRank[r] = (doc.closes && doc.closes[today]) ?? doc.base?.price ?? doc.statPrice ?? 0;
  }

  let updated = 0;
  for (const portfolio of portfolios) {
    const uid = portfolio.id;
    if (portfolio.lastDailySummary?.date === today) continue; // already sent today
    try {
      let value = portfolio.cash || 0;
      for (const [rank, h] of Object.entries(portfolio.holdings || {})) {
        if (!h || !(h.shares > 0)) continue;
        value += h.shares * (priceByRank[Number(rank)] || 0);
      }

      const last = portfolio.lastDailySummary;
      const amount = `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
      let body = amount;
      if (last && last.value > 0) {
        const pct = ((value - last.value) / last.value) * 100;
        body = `${amount} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% today)`;
      }

      await notifyUid(env, uid, { title: 'Your portfolio', body }, { kind: 'portfolio_summary' });
      await firestorePatchDoc(env, `portfolios/${uid}`, { lastDailySummary: { date: today, value } });
      updated++;
    } catch (e) {
      // One bad portfolio (bad data, a transient Firestore error) shouldn't
      // sink everyone else's summary for the day - log and move on.
      console.error(`portfolio summary failed for ${uid}:`, e.message);
    }
  }
  return { date: today, portfolios: portfolios.length, updated };
}

export async function runDailyRefresh(env) {
  const results = [];
  for (const fn of [runNbaDailyRefresh, runMlbDailyRefresh]) {
    try {
      results.push(await fn(env));
    } catch (e) {
      console.error(`${fn.name} failed:`, e.message);
      results.push({ fn: fn.name, error: e.message });
    }
  }
  return { results };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// These POST routes used to be reachable by anyone who found the URL - the
// real cron trigger never calls them (scheduled() below calls the run*
// functions directly), they exist only for manual/local testing, so there
// was no legitimate reason for them to be open. runGameDayTick/runDailyRefresh
// write priceEngine/{...} - the prices real-money challenge settlement trusts
// - and runPortfolioSummary fires a push notification to every registered
// device, so an unauthenticated caller could spam both. Same admin-custom-
// claim gate worker-payments uses for its own /internal/run-settlement.
async function requireAdmin(request, env) {
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, 'Missing Authorization header');
  let user;
  try {
    user = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
  } catch (e) {
    throw new HttpError(401, `Invalid ID token: ${e.message}`);
  }
  if (!user.admin) throw new HttpError(403, 'Admin only');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      // Manual triggers for local/dev testing and verification.
      if (request.method === 'POST' && url.pathname === '/internal/tick') {
        await requireAdmin(request, env);
        return json(await runGameDayTick(env));
      }
      if (request.method === 'POST' && url.pathname === '/internal/refresh-baselines') {
        await requireAdmin(request, env);
        return json(await runDailyRefresh(env));
      }
      if (request.method === 'POST' && url.pathname === '/internal/portfolio-summary') {
        await requireAdmin(request, env);
        return json(await runPortfolioSummary(env));
      }
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return json({ error: e.message }, status);
    }
  },

  async scheduled(event, env, ctx) {
    if (event.cron === '0 11 * * *') {
      ctx.waitUntil(runDailyRefresh(env));
    } else if (event.cron === '30 8 * * *') {
      ctx.waitUntil(runPortfolioSummary(env));
    } else {
      ctx.waitUntil(runGameDayTick(env));
    }
  },
};
