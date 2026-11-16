// Read-only: reports which of the given player ranks anyone currently holds
// shares of, or has on a watchlist, across every portfolio (the main
// portfolios/{uid} doc plus its wallets/* and challenges/* sub-docs) and
// users/{uid}. Run before removing players from the roster - removing a held
// player strands those shares.
//
// Prints counts only, never who holds what.
//
// Usage: node scripts/check-holdings-for-ranks.mjs 3532 3565 ...
//    or: node scripts/check-holdings-for-ranks.mjs --file ranks.json   (JSON array of ranks)

import { readFileSync } from 'node:fs';
import { firestoreQuery, firestoreListCollection } from '../src/lib/firestore.js';

const args = process.argv.slice(2);
const fi = args.indexOf('--file');
const ranks = (fi >= 0 ? JSON.parse(readFileSync(args[fi + 1], 'utf8')) : args).map(Number).filter(Boolean);
if (!ranks.length) { console.log('Usage: node scripts/check-holdings-for-ranks.mjs <rank> [...] | --file ranks.json'); process.exit(1); }
const want = new Set(ranks);

const saText = readFileSync(new URL('../../worker-payments/service-account-key.json', import.meta.url), 'utf8');
const env = { FIREBASE_SERVICE_ACCOUNT: saText, FIREBASE_PROJECT_ID: JSON.parse(saText).project_id };

const held = {}, watched = {}; // rank -> { holders, shares } / count
const note = (holdings, where) => {
  for (const [rank, h] of Object.entries(holdings || {})) {
    if (!want.has(Number(rank)) || !(h && h.shares > 0)) continue;
    const e = held[rank] || (held[rank] = { holders: 0, shares: 0, where: new Set() });
    e.holders++; e.shares += h.shares; e.where.add(where);
  }
};
const noteWatch = list => {
  const arr = Array.isArray(list) ? list : (list && typeof list === 'object' ? Object.keys(list) : []);
  for (const r of arr) if (want.has(Number(r))) watched[r] = (watched[r] || 0) + 1;
};

const portfolios = await firestoreQuery(env, 'portfolios');
let docs = 0;
for (const p of portfolios) {
  docs++; note(p.holdings, 'main'); noteWatch(p.watchlist);
  for (const sub of ['wallets', 'challenges']) {
    const list = await firestoreListCollection(env, `portfolios/${p.id}/${sub}?pageSize=300`).catch(() => []);
    for (const d of list) { docs++; note(d.holdings, sub); noteWatch(d.watchlist); }
  }
}
const users = await firestoreQuery(env, 'users');
for (const u of users) noteWatch(u.watchlist);

console.log(`Scanned ${portfolios.length} portfolio(s), ${docs} portfolio doc(s), ${users.length} user doc(s) for ${ranks.length} rank(s).\n`);
const heldRanks = Object.keys(held);
console.log(`HELD (${heldRanks.length}):`);
for (const r of heldRanks) console.log(`  #${r}: ${held[r].holders} holder(s), ${held[r].shares} share(s) [${[...held[r].where].join(', ')}]`);
console.log(`\nON A WATCHLIST (${Object.keys(watched).length}):`);
for (const [r, n] of Object.entries(watched)) console.log(`  #${r}: ${n}`);
console.log('\nHELD_RANKS=' + JSON.stringify(heldRanks.map(Number)));
