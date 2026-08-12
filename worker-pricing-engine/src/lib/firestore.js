// Minimal Firestore REST API client authenticated as a service account.
// Identical to worker-payments/src/lib/firestore.js - duplicated rather than
// shared since these are separate Worker projects with independent deploys.
// Requests made this way are NOT subject to firestore.rules (same as the
// Admin SDK) - that's the whole point: this is the only code path allowed to
// write priceEngine/*.
import { SignJWT, importPKCS8 } from 'jose';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// One token covers both Firestore REST and FCM send (lib/push.js) - a single
// space-separated `scope` claim is enough, so both share one JWT exchange
// and one per-isolate cache instead of running the RS256 sign twice.
const SCOPE = 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging';

let cachedToken = null; // { token, expiresAt } - per-isolate cache, best effort

export async function getAccessToken(env) {
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

export async function firestoreDeleteDoc(env, path) {
  const token = await getAccessToken(env);
  const res = await fetch(`${baseUrl(env.FIREBASE_PROJECT_ID)}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`Firestore delete failed (${path}): ${await res.text()}`);
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

function docNamePrefix(projectId) {
  return `projects/${projectId}/databases/(default)/documents/`;
}

// Fetches many docs in ONE HTTP request instead of one-per-doc - this is the
// difference between a Worker invocation making 2 subrequests or 260 of them
// (Cloudflare caps subrequests per invocation; processing every player
// individually blew through that limit in production even though it never
// showed up locally, since wrangler dev doesn't enforce the same cap).
// Returns { path -> fields-object | null } (null = doc doesn't exist).
export async function firestoreBatchGetDocs(env, paths) {
  if (!paths.length) return {};
  const token = await getAccessToken(env);
  const prefix = docNamePrefix(env.FIREBASE_PROJECT_ID);
  const res = await fetch(`${baseUrl(env.FIREBASE_PROJECT_ID)}:batchGet`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents: paths.map(p => prefix + p) }),
  });
  if (!res.ok) throw new Error(`Firestore batchGet failed: ${await res.text()}`);
  const rows = await res.json();
  const out = {};
  for (const row of rows) {
    if (row.found) {
      const path = row.found.name.slice(prefix.length);
      out[path] = fromFirestoreFields(row.found.fields);
    } else if (row.missing) {
      out[row.missing.slice(prefix.length)] = null;
    }
  }
  return out;
}

// Merge-patches many docs in one (non-transactional) request. `updates` is
// [{path, fields}]. Firestore's batchWrite caps at 500 writes/request, so
// this chunks defensively.
export async function firestoreBatchWriteDocs(env, updates) {
  if (!updates.length) return;
  const token = await getAccessToken(env);
  const prefix = docNamePrefix(env.FIREBASE_PROJECT_ID);
  const CHUNK = 500;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const writes = chunk.map(({ path, fields }) => {
      const body = { fields: {} };
      for (const [k, v] of Object.entries(fields)) body.fields[k] = toFirestoreValue(v);
      return {
        update: { name: prefix + path, ...body },
        updateMask: { fieldPaths: Object.keys(fields) },
        currentDocument: {}, // no precondition - always upsert
      };
    });
    const res = await fetch(`${baseUrl(env.FIREBASE_PROJECT_ID)}:batchWrite`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes }),
    });
    if (!res.ok) throw new Error(`Firestore batchWrite failed: ${await res.text()}`);
  }
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

// Sets exactly one nested field via a dotted path without touching sibling
// keys in the same map (e.g. "closes.2026-07-27").
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

export async function firestoreListCollection(env, path) {
  const token = await getAccessToken(env);
  const res = await fetch(`${baseUrl(env.FIREBASE_PROJECT_ID)}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Firestore list failed (${path}): ${await res.text()}`);
  const json = await res.json();
  return (json.documents || []).map(d => ({ id: d.name.split('/').pop(), ...fromFirestoreFields(d.fields) }));
}
