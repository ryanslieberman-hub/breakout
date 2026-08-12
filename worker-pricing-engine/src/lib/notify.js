// Looks up who to notify and fires the pushes. Two entry points:
//   notifyHoldersOfPlayer - "you own a player that just moved a lot"
//   notifyPortfolioSummary - "here's how your whole portfolio did today"
// Both go uid -> pushTokens -> sendPush, and both prune tokens FCM reports
// as UNREGISTERED so a dead token doesn't get retried forever.
import { firestoreQuery, firestoreDeleteDoc } from './firestore.js';
import { sendPush } from './push.js';

async function tokensForUid(env, uid) {
  const rows = await firestoreQuery(env, 'pushTokens', [{ field: 'uid', op: 'EQUAL', value: uid }]);
  return rows.map(r => r.id);
}

async function sendToUid(env, uid, notification, data) {
  const tokens = await tokensForUid(env, uid);
  for (const token of tokens) {
    try {
      await sendPush(env, token, { ...notification, data });
    } catch (e) {
      if (e.unregistered) {
        await firestoreDeleteDoc(env, `pushTokens/${token}`).catch(() => {});
      } else {
        console.error(`push to uid ${uid} failed:`, e.message);
      }
    }
  }
}

// portfolios/{uid}.holdings is keyed by the player's global rank (see
// index.js docPath) - `holdings.<rank>.shares > 0` is a single-field filter
// on a concrete field path, so it's covered by Firestore's automatic
// single-field indexes without needing a composite index defined anywhere.
export async function notifyHoldersOfPlayer(env, rank, notification) {
  const holders = await firestoreQuery(env, 'portfolios', [
    { field: `holdings.${rank}.shares`, op: 'GREATER_THAN', value: 0 },
  ]);
  for (const holder of holders) {
    await sendToUid(env, holder.id, notification, { rank: String(rank) });
  }
  return holders.length;
}

export async function notifyUid(env, uid, notification, data) {
  await sendToUid(env, uid, notification, data);
}
