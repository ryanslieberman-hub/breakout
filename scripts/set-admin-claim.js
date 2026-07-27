// One-off script: grants the Firebase custom "admin" claim to a user.
// This replaces the old hardcoded client-side admin password - admin status
// now comes from a claim on the user's ID token, checked in index.html via
// refreshAdminClaim() and enforced (for anything money-related) in
// firestore.rules.
//
// Usage:
//   1. npm install firebase-admin
//   2. Firebase Console > Project Settings > Service Accounts >
//      Generate new private key. Save it locally (e.g. serviceAccountKey.json)
//      - NEVER commit this file. It is already covered by .gitignore.
//   3. Find the target user's uid: Firebase Console > Authentication > Users.
//   4. node scripts/set-admin-claim.js <uid> <path-to-service-account.json>
//
// The user must sign out and back in (or wait for their ID token to refresh,
// up to ~1hr) before the claim takes effect in the app.

const path = require('path');
const admin = require('firebase-admin');

const [, , uid, keyPath] = process.argv;
if (!uid || !keyPath) {
  console.error('Usage: node set-admin-claim.js <uid> <path-to-service-account.json>');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(keyPath))),
});

admin.auth().setCustomUserClaims(uid, { admin: true })
  .then(() => {
    console.log(`Granted admin claim to ${uid}.`);
    console.log('They must sign out/in (or wait for token refresh) for it to take effect.');
    process.exit(0);
  })
  .catch(err => { console.error(err); process.exit(1); });
