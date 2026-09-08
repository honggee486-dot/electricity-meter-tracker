import {
  findUserByGoogleSubject,
  listMeterReadings,
  listOwnedMeters,
  listViewerMeterIds,
  type D1DatabaseLike,
} from './persistence/d1.js';

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const;

interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

interface WorkerEnv {
  DB?: D1DatabaseLike;
  LOCAL_PERSISTENCE_CHECK?: string;
}

const LOCAL_PROBE = {
  googleSubject: 'local-owner-subject',
  ownerUserId: 'local-owner',
  viewerUserId: 'local-viewer',
  meterId: 'local-meter',
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

export function handleRequest(request: Request): Response {
  const url = new URL(request.url);

  if (url.pathname === '/api/health') {
    if (request.method !== 'GET') {
      return apiError(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported for this route.', {
        allow: 'GET',
      });
    }

    return jsonResponse({ ok: true });
  }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return apiError(404, 'NOT_FOUND', 'API route not found.');
  }

  return new Response('Not Found', { status: 404 });
}

export function handleWorkerRequest(
  request: Request,
  env: WorkerEnv = {},
): Response | Promise<Response> {
  const url = new URL(request.url);
  if (
    url.pathname === '/api/_dev/persistence-check' &&
    request.method === 'GET' &&
    env.LOCAL_PERSISTENCE_CHECK === '1' &&
    env.DB
  ) {
    return localPersistenceCheck(env.DB);
  }

  return handleRequest(request);
}

export default {
  fetch(request: Request, env: WorkerEnv): Response | Promise<Response> {
    return handleWorkerRequest(request, env);
  },
};
