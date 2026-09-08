import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CANONICAL_DATABASE_NAME = 'electricity-meter-tracker';
export const CANONICAL_BINDING = 'DB';
export const CANONICAL_MIGRATIONS_DIR = 'migrations';
export const CANONICAL_D1_MARKER = '  // CANONICAL_D1_BINDING_PLACEHOLDER';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseJsonc(source) {
  const withoutFullLineComments = source.replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(withoutFullLineComments);
}

export function assertCanonicalDatabaseId(databaseId) {
  if (!UUID_PATTERN.test(databaseId)) {
    throw new Error('Cloudflare D1 database_id must be a real UUID.');
  }
}

export function readConfiguredCanonicalBinding(source) {
  const parsed = parseJsonc(source);
  const bindings = parsed.d1_databases;
  if (bindings === undefined) return null;
  if (!Array.isArray(bindings)) {
    throw new Error('wrangler.jsonc d1_databases must be an array.');
  }
  if (bindings.length !== 1) {
    throw new Error('Expected exactly one canonical D1 binding in root wrangler.jsonc.');
  }
  const binding = bindings[0];
  if (!binding || typeof binding !== 'object') {
    throw new Error('Canonical D1 binding must be an object.');
  }
  return binding;
}

export function assertCanonicalBinding(binding, expectedDatabaseId) {
  if (binding.binding !== CANONICAL_BINDING) {
    throw new Error(`Root D1 binding must be ${CANONICAL_BINDING}.`);
  }
  if (binding.database_name !== CANONICAL_DATABASE_NAME) {
    throw new Error(`Root D1 database_name must be ${CANONICAL_DATABASE_NAME}.`);
  }
  if (binding.database_id !== expectedDatabaseId) {
    throw new Error('Root D1 database_id does not match the selected canonical database.');
  }
  if (binding.migrations_dir !== CANONICAL_MIGRATIONS_DIR) {
    throw new Error(`Root D1 migrations_dir must be ${CANONICAL_MIGRATIONS_DIR}.`);
  }
  if ('preview_database_id' in binding) {
    throw new Error('Canonical root binding must not define preview_database_id.');
  }
}

export function renderCanonicalD1Binding(source, databaseId) {
  assertCanonicalDatabaseId(databaseId);
  const existing = readConfiguredCanonicalBinding(source);
  if (existing) {
    assertCanonicalBinding(existing, databaseId);
    if (source.includes(CANONICAL_D1_MARKER)) {
      throw new Error('Configured root binding must not retain the provisioning marker.');
    }
    return source;
  }

  if (!source.includes(CANONICAL_D1_MARKER)) {
    throw new Error('Root wrangler.jsonc is missing the canonical D1 provisioning marker.');
  }

  const bindingBlock = `,\n  "d1_databases": [\n    {\n      "binding": "${CANONICAL_BINDING}",\n      "database_name": "${CANONICAL_DATABASE_NAME}",\n      "database_id": "${databaseId}",\n      "migrations_dir": "${CANONICAL_MIGRATIONS_DIR}"\n    }\n  ]`;
  const rendered = source.replace(`\n${CANONICAL_D1_MARKER}`, bindingBlock);
  const configured = readConfiguredCanonicalBinding(rendered);
  if (!configured) throw new Error('Failed to render canonical D1 binding.');
  assertCanonicalBinding(configured, databaseId);
  return rendered;
}

async function main() {
  const [mode, databaseId, ...extra] = process.argv.slice(2);
  if (mode !== '--write' || !databaseId || extra.length > 0) {
    console.error('Usage: node scripts/configure-canonical-d1.mjs --write <database-uuid>');
    process.exitCode = 2;
    return;
  }

  const configPath = resolve(process.cwd(), 'wrangler.jsonc');
  const source = await readFile(configPath, 'utf8');
  const rendered = renderCanonicalD1Binding(source, databaseId);
  if (rendered === source) {
    console.log('Canonical D1 binding already matches the selected database.');
    return;
  }
  await writeFile(configPath, rendered, 'utf8');
  console.log('Updated wrangler.jsonc with the canonical D1 binding.');
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  await main();
}
