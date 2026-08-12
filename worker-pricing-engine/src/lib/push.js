// Sends web push notifications via FCM's HTTP v1 API, using the same service
// account (and cached OAuth token) as the Firestore REST client - the token's
// scope already covers both, see firestore.js.
import { getAccessToken } from './firestore.js';

// Sends to one token. FCM v1 has no true multicast send, so callers that
// need to reach many tokens loop this - fine at this project's scale (single
// digits of tokens today), and each failure is isolated from the rest.
//
// Deliberately data-only (no top-level `notification` field): a message that
// carries `notification` gets auto-displayed by the browser AND handled by
// firebase-messaging-sw.js's onBackgroundMessage, showing every push twice.
// title/body ride inside `data` instead, and the SW is the only thing that
// ever calls showNotification().
export async function sendPush(env, token, { title, body, data } = {}) {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const accessToken = await getAccessToken(env);
  const message = {
    token,
    data: Object.fromEntries(
      Object.entries({ title, body, ...data }).map(([k, v]) => [k, String(v)])
    ),
  };
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    // UNREGISTERED means the token is dead (uninstalled, permission revoked,
    // etc.) - the caller is expected to prune it, not just log and retry it forever.
    const isUnregistered = res.status === 404 || errText.includes('UNREGISTERED');
    const err = new Error(`FCM send failed (${res.status}): ${errText}`);
    err.unregistered = isUnregistered;
    throw err;
  }
  return res.json();
}
