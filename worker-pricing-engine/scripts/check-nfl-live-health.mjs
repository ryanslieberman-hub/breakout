// Read-only health check for a specific NFL game's price data in production
// config/prices. Written 2026-09-14 to sanity-check the Broncos @ Chiefs MNF
// game after a day of fixing the syncPricesToFirestore wholesale-overwrite bug
// (see reference_breakout_pricing_split memory / commit 7d6d0cb) - confirms
// the fix is holding under real concurrent-user load, not just in isolated
// testing. Read-only: does not call the live app, does not write anything.
//
// Usage: node scripts/check-nfl-live-health.mjs [--date YYYY-MM-DD] [team,team,...]
//   node scripts/check-nfl-live-health.mjs --date 2026-09-14 "Denver Broncos" "Kansas City Chiefs"
// Defaults to today (Eastern) and Denver Broncos / Kansas City Chiefs if no args given.

import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';
import { nflStatPrice } from '../src/engine.js';

const nflRaw = JSON.parse(readFileSync(new URL('../data/nfl-raw.json', import.meta.url)))
  .map(p => ({ ...p, statPrice: nflStatPrice(p) }));

const args = process.argv.slice(2);
const dateIdx = args.indexOf('--date');
const DATE = dateIdx >= 0 ? args[dateIdx + 1] : new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const teamArgs = args.filter((a, i) => !(dateIdx >= 0 && (i === dateIdx || i === dateIdx + 1)));
const TEAMS = teamArgs.length ? teamArgs : ['Denver Broncos', 'Kansas City Chiefs'];

const roster = nflRaw.filter(p => TEAMS.includes(p.team));
console.log(`Checking ${roster.length} roster players across: ${TEAMS.join(', ')} — date ${DATE}`);

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
function fromV(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('mapValue' in v) { const o = {}; for (const [k, vv] of Object.entries(v.mapValue.fields || {})) o[k] = fromV(vv); return o; }
  return null;
}

const token = await accessToken();
const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
const res = await fetch(`${base}/config/prices`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) throw new Error(`Firestore read failed: ${await res.text()}`);
const json = await res.json();
const doc = { date: fromV(json.fields.date), savedAt: fromV(json.fields.savedAt), closes: fromV(json.fields.closes) || {}, liveP: fromV(json.fields.liveP) || {} };

console.log(`\nconfig/prices doc: date=${doc.date}, savedAt=${doc.savedAt ? new Date(doc.savedAt).toISOString() : 'n/a'}`);

let withTodayClose = 0, flatAtStatPrice = 0;
const rows = [];
for (const p of roster) {
  const c = doc.closes[String(p.rank)] || {};
  const todayClose = c[DATE];
  const live = doc.liveP[String(p.rank)];
  const hasToday = todayClose !== undefined;
  if (hasToday) withTodayClose++;
  const nearStatPrice = live != null && Math.abs(live - p.statPrice) / p.statPrice < 0.005;
  if (nearStatPrice) flatAtStatPrice++;
  rows.push({
    name: p.name, rank: p.rank, statPrice: Math.round(p.statPrice * 100) / 100,
    liveP: live != null ? Math.round(live * 100) / 100 : null,
    todayClose: hasToday ? Math.round(todayClose * 100) / 100 : null,
    pct: live != null ? Math.round((live - p.statPrice) / p.statPrice * 1000) / 10 : null,
  });
}

rows.sort((a, b) => Math.abs(b.pct || 0) - Math.abs(a.pct || 0));
console.log(`\nTop movers (${roster.length} tracked, ${withTodayClose} with a ${DATE} close, ${flatAtStatPrice} flat at statPrice):`);
for (const r of rows.slice(0, 15)) {
  console.log(`  ${r.name.padEnd(24)} #${r.rank}  statPrice=${r.statPrice}  live=${r.liveP}  today's close=${r.todayClose ?? '—'}  (${r.pct >= 0 ? '+' : ''}${r.pct}%)`);
}

console.log(`\nSummary: ${withTodayClose}/${roster.length} players have a ${DATE} close recorded. ${flatAtStatPrice}/${roster.length} sit within 0.5% of their preseason statPrice (expected pre-kickoff; a red flag if it's late in/after the game and this number hasn't dropped).`);
