// One-shot backfill: populate config/lastNight box-score data for players added
// to the roster AFTER their game already happened, so no client was ever open
// to observe it live (see backfill-nfl-closes.mjs's header for the analogous
// closes gap). Without this, index.html's "Last Night" hero boxes stay
// completely blank for these players forever - nflTick() only ever populates
// lastNight[rank] for a game happening on THE CURRENT day a browser is open.
//
// Uses the exact same raw-stat-line shape client's _nflRawLine()/nflTick()
// produce, so the write is indistinguishable from one a real browser made.
//
// Writes via a dotted per-rank field path (data.<rank>), NOT a plain nested
// object - see index.html's syncPricesToFirestore fix (2026-09-14) for why:
// a plain `{data: {...}}` write under merge:true replaces the WHOLE map,
// wiping every other player's box score. This script must never repeat that.
//
// Usage: node scripts/backfill-lastnight.mjs [--write] [--date YYYY-MM-DD] [names...]
//   node scripts/backfill-lastnight.mjs --date 2026-09-13 --write \
//     "Parker Washington" "Ja'Kobi Lane" "De'Zhaun Stribling" "Denzel Boston" \
//     "Ryan Flournoy" "Tre' Harris" "Gunnar Helm"

import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';

const nflRaw = JSON.parse(readFileSync(new URL('../data/nfl-raw.json', import.meta.url)));

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const dateIdx = args.indexOf('--date');
const DATE = dateIdx >= 0 ? args[dateIdx + 1] : null;
const names = args.filter((a, i) => a !== '--write' && !(dateIdx >= 0 && (i === dateIdx || i === dateIdx + 1)));
if (!DATE || !names.length) {
  console.log('Usage: node scripts/backfill-lastnight.mjs --date YYYY-MM-DD [--write] "Player Name" ["Another Name" ...]');
  process.exit(1);
}

const normalizeName = (n) => (n || '').toLowerCase().trim().replace(/[.'-]/g, '').replace(/\s+/g, ' ');

const byName = {};
for (const p of nflRaw) byName[normalizeName(p.name)] = p;

const targets = names.map(n => {
  const p = byName[normalizeName(n)];
  if (!p) { console.warn(`  NOT FOUND in roster: ${n}`); return null; }
  return p;
}).filter(Boolean);
if (!targets.length) { console.log('No matching roster players. Nothing to do.'); process.exit(0); }
console.log(`Backfilling lastNight for ${targets.length} player(s) on ${DATE}:`, targets.map(p => `${p.name} (#${p.rank})`).join(', '));

// ── raw-line merge, mirrors index.html's _nflRawLine ──────────────────────
function mergeRawLine(cat, labels, stats, into) {
  const n = (i) => parseFloat((stats[i] || '0').toString().replace(/[^0-9.\-]/g, '')) || 0;
  if (cat === 'passing') {
    into.py = (into.py || 0) + n(1); into.ptd = (into.ptd || 0) + n(3); into.ints = (into.ints || 0) + n(4);
  } else if (cat === 'rushing') {
    into.car = (into.car || 0) + n(0); into.ry = (into.ry || 0) + n(1); into.rtd = (into.rtd || 0) + n(3);
  } else if (cat === 'receiving') {
    into.rec = (into.rec || 0) + n(0); into.recy = (into.recy || 0) + n(1);
    into.rectd = (into.rectd || 0) + n(3); into.tgt = (into.tgt || 0) + n(5);
  } else if (cat === 'defensive' || cat === 'interceptions') {
    const get = (list) => {
      for (const name of list) {
        const idx = (labels || []).findIndex(l => (l || '').toUpperCase() === name);
        if (idx >= 0) return parseFloat((stats[idx] || '0').toString().replace(/[^0-9.\-]/g, '')) || 0;
      }
      return 0;
    };
    into.tkl = (into.tkl || 0) + (get(['TOT', 'TACK', 'TCKL']) || get(['SOLO']));
    into.sack = (into.sack || 0) + get(['SACK', 'SCK']);
    into.defint = (into.defint || 0) + (cat === 'interceptions' ? get(['INT']) : 0);
    into.ffum = (into.ffum || 0) + get(['FF']);
    into.deftd = (into.deftd || 0) + get(['TD']);
  }
  return into;
}
function fptsFromRaw(s) {
  return (s.py || 0) * 0.04 + (s.ptd || 0) * 4 - (s.ints || 0) * 2
    + (s.ry || 0) * 0.1 + (s.rtd || 0) * 6
    + (s.rec || 0) * 0.5 + (s.recy || 0) * 0.1 + (s.rectd || 0) * 6
    + (s.tkl || 0) * 1 + (s.sack || 0) * 2 + (s.defint || 0) * 3 + (s.ffum || 0) * 2 + (s.deftd || 0) * 6;
}

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

const dateCompact = DATE.replaceAll('-', '');
const sb = await scoreboard(dateCompact);
const events = (sb.events || []).filter(e => e.status?.type?.completed);
console.log(`  ${events.length} completed game(s) on ${DATE}`);

const targetByNorm = {};
for (const p of targets) targetByNorm[normalizeName(p.name)] = p;
const found = {}; // rank -> line

for (const ev of events) {
  if (Object.keys(found).length === targets.length) break;
  const sum = await summary(ev.id);
  const teams = sum?.boxscore?.players || [];
  for (const tm of teams) {
    for (const cat of tm.statistics || []) {
      const isOffense = ['passing', 'rushing', 'receiving'].includes(cat.name);
      if (!isOffense) continue;
      for (const a of cat.athletes || []) {
        const nm = normalizeName(a.athlete?.displayName || '');
        const p = targetByNorm[nm];
        if (!p) continue;
        const line = found[p.rank] || (found[p.rank] = { rank: p.rank, name: p.name });
        mergeRawLine(cat.name, cat.labels, a.stats || [], line);
      }
    }
  }
}

for (const p of targets) {
  const line = found[p.rank];
  if (!line) { console.log(`  ${p.name}: no stat line found on ${DATE} (bye/inactive/DNP?)`); continue; }
  const fpts = Math.round(fptsFromRaw(line) * 10) / 10;
  console.log(`  ${p.name} (#${p.rank}): fpts=${fpts}`, JSON.stringify(line));
}

if (!WRITE) {
  console.log('\nDry run only. Re-run with --write to patch config/lastNight.');
  process.exit(0);
}

// ── Firestore write: dotted per-rank field paths, never a whole nested object ──
const sa = JSON.parse(readFileSync(new URL('../../worker-payments/service-account-key.json', import.meta.url)));
async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(sa.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
    .setProtectedHeader({ alg: 'RS256' }).setIssuer(sa.client_email).setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  return (await res.json()).access_token;
}
function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toFsValue(val);
    return { mapValue: { fields } };
  }
  throw new Error(`Cannot convert: ${v}`);
}

const token = await accessToken();
const projectId = sa.project_id;
const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

const rootFields = {};
const fieldPaths = [];
for (const p of targets) {
  const line = found[p.rank];
  if (!line) continue;
  const fpts = Math.round(fptsFromRaw(line) * 10) / 10;
  const entry = { played: true, date: DATE, live: false, nfl: true, fpts, ...line };
  delete entry.rank; delete entry.name; // not part of the client's lastNight shape
  rootFields[String(p.rank)] = toFsValue(entry);
  fieldPaths.push('data.`' + p.rank + '`');
}
if (!fieldPaths.length) { console.log('Nothing to write.'); process.exit(0); }

const qs = fieldPaths.map(fp => `updateMask.fieldPaths=${encodeURIComponent(fp)}`).join('&')
  + `&updateMask.fieldPaths=${encodeURIComponent('updatedAt')}`;
const body = { fields: { data: { mapValue: { fields: rootFields } }, updatedAt: toFsValue(Date.now()) } };
const res = await fetch(`${base}/config/lastNight?${qs}`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (!res.ok) throw new Error(`patch failed: ${await res.text()}`);
console.log(`\nWrote lastNight for ${fieldPaths.length} player(s).`);
