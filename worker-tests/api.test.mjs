import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { handleRequest, handleWorkerRequest } from '../.worker-test/worker.js';

const request = (path, init) => new Request(`https://example.test${path}`, init);

test('GET /api/health returns deterministic no-store JSON', async () => {
  const response = handleRequest(request('/api/health?probe=1'));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: true });
});

test('default Worker fetch uses the same request owner', async () => {
  const response = await worker.fetch(request('/api/health'), {});

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('unsupported health methods fail deterministically with Allow', async () => {
  const response = handleRequest(request('/api/health', { method: 'POST' }));

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
  assert.deepEqual(await response.json(), {
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Only GET is supported for this route.',
    },
  });
});

test('unknown API routes return the API error envelope', async () => {
  const response = handleRequest(request('/api/missing'));

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'NOT_FOUND',
      message: 'API route not found.',
    },
  });
});

test('local persistence check is not a product API route without the explicit local gate', async () => {
  const response = await handleWorkerRequest(request('/api/_dev/persistence-check'), {});

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'NOT_FOUND',
      message: 'API route not found.',
    },
  });
});

test('local auth check is not a product API route without the explicit local gate', async () => {
  const response = await handleWorkerRequest(request('/api/_dev/auth-check'), {});

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'NOT_FOUND',
      message: 'API route not found.',
    },
  });
});

test('non-API misses do not masquerade as API responses', async () => {
  const response = handleRequest(request('/missing'));

  assert.equal(response.status, 404);
  assert.equal(response.headers.get('content-type'), 'text/plain;charset=UTF-8');
  assert.equal(await response.text(), 'Not Found');
});
