import { verifyGoogleIdToken, type GoogleIdentity } from './auth/google.js';
import {
  SESSION_COOKIE_NAME,
  SessionError,
  clearSessionCookie,
  createSessionCookie,
  createSessionToken,
  parseSessionTtlSeconds,
  readCookieValues,
  verifySessionToken,
} from './auth/session.js';
import {
  ensureUserByGoogleSubject,
  findUserByGoogleSubject,
  findUserById,
  listMeterReadings,
  listOwnedMeters,
  listViewerMeterIds,
  type D1DatabaseLike,
} from './persistence/d1.js';

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const;
const AUTH_FORM_LIMIT_BYTES = 20 * 1024;

interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

interface WorkerEnv {
  DB?: D1DatabaseLike;
  LOCAL_PERSISTENCE_CHECK?: string;
  GOOGLE_CLIENT_ID?: string;
  SESSION_SECRET?: string;
  SESSION_TTL_SECONDS?: string;
}

interface WorkerDependencies {
  verifyGoogleCredential?: (credential: string, clientId: string) => Promise<GoogleIdentity>;
  nowMs?: () => number;
  randomUUID?: () => string;
}

interface AuthConfig {
  db: D1DatabaseLike;
  googleClientId: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
}

const LOCAL_PROBE = {
  googleSubject: 'local-owner-subject',
  ownerUserId: 'local-owner',
  viewerUserId: 'local-viewer',
  meterId: 'local-meter',
  authSubject: 'local-auth-subject',
} as const;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(JSON_HEADERS)) {
    if (!headers.has(name)) {
      headers.set(name, value);
    }
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function apiError(status: number, code: string, message: string, headers?: HeadersInit): Response {
  const body: ApiErrorBody = {
    error: { code, message },
  };
  return jsonResponse(body, { status, headers });
}

function methodNotAllowed(allow: string): Response {
  return apiError(405, 'METHOD_NOT_ALLOWED', `Only ${allow} is supported for this route.`, {
    allow,
  });
}

function authConfig(env: WorkerEnv): AuthConfig | null {
  const googleClientId = env.GOOGLE_CLIENT_ID?.trim();
  const sessionSecret = env.SESSION_SECRET;
  const sessionTtlSeconds = parseSessionTtlSeconds(env.SESSION_TTL_SECONDS);
  if (!env.DB || !googleClientId || !sessionSecret || sessionTtlSeconds === null) {
    return null;
  }
  if (new TextEncoder().encode(sessionSecret).byteLength < 32) {
    return null;
  }
  return {
    db: env.DB,
    googleClientId,
    sessionSecret,
    sessionTtlSeconds,
  };
}

function authNotConfigured(): Response {
  return apiError(503, 'AUTH_NOT_CONFIGURED', 'Authentication is not configured for this environment.');
}

function unauthenticated(headers?: HeadersInit): Response {
  return apiError(401, 'UNAUTHENTICATED', 'A valid session is required.', headers);
}

function singleFormValue(form: URLSearchParams, name: string): string | null {
  const values = form.getAll(name);
  return values.length === 1 && values[0].length > 0 ? values[0] : null;
}

async function parseLoginForm(request: Request): Promise<URLSearchParams | null> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/x-www-form-urlencoded') {
    return null;
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > AUTH_FORM_LIMIT_BYTES) {
    throw new RangeError('Auth request body is too large.');
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > AUTH_FORM_LIMIT_BYTES) {
    throw new RangeError('Auth request body is too large.');
  }
  return new URLSearchParams(body);
}

async function handleGoogleLogin(
  request: Request,
  config: AuthConfig,
  dependencies: WorkerDependencies,
): Promise<Response> {
  let form: URLSearchParams | null;
  try {
    form = await parseLoginForm(request);
  } catch (error) {
    if (error instanceof RangeError) {
      return apiError(413, 'REQUEST_TOO_LARGE', 'Authentication request body is too large.');
    }
    throw error;
  }
  if (!form) {
    return apiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected application/x-www-form-urlencoded.');
  }

  const credential = singleFormValue(form, 'credential');
  const bodyCsrf = singleFormValue(form, 'g_csrf_token');
  const cookieCsrf = readCookieValues(request, 'g_csrf_token');
  if (!credential || !bodyCsrf || cookieCsrf.length !== 1 || cookieCsrf[0] !== bodyCsrf) {
    return apiError(400, 'INVALID_LOGIN_REQUEST', 'Google login request failed CSRF or credential validation.');
  }

  const verifyCredential = dependencies.verifyGoogleCredential ?? verifyGoogleIdToken;
  let identity: GoogleIdentity;
  try {
    identity = await verifyCredential(credential, config.googleClientId);
  } catch {
    return apiError(401, 'INVALID_GOOGLE_CREDENTIAL', 'Google credential could not be verified.');
  }

  const nowMs = (dependencies.nowMs ?? Date.now)();
  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID());
  const user = await ensureUserByGoogleSubject(config.db, identity.subject, randomUUID(), nowMs);
  const sessionToken = await createSessionToken(
    user.userId,
    config.sessionSecret,
    config.sessionTtlSeconds,
    nowMs,
  );

  return jsonResponse(
    { authenticated: true, userId: user.userId },
    {
      headers: {
        'set-cookie': createSessionCookie(sessionToken, config.sessionTtlSeconds),
      },
    },
  );
}

async function handleSession(request: Request, config: AuthConfig, nowMs: number): Promise<Response> {
  const cookies = readCookieValues(request, SESSION_COOKIE_NAME);
  if (cookies.length !== 1) {
    return unauthenticated();
  }

  let identity;
  try {
    identity = await verifySessionToken(cookies[0], config.sessionSecret, nowMs);
  } catch (error) {
    if (error instanceof SessionError) {
      return unauthenticated({ 'set-cookie': clearSessionCookie() });
    }
    throw error;
  }

  const user = await findUserById(config.db, identity.userId);
  if (!user) {
    return unauthenticated({ 'set-cookie': clearSessionCookie() });
  }
  return jsonResponse({ authenticated: true, userId: user.userId });
}

async function localPersistenceCheck(db: D1DatabaseLike): Promise<Response> {
  const [user, ownedMeters, viewerMeterIds, readings] = await Promise.all([
    findUserByGoogleSubject(db, LOCAL_PROBE.googleSubject),
    listOwnedMeters(db, LOCAL_PROBE.ownerUserId),
    listViewerMeterIds(db, LOCAL_PROBE.viewerUserId),
    listMeterReadings(db, LOCAL_PROBE.meterId),
  ]);

  const ownerMeterIds = ownedMeters.map((meter) => meter.meterId);
  const readingInstants = readings.map((reading) => reading.measuredAtMs);
  const ok =
    user?.userId === LOCAL_PROBE.ownerUserId &&
    ownerMeterIds.includes(LOCAL_PROBE.meterId) &&
    viewerMeterIds.includes(LOCAL_PROBE.meterId) &&
    readingInstants.length === 2 &&
    readingInstants[0] === 1_000 &&
    readingInstants[1] === 2_000;

  return jsonResponse({
    ok,
    userId: user?.userId ?? null,
    ownerMeterIds,
    viewerMeterIds,
    readingInstants,
  });
}

async function localAuthCheck(env: WorkerEnv, nowMs: number): Promise<Response> {
  const ttl = parseSessionTtlSeconds(env.SESSION_TTL_SECONDS);
  if (!env.DB || !env.SESSION_SECRET || ttl === null) {
    return apiError(500, 'LOCAL_AUTH_CHECK_MISCONFIGURED', 'Local auth check is not configured.');
  }

  const first = await ensureUserByGoogleSubject(env.DB, LOCAL_PROBE.authSubject, crypto.randomUUID(), nowMs);
  const second = await ensureUserByGoogleSubject(env.DB, LOCAL_PROBE.authSubject, crypto.randomUUID(), nowMs + 1);
  const token = await createSessionToken(first.userId, env.SESSION_SECRET, ttl, nowMs);
  const session = await verifySessionToken(token, env.SESSION_SECRET, nowMs + 1_000);
  const stored = await findUserById(env.DB, session.userId);
  const ok = first.userId === second.userId && stored?.userId === first.userId;

  return jsonResponse({
    ok,
    stableUser: first.userId === second.userId,
    sessionResolved: stored?.userId === first.userId,
  });
}

export function handleRequest(request: Request): Response {
  const url = new URL(request.url);

  if (url.pathname === '/api/health') {
    if (request.method !== 'GET') {
      return methodNotAllowed('GET');
    }

    return jsonResponse({ ok: true });
  }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return apiError(404, 'NOT_FOUND', 'API route not found.');
  }

  return new Response('Not Found', { status: 404 });
}

export async function handleWorkerRequest(
  request: Request,
  env: WorkerEnv = {},
  dependencies: WorkerDependencies = {},
): Promise<Response> {
  const url = new URL(request.url);

  if (
    url.pathname === '/api/_dev/persistence-check' &&
    request.method === 'GET' &&
    env.LOCAL_PERSISTENCE_CHECK === '1' &&
    env.DB
  ) {
    return localPersistenceCheck(env.DB);
  }
  if (
    url.pathname === '/api/_dev/auth-check' &&
    request.method === 'GET' &&
    env.LOCAL_PERSISTENCE_CHECK === '1'
  ) {
    return localAuthCheck(env, (dependencies.nowMs ?? Date.now)());
  }

  if (url.pathname === '/api/auth/config') {
    if (request.method !== 'GET') {
      return methodNotAllowed('GET');
    }
    const config = authConfig(env);
    if (!config) {
      return authNotConfigured();
    }
    return jsonResponse({ googleClientId: config.googleClientId });
  }

  if (url.pathname === '/api/auth/google') {
    if (request.method !== 'POST') {
      return methodNotAllowed('POST');
    }
    const config = authConfig(env);
    if (!config) {
      return authNotConfigured();
    }
    return handleGoogleLogin(request, config, dependencies);
  }

  if (url.pathname === '/api/auth/session') {
    if (request.method !== 'GET') {
      return methodNotAllowed('GET');
    }
    const config = authConfig(env);
    if (!config) {
      return authNotConfigured();
    }
    return handleSession(request, config, (dependencies.nowMs ?? Date.now)());
  }

  if (url.pathname === '/api/auth/logout') {
    if (request.method !== 'POST') {
      return methodNotAllowed('POST');
    }
    return jsonResponse(
      { authenticated: false },
      { headers: { 'set-cookie': clearSessionCookie() } },
    );
  }

  return handleRequest(request);
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleWorkerRequest(request, env);
  },
};
