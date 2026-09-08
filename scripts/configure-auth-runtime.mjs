import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEV_ORIGIN = 'https://dev-electricity-meter-tracker.247dev.workers.dev';
export const AUTH_RUNTIME_MARKER = '  // AUTH_RUNTIME_VARS_PLACEHOLDER';
export const SESSION_TTL_MIN_SECONDS = 60;
export const SESSION_TTL_MAX_SECONDS = 31 * 24 * 60 * 60;

const GOOGLE_CLIENT_ID_PATTERN = /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;

function parseJsonc(source) {
  const withoutFullLineComments = source.replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(withoutFullLineComments);
}

export function assertGoogleClientId(clientId) {
  if (typeof clientId !== 'string' || !GOOGLE_CLIENT_ID_PATTERN.test(clientId)) {
    throw new Error('GOOGLE_CLIENT_ID must be a real Google Web Client ID.');
  }
}

export function normalizeSessionTtlSeconds(value) {
  const text = String(value);
  if (!/^\d+$/.test(text)) {
    throw new Error('SESSION_TTL_SECONDS must be an integer number of seconds.');
  }
  const ttl = Number(text);
  if (!Number.isSafeInteger(ttl) || ttl < SESSION_TTL_MIN_SECONDS || ttl > SESSION_TTL_MAX_SECONDS) {
    throw new Error('SESSION_TTL_SECONDS is outside the supported 60..2678400 second range.');
  }
  return String(ttl);
}

export function assertSessionSecret(secret) {
  if (typeof secret !== 'string' || new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error('SESSION_SECRET must be at least 32 bytes.');
  }
}

export function readConfiguredAuthVars(source) {
  const parsed = parseJsonc(source);
  if (parsed.vars === undefined) return null;
  if (!parsed.vars || typeof parsed.vars !== 'object' || Array.isArray(parsed.vars)) {
    throw new Error('wrangler.jsonc vars must be an object.');
  }
  if ('SESSION_SECRET' in parsed.vars) {
    throw new Error('SESSION_SECRET must never be stored in wrangler.jsonc vars.');
  }
  return parsed.vars;
}

export function assertAuthVars(vars, expectedClientId, expectedTtlSeconds) {
  assertGoogleClientId(expectedClientId);
  const expectedTtl = normalizeSessionTtlSeconds(expectedTtlSeconds);
  if (vars.GOOGLE_CLIENT_ID !== expectedClientId) {
    throw new Error('Configured GOOGLE_CLIENT_ID does not match the selected final Web Client.');
  }
  if (String(vars.SESSION_TTL_SECONDS) !== expectedTtl) {
    throw new Error('Configured SESSION_TTL_SECONDS does not match the selected session policy.');
  }
  if ('SESSION_SECRET' in vars) {
    throw new Error('SESSION_SECRET must never be stored in wrangler.jsonc vars.');
  }
}

export function renderAuthRuntimeVars(source, clientId, ttlSeconds) {
  assertGoogleClientId(clientId);
  const normalizedTtl = normalizeSessionTtlSeconds(ttlSeconds);
  const existing = readConfiguredAuthVars(source);
  if (existing) {
    assertAuthVars(existing, clientId, normalizedTtl);
    if (source.includes(AUTH_RUNTIME_MARKER)) {
      throw new Error('Configured auth vars must not retain the provisioning marker.');
    }
    return source;
  }

  if (!source.includes(AUTH_RUNTIME_MARKER)) {
    throw new Error('Root wrangler.jsonc is missing the auth runtime provisioning marker.');
  }

  const varsBlock = `,\n  "vars": {\n    "GOOGLE_CLIENT_ID": "${clientId}",\n    "SESSION_TTL_SECONDS": "${normalizedTtl}"\n  }`;
  const rendered = source.replace(`\n${AUTH_RUNTIME_MARKER}`, varsBlock);
  const configured = readConfiguredAuthVars(rendered);
  if (!configured) throw new Error('Failed to render auth runtime vars.');
  assertAuthVars(configured, clientId, normalizedTtl);
  return rendered;
}

export function validateAuthRuntimeEnvironment(env) {
  assertGoogleClientId(env.GOOGLE_CLIENT_ID);
  normalizeSessionTtlSeconds(env.SESSION_TTL_SECONDS);
  assertSessionSecret(env.SESSION_SECRET);
}

async function main() {
  const [mode, clientId, ttlSeconds, ...extra] = process.argv.slice(2);
  if (mode === '--write' && clientId && ttlSeconds && extra.length === 0) {
    const configPath = resolve(process.cwd(), 'wrangler.jsonc');
    const source = await readFile(configPath, 'utf8');
    const rendered = renderAuthRuntimeVars(source, clientId, ttlSeconds);
    if (rendered === source) {
      console.log('Auth runtime public vars already match the selected configuration.');
      return;
    }
    await writeFile(configPath, rendered, 'utf8');
    console.log('Updated wrangler.jsonc with auth runtime public vars.');
    return;
  }

  if (mode === '--check-env' && clientId === undefined && ttlSeconds === undefined && extra.length === 0) {
    validateAuthRuntimeEnvironment(process.env);
    console.log('Auth runtime environment is valid.');
    return;
  }

  console.error('Usage: node scripts/configure-auth-runtime.mjs --write <google-client-id> <ttl-seconds>');
  console.error('   or: node scripts/configure-auth-runtime.mjs --check-env');
  process.exitCode = 2;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  await main();
}
