// Read-only: dumps every config/* doc to a timestamped JSON file so shared
// price history can be restored if the (client-writable) docs get vandalised.
// Usage: node scripts/backup-config.js <path-to-service-account.json> [outDir]
const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const [, , keyPath, outDir = 'backups'] = process.argv;
if (!keyPath) { console.error('Usage: node backup-config.js <service-account.json> [outDir]'); process.exit(1); }
initializeApp({ credential: cert(require(path.resolve(keyPath))) });

(async () => {
  const snap = await getFirestore().collection('config').get();
  const out = {};
  snap.forEach(d => { out[d.id] = d.data(); });
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `config-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`Wrote ${snap.size} docs (${Object.keys(out).join(', ')}) -> ${file} (${fs.statSync(file).size} bytes)`);
})();
