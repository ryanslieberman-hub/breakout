// Looks up who to notify and fires the push(es) for one uid - used by the
// chat reply/reaction/mention notifications in index.js. Only notifyUid is
// needed here (unlike worker-pricing-engine's notify.js, this worker never
// broadcasts to every device). Prunes tokens FCM reports as UNREGISTERED so
// a dead token doesn't get retried forever.
import { firestoreQuery, firestoreDeleteDoc } from './firestore.js';
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

export async function notifyUid(env, uid, notification, data) {
  const tokens = await firestoreQuery(env, 'pushTokens', [{ field: 'uid', op: 'EQUAL', value: uid }]);
  for (const t of tokens) await sendToToken(env, t.id, notification, data);
}
