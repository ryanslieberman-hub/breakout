import nbaRaw from '../data/nba-raw.json' assert { type: 'json' };
import { statPrice, price, finalize } from './engine.js';
import { fetchScoreboard, fetchSummary, extractNbaBoxScoreStats, normalizeName } from './espn.js';
import { fetchSeasonAverages } from './balldontlie.js';
import { firestoreGetDoc, firestorePatchDoc } from './lib/firestore.js';

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

function docPath(rank) {
  return `priceEngine/nba_${rank}`;
}

async function loadPlayerState(env, rank) {
  const doc = await firestoreGetDoc(env, docPath(rank));
  return doc; // null if never written
}

// One player, one day's worth of engine logic: compute today's live price
// from the given stat (or null), and if the game is final, lock the close.
async function processPlayer(env, player, stat, isFinal, today) {
  const state = (await loadPlayerState(env, player.rank)) || {
    rank: player.rank, tier: player.tier, ppg: player.ppg, rpg: player.rpg, apg: player.apg,
    statPrice: statPrice(player), base: null, closes: {},
  };
  const p = { rank: player.rank, tier: state.tier, ppg: state.ppg, rpg: state.rpg, apg: state.apg, statPrice: state.statPrice };

  const { value, newBaseRecord } = price(p, stat, today, state.closes, state.base);
  const update = { base: newBaseRecord };

  if (isFinal) {
    const closeVal = finalize(value, today, state.closes);
    update.closes = { ...state.closes, [today]: closeVal };
  }

  await firestorePatchDoc(env, docPath(player.rank), update);
  return isFinal ? update.closes[today] : value;
}

// Game-day tick: fetch today's scoreboard, pull box scores for any live/final
// games, run every rostered player who appears through the engine.
export async function runGameDayTick(env) {
  const today = easternDateStr(0);
  const dateCompact = today.replaceAll('-', '');
  const sb = await fetchScoreboard(dateCompact);
  const events = sb.events || [];

  const results = { processed: 0, finalized: 0, games: events.length };
  const byName = {};
  for (const p of nbaRaw) byName[normalizeName(p.name)] = p;

  for (const ev of events) {
    const state = ev.status?.type?.state; // 'pre' | 'in' | 'post'
    if (state === 'pre') continue;
    const isFinal = !!ev.status?.type?.completed;

    const summary = await fetchSummary(ev.id);
    const stats = extractNbaBoxScoreStats(summary);

    for (const [name, stat] of Object.entries(stats)) {
      const player = byName[name];
      if (!player) continue; // not a rostered/priced player
      await processPlayer(env, player, stat, isFinal, today);
      results.processed++;
      if (isFinal) results.finalized++;
    }
  }
  return results;
}

// Daily baseline refresh: re-pull season averages, update ppg/rpg/apg.
// statPrice is intentionally NOT recomputed - matches client behavior of
// freezing the fundamental anchor at initial load.
export async function runDailyRefresh(env) {
  const season = new Date().getFullYear(); // matches client's use of current year
  const averages = await fetchSeasonAverages(season, env.BALLDONTLIE_API_KEY);
  let updated = 0;
  for (const player of nbaRaw) {
    const avg = averages[normalizeName(player.name)];
    if (!avg) continue;
    const existing = (await loadPlayerState(env, player.rank)) || {
      rank: player.rank, tier: player.tier, ppg: player.ppg, rpg: player.rpg, apg: player.apg,
      statPrice: statPrice(player), base: null, closes: {},
    };
    await firestorePatchDoc(env, docPath(player.rank), {
      ppg: avg.ppg, rpg: avg.rpg, apg: avg.apg,
      // statPrice/tier untouched - frozen fundamental anchor
      statPrice: existing.statPrice, tier: existing.tier,
    });
    updated++;
  }
  return { updated, totalPlayers: nbaRaw.length };
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
    // Cloudflare cron doesn't tell us which schedule fired without checking
    // event.cron - the daily refresh runs once around 6am ET, the game-day
    // tick runs every ~15 min otherwise (see wrangler.toml).
    if (event.cron === '0 11 * * *') { // 6am ET = 11:00 UTC (approx, ignores DST)
      ctx.waitUntil(runDailyRefresh(env));
    } else {
      ctx.waitUntil(runGameDayTick(env));
    }
  },
};
