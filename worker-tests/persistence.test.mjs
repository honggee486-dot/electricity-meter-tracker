import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PersistenceDataError,
  ensureUserByGoogleSubject,
  findUserByGoogleSubject,
  findUserById,
  listMeterReadings,
  listOwnedMeters,
  listViewerMeterIds,
} from '../.worker-test/persistence/d1.js';
import { handleWorkerRequest } from '../.worker-test/worker.js';

class FakeStatement {
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
    return this.db.resolve(this.sql, this.values, 'first');
  }

  async all() {
    return { results: this.db.resolve(this.sql, this.values, 'all') };
  }

  async run() {
    if (this.sql.includes('INSERT OR IGNORE INTO users')) {
      const [userId, googleSubject, createdAtMs] = this.values;
      const users = Array.isArray(this.db.rows.users) ? this.db.rows.users : [];
      if (!users.some((user) => user.user_id === userId || user.google_subject === googleSubject)) {
        users.push({ user_id: userId, google_subject: googleSubject, created_at_ms: createdAtMs });
      }
      this.db.rows.users = users;
    }
    return { success: true };
  }
}

class FakeDb {
  constructor(rows = {}) {
    this.rows = rows;
    this.calls = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  resolve(sql, values, mode) {
    const key = sql.includes('FROM users')
      ? 'users'
      : sql.includes('FROM meters')
        ? 'meters'
        : sql.includes('FROM meter_members')
          ? 'meter_members'
          : sql.includes('FROM readings')
            ? 'readings'
            : 'unknown';
    let value = this.rows[key];
    if (key === 'users' && Array.isArray(value)) {
      if (sql.includes('WHERE google_subject = ?1')) {
        value = value.filter((row) => row.google_subject === values[0]);
      } else if (sql.includes('WHERE user_id = ?1')) {
        value = value.filter((row) => row.user_id === values[0]);
      }
    }
    if (mode === 'first') {
      return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
    }
    return Array.isArray(value) ? value : value == null ? [] : [value];
  }
}

const meterRow = {
  meter_id: 'meter-1',
  owner_user_id: 'owner-1',
  name: 'Home',
  timezone: 'Asia/Seoul',
  billing_close_kind: 'day',
  billing_close_day: 21,
  created_at_ms: 1,
  updated_at_ms: 1,
};

test('identity lookup uses a bound Google subject and maps the stored row', async () => {
  const db = new FakeDb({
    users: [{ user_id: 'user-1', google_subject: 'subject-1', created_at_ms: 1 }],
  });

  assert.deepEqual(await findUserByGoogleSubject(db, 'subject-1'), {
    userId: 'user-1',
    googleSubject: 'subject-1',
    createdAtMs: 1,
  });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /google_subject = \?1/);
  assert.deepEqual(db.calls[0].values, ['subject-1']);
});

test('internal user lookup and first-login insert stay parameterized and idempotent', async () => {
  const db = new FakeDb({ users: [] });

  const created = await ensureUserByGoogleSubject(db, 'subject-1', 'candidate-1', 1234);
  assert.deepEqual(created, {
    userId: 'candidate-1',
    googleSubject: 'subject-1',
    createdAtMs: 1234,
  });
  assert.deepEqual(await findUserById(db, 'candidate-1'), created);

  const returning = await ensureUserByGoogleSubject(db, 'subject-1', 'candidate-2', 9999);
  assert.deepEqual(returning, created);
  assert.equal(db.rows.users.length, 1);

  const insertCall = db.calls.find((call) => call.sql.includes('INSERT OR IGNORE INTO users'));
  assert.ok(insertCall);
  assert.deepEqual(insertCall.values, ['candidate-1', 'subject-1', 1234]);
});

test('owner, viewer and reading queries stay parameterized and preserve ordering contracts', async () => {
  const db = new FakeDb({
    meters: [meterRow],
    meter_members: [{ meter_id: 'meter-1' }],
    readings: [
      {
        reading_id: 'reading-1', meter_id: 'meter-1', measured_at_ms: 1000,
        cumulative_wh: 100000, created_at_ms: 1000,
      },
      {
        reading_id: 'reading-2', meter_id: 'meter-1', measured_at_ms: 2000,
        cumulative_wh: 101000, created_at_ms: 2000,
      },
    ],
  });

  assert.deepEqual((await listOwnedMeters(db, 'owner-1')).map((meter) => meter.meterId), ['meter-1']);
  assert.deepEqual(await listViewerMeterIds(db, 'viewer-1'), ['meter-1']);
  assert.deepEqual((await listMeterReadings(db, 'meter-1')).map((reading) => reading.measuredAtMs), [1000, 2000]);

  assert.equal(db.calls.length, 3);
  for (const call of db.calls) {
    assert.match(call.sql, /\?1/);
    assert.equal(call.values.length, 1);
  }
  assert.match(db.calls[0].sql, /ORDER BY meter_id/);
  assert.match(db.calls[1].sql, /ORDER BY meter_id/);
  assert.match(db.calls[2].sql, /ORDER BY measured_at_ms/);
});

test('row mapping rejects corrupted persistence values instead of leaking them into domain callers', async () => {
  const db = new FakeDb({ meters: [{ ...meterRow, billing_close_day: 32 }] });

  await assert.rejects(() => listOwnedMeters(db, 'owner-1'), PersistenceDataError);
});

test('local persistence route exercises all four persistence reads only when explicitly gated', async () => {
  const db = new FakeDb({
    users: [{ user_id: 'local-owner', google_subject: 'local-owner-subject', created_at_ms: 1 }],
    meters: [{ ...meterRow, meter_id: 'local-meter', owner_user_id: 'local-owner' }],
    meter_members: [{ meter_id: 'local-meter' }],
    readings: [
      {
        reading_id: 'local-reading-1', meter_id: 'local-meter', measured_at_ms: 1000,
        cumulative_wh: 100000, created_at_ms: 1000,
      },
      {
        reading_id: 'local-reading-2', meter_id: 'local-meter', measured_at_ms: 2000,
        cumulative_wh: 101000, created_at_ms: 2000,
      },
    ],
  });

  const response = await handleWorkerRequest(
    new Request('https://example.test/api/_dev/persistence-check'),
    { DB: db, LOCAL_PERSISTENCE_CHECK: '1' },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    userId: 'local-owner',
    ownerMeterIds: ['local-meter'],
    viewerMeterIds: ['local-meter'],
    readingInstants: [1000, 2000],
  });
  assert.equal(db.calls.length, 4);
});
