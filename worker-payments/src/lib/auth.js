// Verifies Firebase Auth ID tokens without the Admin SDK, using Google's
// public JWKS. This is the only thing standing between "anyone can claim to
// be any uid" and real identity - do not simplify this away.
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

// Returns { uid, admin, claims } on success, throws on any failure.
export async function verifyFirebaseIdToken(idToken, projectId) {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });
  if (!payload.sub) throw new Error('Token missing subject');
  return { uid: payload.sub, admin: payload.admin === true, claims: payload };
}

export function bearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer (.+)$/);
  return match ? match[1] : null;
}
