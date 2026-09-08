const SESSION_VERSION = 1;
export const SESSION_COOKIE_NAME = '__Host-em_session';

interface SessionPayload {
  v: number;
  uid: string;
  iat: number;
  exp: number;
}

export interface SessionIdentity {
  userId: string;
  expiresAtMs: number;
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new SessionError('Session token is malformed.');
  }
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return buffer;
  } catch {
    throw new SessionError('Session token is malformed.');
  }
}

function requireSecret(secret: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(secret);
  if (encoded.byteLength < 32) {
    throw new SessionError('Session secret must be at least 32 bytes.');
  }
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}

function requireTtl(ttlSeconds: number): void {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 31 * 24 * 60 * 60) {
    throw new SessionError('Session TTL is outside the supported range.');
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    requireSecret(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export function parseSessionTtlSeconds(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }
  const ttl = Number(value);
  try {
    requireTtl(ttl);
    return ttl;
  } catch {
    return null;
  }
}

export async function createSessionToken(
  userId: string,
  secret: string,
  ttlSeconds: number,
  nowMs = Date.now(),
): Promise<string> {
  if (!userId) {
    throw new SessionError('Session user ID is required.');
  }
  requireTtl(ttlSeconds);
  const issuedAt = Math.floor(nowMs / 1000);
  const payload: SessionPayload = {
    v: SESSION_VERSION,
    uid: userId,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
  };
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload)),
  );
  return `${encodedPayload}.${encodeBase64Url(signature)}`;
}

export async function verifySessionToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): Promise<SessionIdentity> {
  const parts = token.split('.');
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new SessionError('Session token is malformed.');
  }

  const key = await hmacKey(secret);
  const verified = await crypto.subtle.verify(
    'HMAC',
    key,
    decodeBase64Url(parts[1]),
    new TextEncoder().encode(parts[0]),
  );
  if (!verified) {
    throw new SessionError('Session signature is invalid.');
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]))) as SessionPayload;
  } catch {
    throw new SessionError('Session payload is invalid.');
  }
  if (
    payload.v !== SESSION_VERSION ||
    typeof payload.uid !== 'string' ||
    !payload.uid ||
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= payload.iat
  ) {
    throw new SessionError('Session payload is invalid.');
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  if (payload.iat > nowSeconds || payload.exp <= nowSeconds) {
    throw new SessionError('Session is expired or not active yet.');
  }

  return { userId: payload.uid, expiresAtMs: payload.exp * 1000 };
}

export function readCookieValues(request: Request, name: string): string[] {
  const header = request.headers.get('cookie');
  if (!header) {
    return [];
  }
  const values: string[] = [];
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    if (key === name) {
      values.push(part.slice(separator + 1).trim());
    }
  }
  return values;
}

export function createSessionCookie(token: string, ttlSeconds: number): string {
  requireTtl(ttlSeconds);
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${ttlSeconds}; Secure; HttpOnly; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
}
