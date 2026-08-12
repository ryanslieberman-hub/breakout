// Looks up who to notify and fires the pushes. Two entry points:
//   notifyAllTokens - "a player just moved a lot" (market-wide, not holder-scoped)
//   notifyUid       - "here's how your own portfolio did today"
// Both prune tokens FCM reports as UNREGISTERED so a dead token doesn't get
// retried forever.
import { firestoreQuery, firestoreListCollection, firestoreDeleteDoc } from './firestore.js';
import { sendPush } from './push.js';

async function sendToToken(env, token, notification, data) {
  try {
    await sendPush(env, token, { ...notification, data });
    return true;
  } catch (e) {
    if (e.unregistered) {
      await firestoreDeleteDoc(env, `pushTokens/${token}`).catch(() => {});
    } else {
      console.error(`push to token ${token.slice(0, 12)}... failed:`, e.message);
    }
    return false;
  }
}

// Market-wide alerts (big/fast price moves) go to every registered device,
// not just holders - every pushTokens doc is already tied to a signed-in
// user (see index.html's enablePushNotifications), so this is exactly
// "everyone who opted in", no join against portfolios/users needed.
export async function notifyAllTokens(env, notification, data) {
  const tokens = await firestoreListCollection(env, 'pushTokens');
  let sent = 0;
  for (const t of tokens) {
    if (await sendToToken(env, t.id, notification, data)) sent++;
  }
  return sent;
}

export async function notifyUid(env, uid, notification, data) {
  const tokens = await firestoreQuery(env, 'pushTokens', [{ field: 'uid', op: 'EQUAL', value: uid }]);
  for (const t of tokens) await sendToToken(env, t.id, notification, data);
}
