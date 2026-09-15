// One-shot repair for the config/prices mirror-drift bug (see mirrorClose in
// src/index.js and reference_breakout_pricing_split memory).
//
// priceEngine/* (this worker's own price history) and config/prices (what the
// client actually charts) are two independently-computed histories that drift
// apart over weeks of ticks. Before the mirrorClose fix, tickMlb/tickNfl
// mirrored the WORKER's own absolute close into config/prices, clamped only
// to a wide statPrice band (and, briefly, to a ±15%-of-the-worker's-own-prior
// cap) - neither of which catches the case where the worker's internal base
// has drifted from the client's own prior close: the mirrored value can look
// perfectly reasonable in isolation while still representing the WRONG
// percentage move once applied to what the client already shows. Confirmed
// live 2026-09-15: Ben Rice went 2-for-3 with 2 RBI (a real, good game - this
// engine's own math says +5.1%), but his worker-side base had drifted to
// $426.77 while config/prices already showed $476.50 - mirroring the
// worker's own correctly-derived-from-ITS-base close ($449.00) read as a
// -5.8% DROP on the client. The move was right; the base it got applied to
// wasn't.
//
// This script re-derives what SHOULD have been mirrored for each rank's most
// recent config/prices close: it reads the worker's own priceEngine/* closes
// to recover the REAL implied percentage move for that date (from the
// worker's own two most recent closes, which is exactly the perf finalize()
// locked in), then re-applies that same percentage move to config/prices's
// OWN prior close - the same logic mirrorClose now uses going forward. Any
// rank where the currently-stored config/prices close doesn't match that
// re-derivation (beyond rounding) gets corrected, whether the discrepancy was
// a dramatic >15% jump or a smaller but still-wrong-direction drift.
//
// Read-only by default. Pass --apply to actually write the corrections.
// Usage: node scripts/repair-mirror-drift.mjs [--apply]

import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';
import { mlbStatPrice, nflStatPrice } from '../src/engine.js';
import { firestoreBatchGetDocs, firestoreSetDeepFields } from '../src/lib/firestore.js';

const APPLY = process.argv.includes('--apply');

const mlbRaw = JSON.parse(readFileSync(new URL('../data/mlb-raw.json', import.meta.url)))
  .map(p => ({ ...p, statPrice: mlbStatPrice(p), league: 'mlb' }));
const nflRaw = JSON.parse(readFileSync(new URL('../data/nfl-raw.json', import.meta.url)))
  .map(p => ({ ...p, statPrice: nflStatPrice(p), league: 'nfl' }));
const allPlayers = [...mlbRaw, ...nflRaw];
const byRank = {};
for (const p of allPlayers) byRank[p.rank] = p;

const sa = JSON.parse(readFileSync(new URL('../../worker-payments/service-account-key.json', import.meta.url)));
const env = { FIREBASE_PROJECT_ID: sa.project_id, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(sa) };

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
const clientCloses = fromV(json.fields.closes) || {};
const liveP = fromV(json.fields.liveP) || {};

// Only ranks with a client-visible close worth checking.
const ranksToCheck = Object.keys(clientCloses)
  .map(Number)
  .filter(r => byRank[r] && clientCloses[r] && Object.keys(clientCloses[r]).length >= 2);

const docPath = r => `priceEngine/${byRank[r].league}_${r}`;
const priceEngineDocs = await firestoreBatchGetDocs(env, ranksToCheck.map(docPath));

const fixes = [];
for (const rank of ranksToCheck) {
  const p = byRank[rank];
  const c = clientCloses[rank];
  const dates = Object.keys(c).filter(d => c[d] > 0).sort();
  const lastDate = dates[dates.length - 1];
  const prevDate = dates[dates.length - 2];
  const clientPrior = c[prevDate];
  const clientLast = c[lastDate];

  const peDoc = priceEngineDocs[docPath(rank)];
  const peCloses = peDoc?.closes || {};
  const peDates = Object.keys(peCloses).filter(d => peCloses[d] > 0 && d <= lastDate).sort();
  if (peDates.length < 2 || peDates[peDates.length - 1] !== lastDate) continue; // no worker data to re-derive from
  const peLast = peCloses[peDates[peDates.length - 1]];
  const pePrev = peCloses[peDates[peDates.length - 2]];
  if (!(pePrev > 0)) continue;
  const impliedPerf = peLast / pePrev - 1;

  let correct = clientPrior * (1 + impliedPerf);
  correct = Math.min(clientPrior * 1.15, Math.max(clientPrior * 0.85, correct));
  correct = Math.min(p.statPrice * 1.68, Math.max(p.statPrice * 0.56, correct));

  if (Math.abs(correct - clientLast) / clientLast > 0.01) {
    fixes.push({
      rank, name: p.name, date: lastDate, prevDate, clientPrior, clientLast, correct,
      pctBad: ((clientLast - clientPrior) / clientPrior * 100).toFixed(1),
      pctCorrect: ((correct - clientPrior) / clientPrior * 100).toFixed(1),
      liveP: liveP[rank],
    });
  }
}

fixes.sort((a, b) => Math.abs(b.clientLast - b.correct) - Math.abs(a.clientLast - a.correct));
console.log(`Found ${fixes.length} rank(s) whose mirrored close doesn't match the real game-day move:\n`);
for (const f of fixes) {
  console.log(`  #${f.rank} ${f.name.padEnd(24)} ${f.prevDate}=${f.clientPrior.toFixed(2)} -> ${f.date}=${f.clientLast.toFixed(2)} (${f.pctBad}%)  =>  should be ${f.correct.toFixed(2)} (${f.pctCorrect}%)  [liveP was ${f.liveP?.toFixed?.(2)}]`);
}

if (!APPLY) {
  console.log(`\nDry run only - pass --apply to write these ${fixes.length} correction(s) to config/prices.`);
  process.exit(0);
}

const entries = [];
for (const f of fixes) {
  const corrected = Math.round(f.correct * 100) / 100;
  entries.push({ segments: ['closes', String(f.rank), f.date], value: corrected });
  // Only fix liveP if it still matches the bad close (a live game since then may have moved it further - don't clobber that).
  if (f.liveP != null && Math.abs(f.liveP - f.clientLast) < 0.01) {
    entries.push({ segments: ['liveP', String(f.rank)], value: corrected });
  }
}
await firestoreSetDeepFields(env, 'config/prices', entries);
console.log(`\nApplied ${fixes.length} correction(s) to config/prices.`);
