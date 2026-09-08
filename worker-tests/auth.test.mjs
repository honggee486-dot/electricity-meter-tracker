import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GoogleIdentityError,
  RemoteGoogleJwkProvider,
  verifyGoogleIdToken,
} from '../.worker-test/auth/google.js';
import {
  SESSION_COOKIE_NAME,
  SessionError,
  createSessionToken,
  verifySessionToken,
} from '../.worker-test/auth/session.js';
import { handleWorkerRequest } from '../.worker-test/worker.js';

const textEncoder = new TextEncoder();
const NOW_MS = 1_800_000_000_000;
const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const SESSION_SECRET = '0123456789abcdef0123456789abcdef';

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function signedGoogleToken(privateKey, payloadOverrides = {}, headerOverrides = {}) {
  const header = encodeJson({ alg: 'RS256', kid: 'test-key', typ: 'JWT', ...headerOverrides });
  const payload = encodeJson({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    exp: Math.floor(NOW_MS / 1000) + 3600,
    sub: 'google-subject-1',
    ...payloadOverrides,
  });
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    textEncoder.encode(signingInput),
  );
  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`;
}

async function googleKeyFixture() {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    privateKey: pair.privateKey,
    provider: {
      async getKey(kid) {
        assert.equal(kid, 'test-key');
        return { ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' };
      },
    },
  };
}

class AuthStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    this.db.calls.push({ sql: this.sql, values });
    return this;
  }

  async first() {
    if (this.sql.includes('WHERE google_subject = ?1')) {
      return this.db.users.find((user) => user.google_subject === this.values[0]) ?? null;
    }
    if (this.sql.includes('WHERE user_id = ?1')) {
      return this.db.users.find((user) => user.user_id === this.values[0]) ?? null;
    }
    return null;
  }

  async all() {
    return { results: [] };
  }

  async run() {
    if (this.sql.includes('INSERT OR IGNORE INTO users')) {
      const [userId, googleSubject, createdAtMs] = this.values;
      if (!this.db.users.some((user) => user.google_subject === googleSubject || user.user_id === userId)) {
        this.db.users.push({
          user_id: userId,
          google_subject: googleSubject,
          created_at_ms: createdAtMs,
        });
      }
    }
    return { success: true };
  }
}

class AuthDb {
  constructor() {
    this.users = [];
    this.calls = [];
  }

  prepare(sql) {
    return new AuthStatement(this, sql);
  }
}

function authEnv(db) {
  return {
    DB: db,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    SESSION_SECRET,
    SESSION_TTL_SECONDS: '3600',
  };
}

function formRequest(body, cookie = 'g_csrf_token=csrf-1') {
  return new Request('https://example.test/api/auth/google', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
    },
    body: new URLSearchParams(body),
  });
}

test('remote Google JWK provider respects cache lifetime and refreshes once on kid rotation', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    const keys = calls === 1
      ? [{ kty: 'RSA', kid: 'key-1', n: 'AQAB', e: 'AQAB', alg: 'RS256', use: 'sig' }]
      : [
          { kty: 'RSA', kid: 'key-1', n: 'AQAB', e: 'AQAB', alg: 'RS256', use: 'sig' },
          { kty: 'RSA', kid: 'key-2', n: 'AQAB', e: 'AQAB', alg: 'RS256', use: 'sig' },
        ];
    return new Response(JSON.stringify({ keys }), {
      headers: { 'cache-control': 'public, max-age=3600' },
    });
  };
  const provider = new RemoteGoogleJwkProvider(fetcher);
  assert.equal((await provider.getKey('key-1', NOW_MS)).kid, 'key-1');
  assert.equal((await provider.getKey('key-1', NOW_MS + 1000)).kid, 'key-1');
  assert.equal(calls, 1);
  assert.equal((await provider.getKey('key-2', NOW_MS + 2000)).kid, 'key-2');
  assert.equal(calls, 2);
});

test('Google ID token verification validates RSA signature and stable subject', async () => {
  const { privateKey, provider } = await googleKeyFixture();
  const token = await signedGoogleToken(privateKey);
  assert.deepEqual(await verifyGoogleIdToken(token, CLIENT_ID, provider, NOW_MS), {
    subject: 'google-subject-1',
  });
});

test('Google ID token verification rejects audience, expiry and signature failures', async () => {
  const first = await googleKeyFixture();
  const second = await googleKeyFixture();
  const wrongAudience = await signedGoogleToken(first.privateKey, { aud: 'other-client' });
  const expired = await signedGoogleToken(first.privateKey, { exp: Math.floor(NOW_MS / 1000) });
  const badSignature = await signedGoogleToken(second.privateKey);

  await assert.rejects(
    () => verifyGoogleIdToken(wrongAudience, CLIENT_ID, first.provider, NOW_MS),
    GoogleIdentityError,
  );
  await assert.rejects(
    () => verifyGoogleIdToken(expired, CLIENT_ID, first.provider, NOW_MS),
    GoogleIdentityError,
  );
  await assert.rejects(
    () => verifyGoogleIdToken(badSignature, CLIENT_ID, first.provider, NOW_MS),
    GoogleIdentityError,
  );
});

test('session token is signed, expires and rejects tampering', async () => {
  const token = await createSessionToken('user-1', SESSION_SECRET, 3600, NOW_MS);
  assert.deepEqual(await verifySessionToken(token, SESSION_SECRET, NOW_MS + 1000), {
    userId: 'user-1',
    expiresAtMs: NOW_MS + 3_600_000,
  });

  const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
  await assert.rejects(() => verifySessionToken(tampered, SESSION_SECRET, NOW_MS + 1000), SessionError);
  await assert.rejects(() => verifySessionToken(token, SESSION_SECRET, NOW_MS + 3_600_000), SessionError);
});

test('auth config stays unavailable until DB and session bindings are present', async () => {
  const response = await handleWorkerRequest(new Request('https://example.test/api/auth/config'), {
    GOOGLE_CLIENT_ID: CLIENT_ID,
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'AUTH_NOT_CONFIGURED',
      message: 'Authentication is not configured for this environment.',
    },
  });
});

test('Google login requires the GIS double-submit CSRF token', async () => {
  const db = new AuthDb();
  const response = await handleWorkerRequest(
    formRequest({ credential: 'credential-1', g_csrf_token: 'csrf-body' }, 'g_csrf_token=csrf-cookie'),
    authEnv(db),
    {
      verifyGoogleCredential: async () => ({ subject: 'google-subject-1' }),
      nowMs: () => NOW_MS,
      randomUUID: () => 'user-1',
    },
  );
  assert.equal(response.status, 400);
  assert.equal(db.users.length, 0);
});

test('Google credential verification details stay in server diagnostics and the credential is redacted', async () => {
  const db = new AuthDb();
  const credential = 'credential-sensitive-sentinel';
  const diagnosticDetail = 'provider-detail-sentinel';
  const logs = [];
  const response = await handleWorkerRequest(
    formRequest({ credential, g_csrf_token: 'csrf-1' }),
    authEnv(db),
    {
      verifyGoogleCredential: async () => {
        throw new Error(`${diagnosticDetail}: ${credential}`);
      },
      logError: (...values) => logs.push(values.map(String).join(' ')),
    },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'INVALID_GOOGLE_CREDENTIAL',
      message: 'Google credential could not be verified.',
    },
  });
  const joinedLogs = logs.join('\n');
  assert.match(joinedLogs, new RegExp(diagnosticDetail));
  assert.match(joinedLogs, /\[credential redacted\]/);
  assert.equal(joinedLogs.includes(credential), false);
  assert.equal(db.users.length, 0);
});

test('first Google login creates one internal user and returning login reuses it', async () => {
  const db = new AuthDb();
  const dependencies = {
    verifyGoogleCredential: async () => ({ subject: 'google-subject-1' }),
    nowMs: () => NOW_MS,
  };

  const first = await handleWorkerRequest(
    formRequest({ credential: 'credential-1', g_csrf_token: 'csrf-1' }),
    authEnv(db),
    { ...dependencies, randomUUID: () => 'user-first' },
  );
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { authenticated: true, userId: 'user-first' });
  const cookie = first.headers.get('set-cookie');
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);

  const second = await handleWorkerRequest(
    formRequest({ credential: 'credential-2', g_csrf_token: 'csrf-1' }),
    authEnv(db),
    { ...dependencies, randomUUID: () => 'user-second' },
  );
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { authenticated: true, userId: 'user-first' });
  assert.equal(db.users.length, 1);
});

test('session endpoint resolves the signed cookie back to the stored internal user', async () => {
  const db = new AuthDb();
  db.users.push({
    user_id: 'user-1',
    google_subject: 'google-subject-1',
    created_at_ms: NOW_MS,
  });
  const token = await createSessionToken('user-1', SESSION_SECRET, 3600, NOW_MS);
  const response = await handleWorkerRequest(
    new Request('https://example.test/api/auth/session', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    }),
    authEnv(db),
    { nowMs: () => NOW_MS + 1000 },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: true, userId: 'user-1' });
});

test('invalid session is rejected and cleared without exposing token details', async () => {
  const db = new AuthDb();
  const response = await handleWorkerRequest(
    new Request('https://example.test/api/auth/session', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=not-a-valid-session` },
    }),
    authEnv(db),
    { nowMs: () => NOW_MS },
  );
  assert.equal(response.status, 401);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await response.text()).includes('not-a-valid-session'), false);
});

test('logout clears the HttpOnly session cookie', async () => {
  const response = await handleWorkerRequest(
    new Request('https://example.test/api/auth/logout', { method: 'POST' }),
    {},
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
  assert.match(response.headers.get('set-cookie'), new RegExp(`^${SESSION_COOKIE_NAME}=;`));
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});
