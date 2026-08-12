import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayTrades, portfolioValue, START_VALUE } from './tradeReplay.js';

const RANK = 5;
const STAT_PRICE = 100;
const statPriceLookup = (rank) => async (r) => (r === rank ? STAT_PRICE : null);

test('replayTrades without getStatPrice behaves as before (no band enforced)', async () => {
  const trades = [
    { rank: RANK, type: 'buy', shares: 10, price: 5000, ts: 1 }, // wildly outside any band
  ];
  const { cash, holdings, rejected } = await replayTrades(trades);
  assert.equal(rejected.length, 0);
  assert.equal(holdings[RANK], 10);
  assert.equal(cash, START_VALUE - 50000);
});

test('rejects a forged low-price buy outside the trusted band', async () => {
  const trades = [
    { rank: RANK, type: 'buy', shares: 1000, price: 0.01, ts: 1 }, // real statPrice is 100
  ];
  const { cash, holdings, rejected } = await replayTrades(trades, statPriceLookup(RANK));
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /outside trusted band/);
  assert.equal(Object.keys(holdings).length, 0);
  assert.equal(cash, START_VALUE);
});

test('accepts a buy priced just inside the band', async () => {
  const price = STAT_PRICE * 1.69; // inside [0.55, 1.7] * statPrice
  const trades = [
    { rank: RANK, type: 'buy', shares: 10, price, ts: 1 },
  ];
  const { cash, holdings, rejected } = await replayTrades(trades, statPriceLookup(RANK));
  assert.equal(rejected.length, 0);
  assert.equal(holdings[RANK], 10);
  assert.equal(cash, START_VALUE - 10 * price);
});

test('rejects a buy priced just outside the band', async () => {
  const price = STAT_PRICE * 1.71; // just above [0.55, 1.7] * statPrice
  const trades = [
    { rank: RANK, type: 'buy', shares: 10, price, ts: 1 },
  ];
  const { holdings, rejected } = await replayTrades(trades, statPriceLookup(RANK));
  assert.equal(rejected.length, 1);
  assert.equal(Object.keys(holdings).length, 0);
});

test('rejects any trade for a rank with no resolvable statPrice', async () => {
  const trades = [
    { rank: 999, type: 'buy', shares: 10, price: 100, ts: 1 },
  ];
  const { holdings, rejected } = await replayTrades(trades, statPriceLookup(RANK)); // lookup only knows RANK
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /no trusted statPrice/);
  assert.equal(Object.keys(holdings).length, 0);
});

test('a wash trade (buy then sell) on an unheld rank is still price-validated', async () => {
  // Buy cheap-fabricated, then sell at the same fabricated price - net cash
  // effect near zero either way, but both legs must still be rejected so a
  // forged price can never enter the replay at all.
  const trades = [
    { rank: RANK, type: 'buy', shares: 1000, price: 0.01, ts: 1 },
    { rank: RANK, type: 'sell', shares: 1000, price: 0.01, ts: 2 },
  ];
  const { cash, holdings, rejected } = await replayTrades(trades, statPriceLookup(RANK));
  assert.equal(rejected.length, 2);
  assert.equal(cash, START_VALUE);
  assert.equal(Object.keys(holdings).length, 0);
});

test('existing insufficient-cash rejection still works alongside band checks', async () => {
  const price = STAT_PRICE; // inside band
  const trades = [
    { rank: RANK, type: 'buy', shares: 100000, price, ts: 1 }, // costs way more than START_VALUE
  ];
  const { cash, holdings, rejected } = await replayTrades(trades, statPriceLookup(RANK));
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /insufficient cash/);
  assert.equal(cash, START_VALUE);
  assert.equal(Object.keys(holdings).length, 0);
});

test('existing insufficient-shares rejection still works alongside band checks', async () => {
  const price = STAT_PRICE;
  const trades = [
    { rank: RANK, type: 'buy', shares: 10, price, ts: 1 },
    { rank: RANK, type: 'sell', shares: 20, price, ts: 2 }, // selling more than held
  ];
  const { cash, holdings, rejected } = await replayTrades(trades, statPriceLookup(RANK));
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /insufficient shares/);
  assert.equal(holdings[RANK], 10);
  assert.equal(cash, START_VALUE - 10 * price);
});

test('portfolioValue still throws on a held rank with no trusted price (unchanged)', () => {
  assert.throws(() => portfolioValue({ cash: 100, holdings: { [RANK]: 5 } }, {}), /No trusted price/);
});

test('startingCash defaults to START_VALUE when omitted (existing callers unaffected)', async () => {
  const { cash } = await replayTrades([]);
  assert.equal(cash, START_VALUE);
});

test('startingCash overrides the $100k default - a sweeps coin balance, not a challenge pot', async () => {
  const price = STAT_PRICE; // inside band
  const trades = [
    { rank: RANK, type: 'buy', shares: 10, price, ts: 1 },
  ];
  const { cash, holdings, rejected } = await replayTrades(trades, statPriceLookup(RANK), 5000);
  assert.equal(rejected.length, 0);
  assert.equal(holdings[RANK], 10);
  assert.equal(cash, 5000 - 10 * price);
});

test('insufficient-cash rejection respects a variable startingCash, not the fixed $100k', async () => {
  const price = STAT_PRICE; // inside band
  const trades = [
    { rank: RANK, type: 'buy', shares: 60, price, ts: 1 }, // costs 6000, more than a 5000 starting balance
  ];
  const { cash, holdings, rejected } = await replayTrades(trades, statPriceLookup(RANK), 5000);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /insufficient cash/);
  assert.equal(cash, 5000);
  assert.equal(Object.keys(holdings).length, 0);
});
