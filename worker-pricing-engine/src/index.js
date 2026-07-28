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
import { firestoreBatchGetDocs, firestoreBatchWriteDocs } from './lib/firestore.js';

const TZ = 'America/New_York';

// Fixed-timezone date boundary, replacing the client's device-local-clock
// localDateStr() - a Worker has no "local" timezone, so this must be
// hardcoded to match the US-centric leagues this prices.
function easternDateStr(offsetDays = 0) {
  const d = new Date(Date.now() - offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function docPath(league, rank) {
  return `priceEngine/${league}_${rank}`;
}

function defaultState(league, player) {
  return {
    rank: player.rank, tier: player.tier,
    statPrice: statPriceFor(league, player),
    base: null, closes: {},
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
  let finalized = 0;
  for (const { player, stat, isFinal } of toProcess) {
    const st = states[player.rank];
    const p = { rank: player.rank, tier: st.tier, ppg: st.ppg, rpg: st.rpg, apg: st.apg, statPrice: st.statPrice };
    const perf = nbaPerf(p, stat);
    const { value, newBaseRecord } = priceFromPerf(p, perf, today, st.closes, st.base);
    const fields = { base: newBaseRecord, tier: st.tier, statPrice: st.statPrice, ppg: st.ppg, rpg: st.rpg, apg: st.apg };
    if (isFinal) { fields.closes = { ...st.closes, [today]: finalize(value, today, st.closes) }; finalized++; }
    updates.push({ path: docPath('nba', player.rank), fields });
  }

  // Phase 4: one batched write.
  await firestoreBatchWriteDocs(env, updates);
  return { league: 'nba', games: events.length, processed: toProcess.length, finalized };
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
  const statsByRank = await mlb.fetchBoxscores(gamePks, rosterByName);
  const finalSet = new Set(schedule.final);
  const isFinal = gamePks.every(pk => finalSet.has(pk));

  const toProcess = mlbRaw
    .map(player => ({ player, stat: statsByRank[player.rank] }))
    .filter(t => t.stat);
  if (!toProcess.length) return { league: 'mlb', games: gamePks.length, processed: 0, finalized: 0 };

  const states = await loadStatesBatch(env, 'mlb', toProcess.map(t => t.player));

  const updates = [];
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
    if (isFinal) { fields.closes = { ...st.closes, [today]: finalize(value, today, st.closes) }; finalized++; }
    updates.push({ path: docPath('mlb', player.rank), fields });
  }

  await firestoreBatchWriteDocs(env, updates);
  return { league: 'mlb', games: gamePks.length, processed: toProcess.length, finalized };
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
    updates.push({ path: docPath('golf', player.rank), fields });
  }

  await firestoreBatchWriteDocs(env, updates);
  return { league: 'golf', players: Object.keys(byName).length, processed: updates.length, finalized };
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
  let finalized = 0;
  for (const player of toProcess) {
    const fpts = fptsByRank[player.rank];
    const st = states[player.rank];
    const p = { rank: player.rank, tier: st.tier, fpts: st.fpts, statPrice: st.statPrice };
    const perf = nflPerf(p, { fpts });
    const { value, newBaseRecord } = priceFromPerf(p, perf, today, st.closes, st.base);
    const fields = { base: newBaseRecord, tier: st.tier, statPrice: st.statPrice, fpts: st.fpts };
    if (isFinal) { fields.closes = { ...st.closes, [today]: finalize(value, today, st.closes) }; finalized++; }
    updates.push({ path: docPath('nfl', player.rank), fields });
  }

  await firestoreBatchWriteDocs(env, updates);
  return { league: 'nfl', games: relevant.length, processed: toProcess.length, finalized };
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      // Manual triggers for local/dev testing and verification - not meant
      // for public traffic; lock these down (or remove) before this Worker
      // handles anything feeding real settlements unattended.
      if (request.method === 'POST' && url.pathname === '/internal/tick') {
        return json(await runGameDayTick(env));
      }
      if (request.method === 'POST' && url.pathname === '/internal/refresh-baselines') {
        return json(await runDailyRefresh(env));
      }
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: e.message }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    if (event.cron === '0 11 * * *') {
      ctx.waitUntil(runDailyRefresh(env));
    } else {
      ctx.waitUntil(runGameDayTick(env));
    }
  },
};
