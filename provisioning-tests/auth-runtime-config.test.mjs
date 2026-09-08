import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  AUTH_RUNTIME_MARKER,
  DEV_ORIGIN,
  assertGoogleClientId,
  assertSessionSecret,
  normalizeSessionTtlSeconds,
  readConfiguredAuthVars,
  renderAuthRuntimeVars,
  validateAuthRuntimeEnvironment,
} from '../scripts/configure-auth-runtime.mjs';

const root = new URL('../', import.meta.url);
const readRepoFile = path => readFile(new URL(path, root), 'utf8');
const CLIENT_ID = '123456789012-example_web_client.apps.googleusercontent.com';
const TTL = '604800';

function parseJson(source) {
  return JSON.parse(source.replace(/^\s*\/\/.*$/gm, ''));
}

test('root auth runtime config is either marker state or exact public vars without SESSION_SECRET', async () => {
  const source = await readRepoFile('wrangler.jsonc');
  const vars = readConfiguredAuthVars(source);
  assert.doesNotMatch(source, /"SESSION_SECRET"\s*:/);
  if (vars === null) {
    assert.match(source, new RegExp(AUTH_RUNTIME_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    return;
  }
  assert.doesNotMatch(source, /AUTH_RUNTIME_VARS_PLACEHOLDER/);
  assertGoogleClientId(vars.GOOGLE_CLIENT_ID);
  assert.equal(normalizeSessionTtlSeconds(vars.SESSION_TTL_SECONDS), String(vars.SESSION_TTL_SECONDS));
});

test('renderer writes only Google Client ID and explicit TTL public vars', async () => {
  const source = await readRepoFile('wrangler.jsonc');
  if (readConfiguredAuthVars(source) !== null) return;
  const rendered = renderAuthRuntimeVars(source, CLIENT_ID, TTL);
  const parsed = parseJson(rendered);
  assert.deepEqual(parsed.vars, {
    GOOGLE_CLIENT_ID: CLIENT_ID,
    SESSION_TTL_SECONDS: TTL,
  });
  assert.doesNotMatch(rendered, /SESSION_SECRET/);
  assert.equal(parsed.d1_databases?.[0]?.database_name, 'electricity-meter-tracker');
});

test('renderer is idempotent for the same public auth identity and policy', async () => {
  const source = await readRepoFile('wrangler.jsonc');
  const first = readConfiguredAuthVars(source) === null
    ? renderAuthRuntimeVars(source, CLIENT_ID, TTL)
    : source;
  const vars = readConfiguredAuthVars(first);
  assert.ok(vars);
  assert.equal(renderAuthRuntimeVars(first, vars.GOOGLE_CLIENT_ID, vars.SESSION_TTL_SECONDS), first);
});

test('renderer refuses invalid or mismatched Google client and TTL values', async () => {
  const source = await readRepoFile('wrangler.jsonc');
  assert.throws(() => renderAuthRuntimeVars(source, 'fake-client-id', TTL), /real Google Web Client ID/);
  assert.throws(() => renderAuthRuntimeVars(source, CLIENT_ID, '0'), /outside the supported/);
  assert.throws(() => renderAuthRuntimeVars(source, CLIENT_ID, String(31 * 24 * 60 * 60 + 1)), /outside the supported/);

  const configured = readConfiguredAuthVars(source) === null
    ? renderAuthRuntimeVars(source, CLIENT_ID, TTL)
    : source;
  const vars = readConfiguredAuthVars(configured);
  assert.ok(vars);
  const otherClient = vars.GOOGLE_CLIENT_ID === CLIENT_ID
    ? '987654321098-other_web_client.apps.googleusercontent.com'
    : CLIENT_ID;
  assert.throws(() => renderAuthRuntimeVars(configured, otherClient, vars.SESSION_TTL_SECONDS), /does not match/);
});

test('session secret validator enforces byte length without making it a repository var', () => {
  assert.throws(() => assertSessionSecret('short'), /at least 32 bytes/);
  assert.doesNotThrow(() => assertSessionSecret('0123456789abcdef0123456789abcdef'));
});

test('runtime environment validation requires client id, explicit TTL, and strong secret', () => {
  assert.doesNotThrow(() => validateAuthRuntimeEnvironment({
    GOOGLE_CLIENT_ID: CLIENT_ID,
    SESSION_TTL_SECONDS: TTL,
    SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  }));
  assert.throws(() => validateAuthRuntimeEnvironment({
    GOOGLE_CLIENT_ID: CLIENT_ID,
    SESSION_TTL_SECONDS: TTL,
    SESSION_SECRET: 'short',
  }), /at least 32 bytes/);
});

test('canonical dev origin is stable and .env.example remains names-only', async () => {
  assert.equal(DEV_ORIGIN, 'https://dev-electricity-meter-tracker.247dev.workers.dev');
  const source = await readRepoFile('.env.example');
  const assignments = source.split(/\r?\n/).filter(line => /^[A-Z0-9_]+=/.test(line));
  assert.deepEqual(assignments, ['GOOGLE_CLIENT_ID=', 'SESSION_SECRET=', 'SESSION_TTL_SECONDS=']);
});
