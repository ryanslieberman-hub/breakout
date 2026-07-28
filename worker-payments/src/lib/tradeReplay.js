// Derives a trustworthy (cash, holdings) pair for a user by replaying their
// own `trades` log (append-only, owner-authored, locked to create-only by
// firestore.rules) instead of trusting the self-reported portfolios/{uid}
// snapshot. A legitimate client can never produce a trade that overspends
// cash or oversells shares - if one appears, it's a tamper attempt (or a
// client bug) and is rejected rather than silently trusted.
export const START_VALUE = 100000;

const EPSILON = 1e-6;

// trades: array of Firestore trade docs {rank, type:'buy'|'sell', shares, price, ts, ...}
// Returns { cash, holdings: {[rank]: shares}, rejected: [{trade, reason}] }
export function replayTrades(trades) {
  const sorted = [...trades].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  let cash = START_VALUE;
  const holdings = {};
  const rejected = [];

  for (const t of sorted) {
    const rank = t.rank;
    const shares = Number(t.shares);
    const price = Number(t.price);

    if (!rank || !(shares > 0) || !(price > 0)) {
      rejected.push({ trade: t, reason: 'invalid rank/shares/price' });
      continue;
    }

    if (t.type === 'buy') {
      const cost = shares * price;
      if (cost > cash + EPSILON) {
        rejected.push({ trade: t, reason: `insufficient cash: cost ${cost} > cash ${cash}` });
        continue;
      }
      cash -= cost;
      holdings[rank] = (holdings[rank] || 0) + shares;
    } else if (t.type === 'sell') {
      const have = holdings[rank] || 0;
      if (shares > have + EPSILON) {
        rejected.push({ trade: t, reason: `insufficient shares: selling ${shares} > held ${have}` });
        continue;
      }
      cash += shares * price;
      holdings[rank] = have - shares;
      if (holdings[rank] <= EPSILON) delete holdings[rank];
    } else {
      rejected.push({ trade: t, reason: `unknown trade type: ${t.type}` });
    }
  }

  return { cash, holdings, rejected };
}

// priceByRank: { [rank]: currentPrice } - must cover every rank in holdings,
// or this throws (settlement should treat that as "can't value this
// portfolio yet", never silently substitute a guess).
export function portfolioValue({ cash, holdings }, priceByRank) {
  let value = cash;
  for (const [rank, shares] of Object.entries(holdings)) {
    const price = priceByRank[rank];
    if (price == null) throw new Error(`No trusted price available for rank ${rank}`);
    value += shares * price;
  }
  return value;
}
