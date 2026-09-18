// One-shot backfill: rebuild NFL daily close history in Firestore's
// `config/prices` doc (the doc the *client* reads) from real ESPN box scores.
//
// Why this exists: NFL price history is only ever recorded by a browser that
// has the app open on a game day (nflTick -> ENGINE.finalize -> config/prices).
// The server-side pricing worker DOES price NFL every 15 min, but writes to a
// separate `priceEngine/*` collection the client never reads. After the
// one-time NFL reprice migration wiped the old history, every NFL player was
// left with `closes: {}` and a flat chart pinned to statPrice. This walks the
// season's completed games and writes the closes the client would have.
//
// Uses the SAME math as the live client (worker engine.js is a verbatim port
// of index.html's ENGINE) and the SAME roster/rank numbering (nfl-raw.json ==
// the client's embedded NFL_RAW - spot-checked: Lamar Jackson rank 3001,
// statPrice 745.88 both sides).
//
// Usage (from worker-pricing-engine/):
//   node scripts/backfill-nfl-closes.mjs               # dry run, prints plan
//   node scripts/backfill-nfl-closes.mjs --write       # actually patch Firestore
//   node scripts/backfill-nfl-closes.mjs --from 20260901 --to 20260909
//
// Auth: reuses ../worker-payments/service-account-key.json (same Firebase
// project, athletex-ae63d). Writes via the Firestore REST API, which is not
// subject to firestore.rules - same trust level as the workers themselves.

import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';
import { nflStatPrice, nflPerf, priceFromPerf, finalize } from '../src/engine.js';
import { normalizeName, extractNflFantasyPoints } from '../src/nfl.js';

const nflRaw = JSON.parse(readFileSync(new URL('../data/nfl-raw.json', import.meta.url)));

// ── args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const arg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const FROM = arg('--from', '20260901'); // NFL 2026 Week 1 opener was Sep 4
const TO = arg('--to', ymd(new Date()));

// ── service account / token ───────────────────────────────────────────────
const SA = JSON.parse(
  readFileSync(new URL('../../worker-payments/service-account-key.json', import.meta.url))
);
const PROJECT = SA.project_id;
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

async function accessToken() {
  const key = await importPKCS8(SA.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(SA.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${await res.text()}`);
  return (await res.json()).access_token;
}

// ── Firestore REST value <-> JS (only the shapes this script needs) ────────
function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number')
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toFsValue(val);
    return { mapValue: { fields } };
  }
  throw new Error(`cannot encode ${v}`);
}
function fromFsValue(fv) {
  if (!fv) return null;
  if ('stringValue' in fv) return fv.stringValue;
  if ('integerValue' in fv) return Number(fv.integerValue);
  if ('doubleValue' in fv) return fv.doubleValue;
  if ('booleanValue' in fv) return fv.booleanValue;
  if ('nullValue' in fv) return null;
  if ('mapValue' in fv) return fromFsFields(fv.mapValue.fields || {});
  if ('arrayValue' in fv) return (fv.arrayValue.values || []).map(fromFsValue);
  return null;
}
function fromFsFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromFsValue(v);
  return out;
}

async function getPricesDoc(token) {
  const res = await fetch(`${DOCS}/config/prices`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`get config/prices failed: ${await res.text()}`);
  return fromFsFields((await res.json()).fields);
}

// Build the intraday points this backfill's own closes SHOULD have produced
// had a real browser been open to log them live. Without this, closes/liveP
// end up correct while intraday still holds whatever stale tick a browser
// happened to log mid-game (or nothing at all) - get24hPct now sidesteps a
// stale log once a close is locked (see index.html), so this isn't user-
// visible anymore, but leaving the raw data inconsistent is still worth
// closing. Confirmed live: Baker Mayfield's intraday sat frozen at a
// mid-game tick ($178.93) for 38+ hours after his real close ($175.35) had
// already been backfilled - closes/liveP were right, intraday just never
// heard about it.
//
// Appends to whatever's already there (never replaces) - a rank whose
// intraday already has real, more-recent ticks (e.g. the player has since
// played a live-watched game) keeps them untouched; this only fills the
// specific dates THIS run backfilled, each timestamped at that date's own
// 11pm local (a reasonable "game just ended" anchor, no real intraday
// granularity to recover this long after the fact).
function buildIntradayFields(closesByRank, existingIntraday) {
  const out = {};
  for (const [rank, dateMap] of Object.entries(closesByRank)) {
    const existing = (existingIntraday && existingIntraday[rank]) || [];
    const added = Object.entries(dateMap).map(([dateStr, price]) => ({
      t: new Date(`${dateStr}T23:00:00`).getTime(),
      price,
    }));
    const merged = [...existing, ...added]
      .filter((pt) => pt && pt.t > 0 && pt.price > 0)
      .sort((a, b) => a.t - b.t);
    // De-dupe same-timestamp points (re-running this script for an
    // already-backfilled date would otherwise stack duplicates).
    const deduped = merged.filter((pt, i) => i === 0 || pt.t !== merged[i - 1].t);
    out[rank] = deduped;
  }
  return out;
}

// Surgical merge: PATCH only `closes.<rank>`, `liveP.<rank>`, and
// `intraday.<rank>` leaves, so sibling ranks and the other leagues' history
// are untouched (same effect the client's setDoc(..., {merge:true}) has).
// Numeric segments must be backtick-quoted in a Firestore field path.
//
// Chunked into groups of ranks rather than one PATCH for everything - a full
// Sunday slate is 180+ ranks, and one request listing every rank's fieldPath
// in the URL (3 per rank now) runs long enough that Google's front-end
// rejects it outright as a malformed request (a generic 400 page, not a
// Firestore JSON error) before it ever reaches Firestore. A single game day
// (the only case this script had run for before) never had enough ranks to
// hit that.
const PATCH_CHUNK_SIZE = 25;
async function patchCloses(token, closesByRank, livePByRank, intradayByRank) {
  const ranks = Object.keys(closesByRank);
  for (let i = 0; i < ranks.length; i += PATCH_CHUNK_SIZE) {
    const chunk = ranks.slice(i, i + PATCH_CHUNK_SIZE);
    const fieldPaths = [];
    const closesFields = {};
    const livePFields = {};
    const intradayFields = {};
    for (const r of chunk) {
      closesFields[r] = toFsValue(closesByRank[r]);
      livePFields[r] = toFsValue(livePByRank[r]);
      intradayFields[r] = { arrayValue: { values: (intradayByRank[r] || []).map(toFsValue) } };
      fieldPaths.push('closes.`' + r + '`', 'liveP.`' + r + '`', 'intraday.`' + r + '`');
    }
    const body = {
      fields: {
        closes: { mapValue: { fields: closesFields } },
        liveP: { mapValue: { fields: livePFields } },
        intraday: { mapValue: { fields: intradayFields } },
      },
    };
    const qs = fieldPaths
      .map((p) => `updateMask.fieldPaths=${encodeURIComponent(p)}`)
      .join('&');
    const res = await fetch(`${DOCS}/config/prices?${qs}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`patch failed (ranks ${chunk[0]}..${chunk[chunk.length - 1]}): ${await res.text()}`);
    console.log(`  patched ${chunk.length} ranks (${i + chunk.length}/${ranks.length})`);
  }
}

// ── ESPN ─────────────────────────────────────────────────────────────────
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
async function scoreboard(yyyymmdd) {
  const res = await fetch(`${ESPN}/scoreboard?dates=${yyyymmdd}`);
  if (!res.ok) throw new Error(`scoreboard ${yyyymmdd}: ${res.status}`);
  return res.json();
}
async function summary(id) {
  const res = await fetch(`${ESPN}/summary?event=${id}`);
  if (!res.ok) throw new Error(`summary ${id}: ${res.status}`);
  return res.json();
}

// ── date helpers ─────────────────────────────────────────────────────────
function ymd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
function dashed(yyyymmdd) {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}
function* dateRange(from, to) {
  const d = new Date(`${dashed(from)}T12:00:00`);
  const end = new Date(`${dashed(to)}T12:00:00`);
  while (d <= end) {
    yield ymd(d);
    d.setDate(d.getDate() + 1);
  }
}

// ── build roster (name -> player w/ computed statPrice) ───────────────────
const byName = {};
for (const p of nflRaw) {
  byName[normalizeName(p.name)] = { ...p, statPrice: nflStatPrice(p) };
}

// ── main ─────────────────────────────────────────────────────────────────
console.log(`NFL close backfill — ${dashed(FROM)} .. ${dashed(TO)}  (${WRITE ? 'WRITE' : 'dry run'})`);

// 1. find completed games per date
const gamesByDate = {}; // 'YYYY-MM-DD' -> [eventId]
for (const day of dateRange(FROM, TO)) {
  let sb;
  try {
    sb = await scoreboard(day);
  } catch (e) {
    console.warn(`  ${day}: scoreboard error ${e.message}`);
    continue;
  }
  const done = (sb.events || []).filter((e) => e.status?.type?.completed);
  if (done.length) {
    gamesByDate[dashed(day)] = done.map((e) => e.id);
    console.log(`  ${dashed(day)}: ${done.length} completed game(s)`);
  }
}
const dates = Object.keys(gamesByDate).sort();
if (!dates.length) {
  console.log('No completed NFL games in range. Nothing to do.');
  process.exit(0);
}

// 2. walk dates in order, accumulating per-rank close history
const closesByRank = {}; // rank(str) -> { 'YYYY-MM-DD': price }
let totalPlayerCloses = 0;
const unmatched = new Set();

for (const dateStr of dates) {
  const fptsByName = {};
  for (const id of gamesByDate[dateStr]) {
    let s;
    try {
      s = await summary(id);
    } catch (e) {
      console.warn(`    summary ${id} failed: ${e.message}`);
      continue;
    }
    const pts = extractNflFantasyPoints(s);
    for (const [nm, v] of Object.entries(pts)) fptsByName[nm] = (fptsByName[nm] || 0) + v;
  }

  let dayCount = 0;
  for (const [nm, fpts] of Object.entries(fptsByName)) {
    const pl = byName[nm];
    if (!pl) {
      unmatched.add(nm);
      continue;
    }
    const closesForRank = closesByRank[pl.rank] || (closesByRank[pl.rank] = {});
    const perf = nflPerf(pl, { fpts });
    const { value } = priceFromPerf(pl, perf, dateStr, closesForRank, null);
    let close = finalize(value, dateStr, closesForRank);
    // Stay strictly inside the client's _priceValid clamp (statPrice * [0.55,
    // 1.70]) so autoRepairPrices() never scrubs a backfilled point back out.
    close = Math.min(pl.statPrice * 1.68, Math.max(pl.statPrice * 0.56, close));
    closesForRank[dateStr] = Math.round(close * 100) / 100;
    dayCount++;
    totalPlayerCloses++;
  }
  console.log(`  ${dateStr}: priced ${dayCount} players`);
}

// 3. liveP = each player's most recent close
const livePByRank = {};
for (const [rank, m] of Object.entries(closesByRank)) {
  const last = Object.keys(m).sort().pop();
  livePByRank[rank] = m[last];
}

const rankCount = Object.keys(closesByRank).length;
console.log(
  `\nPlan: ${rankCount} NFL players get close history (${totalPlayerCloses} player-day closes across ${dates.length} date(s)).`
);
if (unmatched.size) {
  console.log(`  ${unmatched.size} ESPN names had no roster match (skipped), e.g.:`);
  console.log('   ', [...unmatched].slice(0, 12).join(', '));
}

// sample
const sampleRanks = ['3001', '3006', '3009', '3014'].filter((r) => closesByRank[r]);
for (const r of sampleRanks) {
  const pl = nflRaw.find((p) => String(p.rank) === r);
  console.log(
    `  e.g. #${r} ${pl?.name} (sp ${byName[normalizeName(pl.name)].statPrice.toFixed(2)}): ` +
      JSON.stringify(closesByRank[r]) +
      ` -> liveP ${livePByRank[r]}`
  );
}

if (!WRITE) {
  console.log('\nDry run only. Re-run with --write to patch config/prices.');
  process.exit(0);
}

// 4. write
const token = await accessToken();
const before = await getPricesDoc(token);
const beforeNflCloses = Object.keys(before.closes || {}).filter(
  (r) => +r >= 3001 && before.closes[r] && Object.keys(before.closes[r]).length
).length;
console.log(`\nconfig/prices currently has ${beforeNflCloses} NFL ranks with non-empty closes.`);

const intradayByRank = buildIntradayFields(closesByRank, before.intraday);

await patchCloses(token, closesByRank, livePByRank, intradayByRank);

const after = await getPricesDoc(token);
const afterNflCloses = Object.keys(after.closes || {}).filter(
  (r) => +r >= 3001 && after.closes[r] && Object.keys(after.closes[r]).length
).length;
const otherLeagueCloses = Object.keys(after.closes || {}).filter((r) => +r < 3001).length;
console.log(
  `Done. NFL ranks with closes: ${beforeNflCloses} -> ${afterNflCloses}. ` +
    `Non-NFL close ranks still present: ${otherLeagueCloses} (unchanged).`
);
