const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const DEFAULT_JWK_CACHE_MS = 5 * 60 * 1000;
const MAX_ID_TOKEN_BYTES = 16 * 1024;

interface JwtHeader {
  alg?: unknown;
  kid?: unknown;
}

interface JwtPayload {
  iss?: unknown;
  aud?: unknown;
  azp?: unknown;
  exp?: unknown;
  nbf?: unknown;
  sub?: unknown;
}

interface JwkSetResponse {
  keys?: unknown;
}

type GoogleRsaJwk = JsonWebKey & {
  kid: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
};

export interface GoogleIdentity {
  subject: string;
}

export class GoogleIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleIdentityError';
  }
}

export interface GoogleJwkProvider {
  getKey(kid: string, nowMs?: number): Promise<JsonWebKey>;
}

function decodeBase64Url(segment: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new GoogleIdentityError('Malformed Google ID token.');
  }
  const padding = '='.repeat((4 - (segment.length % 4)) % 4);
  const binary = atob(segment.replace(/-/g, '+').replace(/_/g, '/') + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson<T>(segment: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment))) as T;
  } catch (error) {
    if (error instanceof GoogleIdentityError) {
      throw error;
    }
    throw new GoogleIdentityError('Malformed Google ID token.');
  }
}

function cacheLifetimeMs(headers: Headers): number {
  const cacheControl = headers.get('cache-control') ?? '';
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl);
  if (!match) {
    return DEFAULT_JWK_CACHE_MS;
  }
  const seconds = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_JWK_CACHE_MS;
}

function asRsaJwk(value: unknown): GoogleRsaJwk | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const jwk = value as GoogleRsaJwk;
  if (jwk.kty !== 'RSA' || typeof jwk.kid !== 'string' || !jwk.kid || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
    return null;
  }
  if (jwk.alg !== undefined && jwk.alg !== 'RS256') {
    return null;
  }
  if (jwk.use !== undefined && jwk.use !== 'sig') {
    return null;
  }
  return jwk;
}

export class RemoteGoogleJwkProvider implements GoogleJwkProvider {
  private keys: GoogleRsaJwk[] = [];
  private expiresAtMs = 0;

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async refresh(nowMs: number): Promise<void> {
    let response: Response;
    try {
      response = await this.fetcher(GOOGLE_JWKS_URL, {
        headers: { accept: 'application/json' },
      });
    } catch {
      throw new GoogleIdentityError('Google signing keys are unavailable.');
    }
    if (!response.ok) {
      throw new GoogleIdentityError('Google signing keys are unavailable.');
    }

    let body: JwkSetResponse;
    try {
      body = (await response.json()) as JwkSetResponse;
    } catch {
      throw new GoogleIdentityError('Google signing keys are invalid.');
    }

    if (!Array.isArray(body.keys)) {
      throw new GoogleIdentityError('Google signing keys are invalid.');
    }
    const keys = body.keys.map(asRsaJwk).filter((key): key is GoogleRsaJwk => key !== null);
    if (keys.length === 0) {
      throw new GoogleIdentityError('Google signing keys are invalid.');
    }

    this.keys = keys;
    this.expiresAtMs = nowMs + cacheLifetimeMs(response.headers);
  }

  async getKey(kid: string, nowMs = Date.now()): Promise<JsonWebKey> {
    if (this.keys.length === 0 || nowMs >= this.expiresAtMs) {
      await this.refresh(nowMs);
    }

    let key = this.keys.find((candidate) => candidate.kid === kid);
    if (!key) {
      await this.refresh(nowMs);
      key = this.keys.find((candidate) => candidate.kid === kid);
    }
    if (!key) {
      throw new GoogleIdentityError('Google ID token signing key was not found.');
    }
    return key;
  }
}

const remoteGoogleJwks = new RemoteGoogleJwkProvider();

function validateAudience(payload: JwtPayload, clientId: string): void {
  const rawAudience = payload.aud;
  const audiences =
    typeof rawAudience === 'string'
      ? [rawAudience]
      : Array.isArray(rawAudience) && rawAudience.every((value) => typeof value === 'string')
        ? rawAudience
        : [];

  if (!audiences.includes(clientId)) {
    throw new GoogleIdentityError('Google ID token audience is invalid.');
  }
  if (audiences.length > 1 && payload.azp !== clientId) {
    throw new GoogleIdentityError('Google ID token authorized party is invalid.');
  }
}

export async function verifyGoogleIdToken(
  credential: string,
  clientId: string,
  provider: GoogleJwkProvider = remoteGoogleJwks,
  nowMs = Date.now(),
): Promise<GoogleIdentity> {
  if (!credential || new TextEncoder().encode(credential).byteLength > MAX_ID_TOKEN_BYTES) {
    throw new GoogleIdentityError('Google ID token is invalid.');
  }
  if (!clientId) {
    throw new GoogleIdentityError('Google client ID is not configured.');
  }

  const parts = credential.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new GoogleIdentityError('Malformed Google ID token.');
  }

  const header = decodeJson<JwtHeader>(parts[0]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new GoogleIdentityError('Google ID token header is invalid.');
  }

  const payload = decodeJson<JwtPayload>(parts[1]);
  const key = await provider.getKey(header.kid, nowMs);
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'jwk',
      key,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  } catch {
    throw new GoogleIdentityError('Google signing key is invalid.');
  }

  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!verified) {
    throw new GoogleIdentityError('Google ID token signature is invalid.');
  }

  if (typeof payload.iss !== 'string' || !GOOGLE_ISSUERS.has(payload.iss)) {
    throw new GoogleIdentityError('Google ID token issuer is invalid.');
  }
  validateAudience(payload, clientId);

  const nowSeconds = Math.floor(nowMs / 1000);
  if (typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp) || payload.exp <= nowSeconds) {
    throw new GoogleIdentityError('Google ID token is expired.');
  }
  if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || !Number.isSafeInteger(payload.nbf) || payload.nbf > nowSeconds)) {
    throw new GoogleIdentityError('Google ID token is not active yet.');
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 255) {
    throw new GoogleIdentityError('Google ID token subject is invalid.');
  }

  return { subject: payload.sub };
}
