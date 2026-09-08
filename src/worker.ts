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

export default {
  fetch(request: Request): Response {
    return handleRequest(request);
  },
};
