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
import { createLocalDateFormatter } from './domain/calendar.js';
import {
  resolveEffectiveBillingCloseDate,
  type BillingCloseSetting,
} from './domain/billingCycle.js';
import {
  UsageDomainError,
  calculateUsageInterval,
  createMeterReadingPoint,
  type MeterReadingPoint,
} from './domain/usage.js';
import {
  PersistenceDataError,
  createMeter,
  createReading,
  deleteMeter,
  deleteReading,
  ensureUserByGoogleSubject,
  findMeterAccess,
  findNextReading,
  findPreviousReading,
  findReadingAt,
  findReadingById,
  findUserByGoogleSubject,
  findUserById,
  listAccessibleMeters,
  listMeterReadings,
  listOwnedMeters,
  listViewerMeterIds,
  updateMeterSettings,
  updateReading,
  type D1DatabaseLike,
  type PersistedMeter,
  type PersistedMeterAccess,
  type PersistedReading,
  type PersistedUser,
} from './persistence/d1.js';

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const;
const AUTH_FORM_LIMIT_BYTES = 20 * 1024;
const API_JSON_LIMIT_BYTES = 16 * 1024;
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;

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

interface MeterSettingsInput {
  name: string;
  timezone: string;
  billingCloseKind: PersistedMeter['billingCloseKind'];
  billingCloseDay: number | null;
}

interface ReadingInput extends MeterReadingPoint {}

type ResourceRoute =
  | { kind: 'meters' }
  | { kind: 'meter'; meterId: string }
  | { kind: 'readings'; meterId: string }
  | { kind: 'reading'; meterId: string; readingId: string };

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

function resourceNotFound(): Response {
  return apiError(404, 'NOT_FOUND', 'Resource not found.');
}

function forbidden(): Response {
  return apiError(403, 'FORBIDDEN', 'Owner access is required for this operation.');
}

function invalidRequest(message = 'Request body is invalid.'): Response {
  return apiError(400, 'INVALID_REQUEST', message);
}

function readingConflict(): Response {
  return apiError(409, 'READING_CONFLICT', 'Reading conflicts with the meter reading sequence.');
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

async function parseJsonObject(request: Request): Promise<Record<string, unknown> | Response> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return apiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected application/json.');
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > API_JSON_LIMIT_BYTES) {
    return apiError(413, 'REQUEST_TOO_LARGE', 'Request body is too large.');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > API_JSON_LIMIT_BYTES) {
    return apiError(413, 'REQUEST_TOO_LARGE', 'Request body is too large.');
  }

  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return invalidRequest();
    }
    return body as Record<string, unknown>;
  } catch {
    return invalidRequest();
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function parseMeterSettings(body: Record<string, unknown>): MeterSettingsInput | null {
  if (!hasExactKeys(body, ['name', 'timezone', 'billingClose'])) {
    return null;
  }
  if (typeof body.name !== 'string' || typeof body.timezone !== 'string') {
    return null;
  }
  const name = body.name.trim();
  const timezone = body.timezone.trim();
  if (!name || !timezone || typeof body.billingClose !== 'object' || body.billingClose === null || Array.isArray(body.billingClose)) {
    return null;
  }

  const close = body.billingClose as Record<string, unknown>;
  let setting: BillingCloseSetting;
  if (close.kind === 'month-end' && hasExactKeys(close, ['kind'])) {
    setting = { kind: 'month-end' };
  } else if (
    close.kind === 'day'
    && hasExactKeys(close, ['kind', 'day'])
    && typeof close.day === 'number'
    && Number.isInteger(close.day)
  ) {
    setting = { kind: 'day', day: close.day };
  } else {
    return null;
  }

  try {
    createLocalDateFormatter(timezone);
    resolveEffectiveBillingCloseDate(2024, 2, setting);
  } catch (error) {
    if (error instanceof UsageDomainError) {
      return null;
    }
    throw error;
  }

  return setting.kind === 'month-end'
    ? { name, timezone, billingCloseKind: 'month-end', billingCloseDay: null }
    : { name, timezone, billingCloseKind: 'day', billingCloseDay: setting.day };
}

function parseReadingInput(body: Record<string, unknown>): ReadingInput | null {
  if (!hasExactKeys(body, ['measuredAtMs', 'cumulativeKwh'])) {
    return null;
  }
  if (typeof body.measuredAtMs !== 'number' || typeof body.cumulativeKwh !== 'string') {
    return null;
  }
  try {
    return createMeterReadingPoint(body.cumulativeKwh, body.measuredAtMs);
  } catch (error) {
    if (error instanceof UsageDomainError) {
      return null;
    }
    throw error;
  }
}

function serializeMeter(access: PersistedMeterAccess): object {
  const meter = access.meter;
  return {
    meterId: meter.meterId,
    name: meter.name,
    timezone: meter.timezone,
    billingClose: meter.billingCloseKind === 'month-end'
      ? { kind: 'month-end' }
      : { kind: 'day', day: meter.billingCloseDay },
    role: access.role,
    createdAtMs: meter.createdAtMs,
    updatedAtMs: meter.updatedAtMs,
  };
}

function serializeReading(reading: PersistedReading): object {
  return {
    readingId: reading.readingId,
    meterId: reading.meterId,
    measuredAtMs: reading.measuredAtMs,
    cumulativeWh: reading.cumulativeWh,
    createdAtMs: reading.createdAtMs,
  };
}

function parseResourceRoute(pathname: string): ResourceRoute | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 2 && parts[0] === 'api' && parts[1] === 'meters') {
    return { kind: 'meters' };
  }
  if (parts.length < 3 || parts[0] !== 'api' || parts[1] !== 'meters' || !RESOURCE_ID_PATTERN.test(parts[2])) {
    return null;
  }
  const meterId = parts[2];
  if (parts.length === 3) {
    return { kind: 'meter', meterId };
  }
  if (parts.length === 4 && parts[3] === 'readings') {
    return { kind: 'readings', meterId };
  }
  if (
    parts.length === 5
    && parts[3] === 'readings'
    && RESOURCE_ID_PATTERN.test(parts[4])
  ) {
    return { kind: 'reading', meterId, readingId: parts[4] };
  }
  return null;
}

async function resolveSessionUser(
  request: Request,
  config: AuthConfig,
  nowMs: number,
): Promise<PersistedUser | Response> {
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
  return user;
}

function persistedPoint(reading: PersistedReading): MeterReadingPoint {
  return { measuredAtMs: reading.measuredAtMs, cumulativeWh: reading.cumulativeWh };
}

function readingFitsSequence(
  previous: PersistedReading | null,
  current: MeterReadingPoint,
  next: PersistedReading | null,
): boolean {
  try {
    if (previous) {
      calculateUsageInterval(persistedPoint(previous), current);
    }
    if (next) {
      calculateUsageInterval(current, persistedPoint(next));
    }
    return true;
  } catch (error) {
    if (error instanceof UsageDomainError) {
      return false;
    }
    throw error;
  }
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
  const user = await resolveSessionUser(request, config, nowMs);
  if (user instanceof Response) {
    return user;
  }
  return jsonResponse({ authenticated: true, userId: user.userId });
}

async function handleMetersRoute(
  request: Request,
  config: AuthConfig,
  user: PersistedUser,
  dependencies: WorkerDependencies,
  nowMs: number,
): Promise<Response> {
  if (request.method === 'GET') {
    const meters = await listAccessibleMeters(config.db, user.userId);
    return jsonResponse({ meters: meters.map(serializeMeter) });
  }
  if (request.method !== 'POST') {
    return methodNotAllowed('GET, POST');
  }

  const body = await parseJsonObject(request);
  if (body instanceof Response) {
    return body;
  }
  const settings = parseMeterSettings(body);
  if (!settings) {
    return invalidRequest('Meter settings are invalid.');
  }

  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID());
  const meter = await createMeter(config.db, {
    meterId: randomUUID(),
    ownerUserId: user.userId,
    ...settings,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  });
  return jsonResponse({ meter: serializeMeter({ meter, role: 'owner' }) }, { status: 201 });
}

async function handleMeterRoute(
  route: Extract<ResourceRoute, { kind: 'meter' }>,
  request: Request,
  config: AuthConfig,
  user: PersistedUser,
  nowMs: number,
): Promise<Response> {
  const access = await findMeterAccess(config.db, route.meterId, user.userId);
  if (!access) {
    return resourceNotFound();
  }

  if (request.method === 'GET') {
    return jsonResponse({ meter: serializeMeter(access) });
  }
  if (request.method !== 'PUT' && request.method !== 'DELETE') {
    return methodNotAllowed('GET, PUT, DELETE');
  }
  if (access.role !== 'owner') {
    return forbidden();
  }

  if (request.method === 'DELETE') {
    await deleteMeter(config.db, route.meterId);
    return new Response(null, { status: 204 });
  }

  const body = await parseJsonObject(request);
  if (body instanceof Response) {
    return body;
  }
  const settings = parseMeterSettings(body);
  if (!settings) {
    return invalidRequest('Meter settings are invalid.');
  }
  const updated = await updateMeterSettings(
    config.db,
    route.meterId,
    settings.name,
    settings.timezone,
    settings.billingCloseKind,
    settings.billingCloseDay,
    nowMs,
  );
  if (!updated) {
    return resourceNotFound();
  }
  return jsonResponse({ meter: serializeMeter({ meter: updated, role: 'owner' }) });
}

async function handleReadingsRoute(
  route: Extract<ResourceRoute, { kind: 'readings' }>,
  request: Request,
  config: AuthConfig,
  user: PersistedUser,
  dependencies: WorkerDependencies,
  nowMs: number,
): Promise<Response> {
  const access = await findMeterAccess(config.db, route.meterId, user.userId);
  if (!access) {
    return resourceNotFound();
  }

  if (request.method === 'GET') {
    const readings = await listMeterReadings(config.db, route.meterId);
    return jsonResponse({ readings: readings.map(serializeReading) });
  }
  if (request.method !== 'POST') {
    return methodNotAllowed('GET, POST');
  }
  if (access.role !== 'owner') {
    return forbidden();
  }

  const body = await parseJsonObject(request);
  if (body instanceof Response) {
    return body;
  }
  const input = parseReadingInput(body);
  if (!input) {
    return invalidRequest('Reading input is invalid.');
  }
  if (await findReadingAt(config.db, route.meterId, input.measuredAtMs)) {
    return readingConflict();
  }
  const [previous, next] = await Promise.all([
    findPreviousReading(config.db, route.meterId, input.measuredAtMs),
    findNextReading(config.db, route.meterId, input.measuredAtMs),
  ]);
  if (!readingFitsSequence(previous, input, next)) {
    return readingConflict();
  }

  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID());
  const created = await createReading(config.db, {
    readingId: randomUUID(),
    meterId: route.meterId,
    measuredAtMs: input.measuredAtMs,
    cumulativeWh: input.cumulativeWh,
    createdAtMs: nowMs,
  });
  if (!created) {
    return readingConflict();
  }
  return jsonResponse({ reading: serializeReading(created) }, { status: 201 });
}

async function handleReadingRoute(
  route: Extract<ResourceRoute, { kind: 'reading' }>,
  request: Request,
  config: AuthConfig,
  user: PersistedUser,
): Promise<Response> {
  const access = await findMeterAccess(config.db, route.meterId, user.userId);
  if (!access) {
    return resourceNotFound();
  }
  const existing = await findReadingById(config.db, route.meterId, route.readingId);
  if (!existing) {
    return resourceNotFound();
  }

  if (request.method === 'GET') {
    return jsonResponse({ reading: serializeReading(existing) });
  }
  if (request.method !== 'PUT' && request.method !== 'DELETE') {
    return methodNotAllowed('GET, PUT, DELETE');
  }
  if (access.role !== 'owner') {
    return forbidden();
  }

  if (request.method === 'DELETE') {
    await deleteReading(config.db, route.meterId, route.readingId);
    return new Response(null, { status: 204 });
  }

  const body = await parseJsonObject(request);
  if (body instanceof Response) {
    return body;
  }
  const input = parseReadingInput(body);
  if (!input) {
    return invalidRequest('Reading input is invalid.');
  }
  const exact = await findReadingAt(config.db, route.meterId, input.measuredAtMs);
  if (exact && exact.readingId !== existing.readingId) {
    return readingConflict();
  }
  const [previous, next] = await Promise.all([
    findPreviousReading(config.db, route.meterId, input.measuredAtMs, existing.readingId),
    findNextReading(config.db, route.meterId, input.measuredAtMs, existing.readingId),
  ]);
  if (!readingFitsSequence(previous, input, next)) {
    return readingConflict();
  }

  const updated = await updateReading(config.db, existing, input.measuredAtMs, input.cumulativeWh);
  if (!updated) {
    return readingConflict();
  }
  return jsonResponse({ reading: serializeReading(updated) });
}

async function handleProductResourceRoute(
  route: ResourceRoute,
  request: Request,
  config: AuthConfig,
  user: PersistedUser,
  dependencies: WorkerDependencies,
  nowMs: number,
): Promise<Response> {
  if (route.kind === 'meters') {
    return handleMetersRoute(request, config, user, dependencies, nowMs);
  }
  if (route.kind === 'meter') {
    return handleMeterRoute(route, request, config, user, nowMs);
  }
  if (route.kind === 'readings') {
    return handleReadingsRoute(route, request, config, user, dependencies, nowMs);
  }
  return handleReadingRoute(route, request, config, user);
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

  const resourceRoute = parseResourceRoute(url.pathname);
  if (resourceRoute) {
    const config = authConfig(env);
    if (!config) {
      return authNotConfigured();
    }
    const nowMs = (dependencies.nowMs ?? Date.now)();
    const user = await resolveSessionUser(request, config, nowMs);
    if (user instanceof Response) {
      return user;
    }
    try {
      return await handleProductResourceRoute(resourceRoute, request, config, user, dependencies, nowMs);
    } catch (error) {
      if (error instanceof PersistenceDataError) {
        return apiError(500, 'PERSISTENCE_ERROR', 'Persistence operation failed.');
      }
      throw error;
    }
  }

  return handleRequest(request);
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleWorkerRequest(request, env);
  },
};
