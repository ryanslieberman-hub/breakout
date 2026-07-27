// Minimal Firestore REST API client authenticated as a service account.
// Requests made this way are NOT subject to firestore.rules (same as the
// Admin SDK) - that's the whole point: this is the only code path allowed
// to write `challenges/{id}.participants` or read/write challengeSnapshots.
import { SignJWT, importPKCS8 } from 'jose';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';

let cachedToken = null; // { token, expiresAt } - per-isolate cache, best effort

async function getAccessToken(env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const key = await importPKCS8(sa.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(sa.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`Firebase token exchange failed: ${await res.text()}`);
  const json = await res.json();
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.token;
}

function baseUrl(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

// ── JS <-> Firestore REST value conversion ──
export function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toFirestoreValue(val);
    return { mapValue: { fields } };
  }
  throw new Error(`Cannot convert value to Firestore type: ${v}`);
}

export function fromFirestoreValue(fv) {
  if (!fv) return null;
  if ('stringValue' in fv) return fv.stringValue;
  if ('integerValue' in fv) return Number(fv.integerValue);
  if ('doubleValue' in fv) return fv.doubleValue;
  if ('booleanValue' in fv) return fv.booleanValue;
  if ('nullValue' in fv) return null;
  if ('timestampValue' in fv) return new Date(fv.timestampValue).getTime();
  if ('mapValue' in fv) return fromFirestoreFields(fv.mapValue.fields || {});
  if ('arrayValue' in fv) return (fv.arrayValue.values || []).map(fromFirestoreValue);
  throw new Error(`Unknown Firestore value type: ${JSON.stringify(fv)}`);
}

export function fromFirestoreFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromFirestoreValue(v);
  return out;
}

export async function firestoreGetDoc(env, path) {
  const token = await getAccessToken(env);
  const res = await fetch(`${baseUrl(env.FIREBASE_PROJECT_ID)}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore get failed (${path}): ${await res.text()}`);
  const json = await res.json();
  return fromFirestoreFields(json.fields);
}

// Merge-patches the given top-level fields onto the document (creates it if
// it doesn't exist). `fields` is a plain JS object of {fieldName: value}.
export async function firestorePatchDoc(env, path, fields) {
  const token = await getAccessToken(env);
  const fieldPaths = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const body = { fields: {} };
  for (const [k, v] of Object.entries(fields)) body.fields[k] = toFirestoreValue(v);

  const res = await fetch(`${baseUrl(env.FIREBASE_PROJECT_ID)}/${path}?${fieldPaths}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firestore patch failed (${path}): ${await res.text()}`);
  return fromFirestoreFields((await res.json()).fields);
}

// Sets exactly one nested field via a dotted path (e.g. "participants.abc123")
// without touching sibling keys in the same map - used to record a single
// paid entry into challenges/{id}.participants.{uid}.
export async function firestoreSetNestedField(env, path, dottedFieldPath, value) {
  const token = await getAccessToken(env);
  const [top, ...rest] = dottedFieldPath.split('.');
  const body = { fields: {} };
  if (rest.length === 0) {
    body.fields[top] = toFirestoreValue(value);
  } else {
    body.fields[top] = { mapValue: { fields: {} } };
    let cursor = body.fields[top].mapValue.fields;
    for (let i = 0; i < rest.length; i++) {
      if (i === rest.length - 1) cursor[rest[i]] = toFirestoreValue(value);
      else {
        cursor[rest[i]] = { mapValue: { fields: {} } };
        cursor = cursor[rest[i]].mapValue.fields;
      }
    }
  }
  const res = await fetch(
    `${baseUrl(env.FIREBASE_PROJECT_ID)}/${path}?updateMask.fieldPaths=${encodeURIComponent(dottedFieldPath)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`Firestore nested patch failed (${path} -> ${dottedFieldPath}): ${await res.text()}`);
  return fromFirestoreFields((await res.json()).fields);
}

// Runs a structured query against a collection. `filters` is an array of
// { field, op, value } - op is one of Firestore's FieldFilter.Operator strings
// (e.g. 'LESS_THAN', 'EQUAL').
export async function firestoreQuery(env, collectionId, filters = []) {
  const token = await getAccessToken(env);
  const structuredQuery = {
    from: [{ collectionId }],
    where: filters.length
      ? {
          compositeFilter: {
            op: 'AND',
            filters: filters.map(f => ({
              fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: toFirestoreValue(f.value) },
            })),
          },
        }
      : undefined,
  };
  const res = await fetch(`${baseUrl(env.FIREBASE_PROJECT_ID)}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new Error(`Firestore query failed (${collectionId}): ${await res.text()}`);
  const rows = await res.json();
  return rows
    .filter(r => r.document)
    .map(r => ({ id: r.document.name.split('/').pop(), ...fromFirestoreFields(r.document.fields) }));
}

// Lists all documents in a subcollection, e.g. challengeSnapshots/{id}/entries.
export async function firestoreListCollection(env, path) {
  const token = await getAccessToken(env);
  const res = await fetch(`${baseUrl(env.FIREBASE_PROJECT_ID)}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Firestore list failed (${path}): ${await res.text()}`);
  const json = await res.json();
  return (json.documents || []).map(d => ({ id: d.name.split('/').pop(), ...fromFirestoreFields(d.fields) }));
}
