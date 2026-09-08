import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CANONICAL_D1_MARKER,
  assertCanonicalBinding,
  readConfiguredCanonicalBinding,
  renderCanonicalD1Binding,
} from '../scripts/configure-canonical-d1.mjs';

const root = new URL('../', import.meta.url);
const readRepoFile = path => readFile(new URL(path, root), 'utf8');
const REAL_ID = '12345678-1234-4abc-9def-1234567890ab';

function parseJson(source) {
  return JSON.parse(source.replace(/^\s*\/\/.*$/gm, ''));
}

test('root wrangler is either unprovisioned marker state or one canonical remote D1 binding', async () => {
  const source = await readRepoFile('wrangler.jsonc');
  const binding = readConfiguredCanonicalBinding(source);
  if (binding === null) {
    assert.match(source, new RegExp(CANONICAL_D1_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(source, /preview_database_id/);
    return;
  }
  assert.doesNotMatch(source, /CANONICAL_D1_BINDING_PLACEHOLDER/);
  assert.match(binding.database_id, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  assertCanonicalBinding(binding, binding.database_id);
});

test('local D1 config remains isolated from the canonical remote resource', async () => {
  const local = parseJson(await readRepoFile('wrangler.local.jsonc'));
  assert.equal(local.name, 'electricity-meter-tracker-local');
  assert.deepEqual(local.d1_databases, [{
    binding: 'DB',
    database_name: 'electricity-meter-tracker-local',
    database_id: '00000000-0000-0000-0000-000000000000',
    preview_database_id: 'local-electricity-meter-tracker',
    migrations_dir: 'migrations',
  }]);
  assert.equal(local.vars?.LOCAL_PERSISTENCE_CHECK, '1');
});

test('.env.example contains names only and no runtime values', async () => {
  const source = await readRepoFile('.env.example');
  const assignments = source.split(/\r?\n/).filter(line => /^[A-Z0-9_]+=/.test(line));
  assert.deepEqual(assignments, ['GOOGLE_CLIENT_ID=', 'SESSION_SECRET=', 'SESSION_TTL_SECONDS=']);
});

test('renderer inserts the canonical binding without a preview database id', async () => {
  const source = await readRepoFile('wrangler.jsonc');
  if (readConfiguredCanonicalBinding(source) !== null) return;
  const rendered = renderCanonicalD1Binding(source, REAL_ID);
  const binding = readConfiguredCanonicalBinding(rendered);
  assert.ok(binding);
  assertCanonicalBinding(binding, REAL_ID);
  assert.doesNotMatch(rendered, /CANONICAL_D1_BINDING_PLACEHOLDER/);
  assert.doesNotMatch(rendered, /preview_database_id/);
});

test('renderer is idempotent for the same canonical database id', async () => {
  const source = await readRepoFile('wrangler.jsonc');
  const first = readConfiguredCanonicalBinding(source) === null
    ? renderCanonicalD1Binding(source, REAL_ID)
    : source;
  const binding = readConfiguredCanonicalBinding(first);
  assert.ok(binding);
  assert.equal(renderCanonicalD1Binding(first, binding.database_id), first);
});

test('renderer refuses invalid, mismatched, or noncanonical remote identities', async () => {
  const source = await readRepoFile('wrangler.jsonc');
  assert.throws(() => renderCanonicalD1Binding(source, 'not-a-real-id'), /real UUID/);

  const preprovisioned = readConfiguredCanonicalBinding(source) === null
    ? renderCanonicalD1Binding(source, REAL_ID)
    : source;
  const current = readConfiguredCanonicalBinding(preprovisioned);
  assert.ok(current);
  const otherId = current.database_id === REAL_ID
    ? '87654321-4321-4abc-9def-abcdef123456'
    : REAL_ID;
  assert.throws(() => renderCanonicalD1Binding(preprovisioned, otherId), /does not match/);

  const wrongName = preprovisioned.replace('"database_name": "electricity-meter-tracker"', '"database_name": "other-db"');
  assert.throws(() => renderCanonicalD1Binding(wrongName, current.database_id), /database_name/);
});
