// Derives a trustworthy (cash, holdings) pair for a user by replaying their
// own `trades` log (append-only, owner-authored, locked to create-only by
// firestore.rules) instead of trusting the self-reported portfolios/{uid}
// snapshot. A legitimate client can never produce a trade that overspends
// cash or oversells shares - if one appears, it's a tamper attempt (or a
// client bug) and is rejected rather than silently trusted.
export const START_VALUE = 100000;

// Legitimate client-side prices never move further than this from a player's
// fundamental statPrice - see band() in worker-pricing-engine/src/engine.js
// (duplicated here rather than imported: these are two independently
// deployed Workers, and engine.js itself is already a kept-close-to-verbatim
// port rather than a shared module). A trade priced outside this band did not
// come from the real AMM and is treated as forged.
const PRICE_BAND = [0.55, 1.7];

const EPSILON = 1e-6;

// trades: array of Firestore trade docs {rank, type:'buy'|'sell', shares, price, ts, ...}
// getStatPrice: optional async (rank) => statPrice|null, used to reject any
// trade priced outside the legitimate band for its rank. A rank with no
// resolvable statPrice is treated the same as tampering - see
// portfolioValue()'s "never silently substitute a guess" below.
// startingCash: defaults to the fixed $100k every challenge starts at.
// Sweeps coin redemption passes a variable balance instead (net of that
// user's own coinDeposits/coinRedemptions ledger, see worker-payments'
// /coins/redeem) - coins accumulate over time via repeated purchases rather
// than starting once at a fixed pot, so this can't be a shared constant.
// Returns { cash, holdings: {[rank]: shares}, rejected: [{trade, reason}] }
export async function replayTrades(trades, getStatPrice, startingCash = START_VALUE) {
  const sorted = [...trades].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  let cash = startingCash;
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

    if (getStatPrice) {
      const statPrice = await getStatPrice(rank);
      if (statPrice == null) {
        rejected.push({ trade: t, reason: `no trusted statPrice available to validate price for rank ${rank}` });
        continue;
      }
      const lo = statPrice * PRICE_BAND[0];
      const hi = statPrice * PRICE_BAND[1];
      if (price < lo || price > hi) {
        rejected.push({ trade: t, reason: `price ${price} outside trusted band [${lo}, ${hi}] for rank ${rank}` });
        continue;
      }
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
