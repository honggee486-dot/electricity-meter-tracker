import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SESSION_COOKIE_NAME,
  createSessionToken,
} from '../.worker-test/auth/session.js';
import { handleWorkerRequest } from '../.worker-test/worker.js';

const NOW_MS = 1_800_000_000_000;
const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const SESSION_SECRET = '0123456789abcdef0123456789abcdef';

class MemoryStatement {
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
    return this.db.first(this.sql, this.values);
  }

  async all() {
    return { results: this.db.all(this.sql, this.values) };
  }

  async run() {
    this.db.run(this.sql, this.values);
    return { success: true };
  }
}

class MemoryDb {
  constructor({ users = [], meters = [], members = [], readings = [] } = {}) {
    this.users = structuredClone(users);
    this.meters = structuredClone(meters);
    this.members = structuredClone(members);
    this.readings = structuredClone(readings);
    this.calls = [];
  }

  prepare(sql) {
    return new MemoryStatement(this, sql);
  }

  first(sql, values) {
    if (sql.includes('FROM users')) {
      if (sql.includes('WHERE user_id = ?1')) {
        return this.users.find((row) => row.user_id === values[0]) ?? null;
      }
      if (sql.includes('WHERE google_subject = ?1')) {
        return this.users.find((row) => row.google_subject === values[0]) ?? null;
      }
    }

    if (sql.includes('LEFT JOIN meter_members')) {
      const [meterId, userId] = values;
      const meter = this.meters.find((row) => row.meter_id === meterId);
      if (!meter) return null;
      if (meter.owner_user_id === userId) return { ...meter, access_role: 'owner' };
      const shared = this.members.some((row) => row.meter_id === meterId && row.user_id === userId);
      return shared ? { ...meter, access_role: 'viewer' } : null;
    }

    if (sql.includes('FROM meters') && sql.includes('WHERE meter_id = ?1')) {
      return this.meters.find((row) => row.meter_id === values[0]) ?? null;
    }

    if (sql.includes('FROM readings')) {
      const [meterId, second, excluded] = values;
      let rows = this.readings.filter((row) => row.meter_id === meterId);
      if (sql.includes('reading_id = ?2')) {
        rows = rows.filter((row) => row.reading_id === second);
      } else if (sql.includes('measured_at_ms = ?2')) {
        rows = rows.filter((row) => row.measured_at_ms === second);
      } else if (sql.includes('measured_at_ms < ?2')) {
        rows = rows.filter((row) => row.measured_at_ms < second);
        if (excluded !== undefined) rows = rows.filter((row) => row.reading_id !== excluded);
        rows.sort((a, b) => b.measured_at_ms - a.measured_at_ms);
      } else if (sql.includes('measured_at_ms > ?2')) {
        rows = rows.filter((row) => row.measured_at_ms > second);
        if (excluded !== undefined) rows = rows.filter((row) => row.reading_id !== excluded);
        rows.sort((a, b) => a.measured_at_ms - b.measured_at_ms);
      }
      return rows[0] ?? null;
    }

    return null;
  }

  all(sql, values) {
    if (sql.includes('UNION ALL') && sql.includes("'owner' AS access_role")) {
      const userId = values[0];
      const owner = this.meters
        .filter((row) => row.owner_user_id === userId)
        .map((row) => ({ ...row, access_role: 'owner' }));
      const viewer = this.members
        .filter((member) => member.user_id === userId)
        .map((member) => this.meters.find((meter) => meter.meter_id === member.meter_id))
        .filter((meter) => meter && meter.owner_user_id !== userId)
        .map((meter) => ({ ...meter, access_role: 'viewer' }));
      return [...owner, ...viewer].sort((a, b) => a.meter_id.localeCompare(b.meter_id));
    }

    if (sql.includes('FROM meters') && sql.includes('owner_user_id = ?1')) {
      return this.meters
        .filter((row) => row.owner_user_id === values[0])
        .sort((a, b) => a.meter_id.localeCompare(b.meter_id));
    }
    if (sql.includes('FROM meter_members')) {
      return this.members
        .filter((row) => row.user_id === values[0])
        .map((row) => ({ meter_id: row.meter_id }))
        .sort((a, b) => a.meter_id.localeCompare(b.meter_id));
    }
    if (sql.includes('FROM readings')) {
      return this.readings
        .filter((row) => row.meter_id === values[0])
        .sort((a, b) => a.measured_at_ms - b.measured_at_ms);
    }
    return [];
  }

  run(sql, values) {
    if (sql.includes('INSERT OR IGNORE INTO users')) {
      const [userId, googleSubject, createdAtMs] = values;
      if (!this.users.some((row) => row.user_id === userId || row.google_subject === googleSubject)) {
        this.users.push({ user_id: userId, google_subject: googleSubject, created_at_ms: createdAtMs });
      }
      return;
    }

    if (sql.includes('INSERT OR IGNORE INTO meters')) {
      const [meterId, ownerUserId, name, timezone, closeKind, closeDay, createdAtMs, updatedAtMs] = values;
      if (!this.meters.some((row) => row.meter_id === meterId)) {
        this.meters.push({
          meter_id: meterId,
          owner_user_id: ownerUserId,
          name,
          timezone,
          billing_close_kind: closeKind,
          billing_close_day: closeDay,
          created_at_ms: createdAtMs,
          updated_at_ms: updatedAtMs,
        });
      }
      return;
    }

    if (sql.startsWith('UPDATE meters') || sql.includes('\n         SET name = ?2')) {
      const [meterId, name, timezone, closeKind, closeDay, updatedAtMs] = values;
      const meter = this.meters.find((row) => row.meter_id === meterId);
      if (meter) {
        Object.assign(meter, {
          name,
          timezone,
          billing_close_kind: closeKind,
          billing_close_day: closeDay,
          updated_at_ms: updatedAtMs,
        });
      }
      return;
    }

    if (sql.startsWith('DELETE FROM meters')) {
      const [meterId] = values;
      this.meters = this.meters.filter((row) => row.meter_id !== meterId);
      this.members = this.members.filter((row) => row.meter_id !== meterId);
      this.readings = this.readings.filter((row) => row.meter_id !== meterId);
      return;
    }

    if (sql.includes('INSERT OR IGNORE INTO readings')) {
      const [readingId, meterId, measuredAtMs, cumulativeWh, createdAtMs] = values;
      const conflict = this.readings.some(
        (row) => row.reading_id === readingId || (row.meter_id === meterId && row.measured_at_ms === measuredAtMs),
      );
      if (!conflict) {
        this.readings.push({
          reading_id: readingId,
          meter_id: meterId,
          measured_at_ms: measuredAtMs,
          cumulative_wh: cumulativeWh,
          created_at_ms: createdAtMs,
        });
      }
      return;
    }

    if (sql.startsWith('UPDATE OR IGNORE readings')) {
      const [meterId, readingId, measuredAtMs, cumulativeWh] = values;
      const reading = this.readings.find(
        (row) => row.meter_id === meterId && row.reading_id === readingId,
      );
      const conflict = this.readings.some(
        (row) => row.meter_id === meterId && row.reading_id !== readingId && row.measured_at_ms === measuredAtMs,
      );
      if (reading && !conflict) {
        reading.measured_at_ms = measuredAtMs;
        reading.cumulative_wh = cumulativeWh;
      }
      return;
    }

    if (sql.startsWith('DELETE FROM readings')) {
      const [meterId, readingId] = values;
      this.readings = this.readings.filter(
        (row) => !(row.meter_id === meterId && row.reading_id === readingId),
      );
    }
  }
}

const userRow = (userId) => ({
  user_id: userId,
  google_subject: `subject-${userId}`,
  created_at_ms: 1,
});

const meterRow = (meterId = 'meter-1', ownerUserId = 'owner-1') => ({
  meter_id: meterId,
  owner_user_id: ownerUserId,
  name: 'Home',
  timezone: 'Asia/Seoul',
  billing_close_kind: 'day',
  billing_close_day: 21,
  created_at_ms: 1,
  updated_at_ms: 1,
});

const readingRow = (readingId, measuredAtMs, cumulativeWh) => ({
  reading_id: readingId,
  meter_id: 'meter-1',
  measured_at_ms: measuredAtMs,
  cumulative_wh: cumulativeWh,
  created_at_ms: measuredAtMs,
});

function env(db) {
  return {
    DB: db,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    SESSION_SECRET,
    SESSION_TTL_SECONDS: '3600',
  };
}

async function sessionCookie(userId) {
  const token = await createSessionToken(userId, SESSION_SECRET, 3600, NOW_MS);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function call(db, userId, path, init = {}, dependencies = {}) {
  const headers = new Headers(init.headers);
  if (userId) headers.set('cookie', await sessionCookie(userId));
  return handleWorkerRequest(
    new Request(`https://example.test${path}`, { ...init, headers }),
    env(db),
    { nowMs: () => NOW_MS + 1000, ...dependencies },
  );
}

function jsonInit(method, body) {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

test('all meter product routes require a valid internal session first', async () => {
  const db = new MemoryDb({ users: [userRow('owner-1')] });
  const response = await call(db, null, '/api/meters');
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
});

test('owner creates, lists and updates meter settings without accepting client owner identity', async () => {
  const db = new MemoryDb({ users: [userRow('owner-1')] });
  const created = await call(
    db,
    'owner-1',
    '/api/meters',
    jsonInit('POST', {
      name: '우리집',
      timezone: 'Asia/Seoul',
      billingClose: { kind: 'day', day: 30 },
    }),
    { randomUUID: () => 'meter-created' },
  );
  assert.equal(created.status, 201);
  assert.deepEqual((await created.json()).meter, {
    meterId: 'meter-created',
    name: '우리집',
    timezone: 'Asia/Seoul',
    billingClose: { kind: 'day', day: 30 },
    role: 'owner',
    createdAtMs: NOW_MS + 1000,
    updatedAtMs: NOW_MS + 1000,
  });
  assert.equal(db.meters[0].owner_user_id, 'owner-1');

  const tampered = await call(
    db,
    'owner-1',
    '/api/meters',
    jsonInit('POST', {
      name: 'Injected',
      timezone: 'UTC',
      billingClose: { kind: 'month-end' },
      ownerUserId: 'other-user',
    }),
  );
  assert.equal(tampered.status, 400);
  assert.equal(db.meters.length, 1);

  const updated = await call(
    db,
    'owner-1',
    '/api/meters/meter-created',
    jsonInit('PUT', {
      name: 'Updated',
      timezone: 'UTC',
      billingClose: { kind: 'month-end' },
    }),
  );
  assert.equal(updated.status, 200);
  const updatedBody = await updated.json();
  assert.deepEqual(updatedBody.meter.billingClose, { kind: 'month-end' });
  assert.equal(updatedBody.meter.role, 'owner');
  assert.equal(db.meters[0].owner_user_id, 'owner-1');

  const listed = await call(db, 'owner-1', '/api/meters');
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).meters.map((meter) => meter.meterId), ['meter-created']);
});

test('viewer can read shared meter data but cannot mutate it, and revoked access becomes not-found', async () => {
  const db = new MemoryDb({
    users: [userRow('owner-1'), userRow('viewer-1'), userRow('outsider-1')],
    meters: [meterRow()],
    members: [{ meter_id: 'meter-1', user_id: 'viewer-1', created_at_ms: 1 }],
    readings: [readingRow('reading-1', 1000, 100000)],
  });

  const viewerMeter = await call(db, 'viewer-1', '/api/meters/meter-1');
  assert.equal(viewerMeter.status, 200);
  assert.equal((await viewerMeter.json()).meter.role, 'viewer');

  const viewerReadings = await call(db, 'viewer-1', '/api/meters/meter-1/readings');
  assert.equal(viewerReadings.status, 200);
  assert.equal((await viewerReadings.json()).readings.length, 1);

  const viewerUpdate = await call(
    db,
    'viewer-1',
    '/api/meters/meter-1',
    jsonInit('PUT', { name: 'No', timezone: 'UTC', billingClose: { kind: 'month-end' } }),
  );
  assert.equal(viewerUpdate.status, 403);

  const viewerCreateReading = await call(
    db,
    'viewer-1',
    '/api/meters/meter-1/readings',
    jsonInit('POST', { measuredAtMs: 2000, cumulativeKwh: '101' }),
  );
  assert.equal(viewerCreateReading.status, 403);

  const outsider = await call(db, 'outsider-1', '/api/meters/meter-1');
  assert.equal(outsider.status, 404);

  db.members = [];
  const revoked = await call(db, 'viewer-1', '/api/meters/meter-1');
  assert.equal(revoked.status, 404);
});

test('owner reading CRUD preserves measured-instant uniqueness and cumulative monotonicity', async () => {
  const db = new MemoryDb({
    users: [userRow('owner-1')],
    meters: [meterRow()],
    readings: [
      readingRow('reading-1', 1000, 100000),
      readingRow('reading-3', 3000, 102000),
    ],
  });

  const created = await call(
    db,
    'owner-1',
    '/api/meters/meter-1/readings',
    jsonInit('POST', { measuredAtMs: 2000, cumulativeKwh: '101' }),
    { randomUUID: () => 'reading-2' },
  );
  assert.equal(created.status, 201);
  assert.equal((await created.json()).reading.cumulativeWh, 101000);

  const duplicate = await call(
    db,
    'owner-1',
    '/api/meters/meter-1/readings',
    jsonInit('POST', { measuredAtMs: 2000, cumulativeKwh: '101.5' }),
  );
  assert.equal(duplicate.status, 409);

  const decreased = await call(
    db,
    'owner-1',
    '/api/meters/meter-1/readings',
    jsonInit('POST', { measuredAtMs: 2500, cumulativeKwh: '99' }),
  );
  assert.equal(decreased.status, 409);

  const invalidUpdate = await call(
    db,
    'owner-1',
    '/api/meters/meter-1/readings/reading-2',
    jsonInit('PUT', { measuredAtMs: 2500, cumulativeKwh: '103' }),
  );
  assert.equal(invalidUpdate.status, 409);

  const updated = await call(
    db,
    'owner-1',
    '/api/meters/meter-1/readings/reading-2',
    jsonInit('PUT', { measuredAtMs: 2200, cumulativeKwh: '101.2' }),
  );
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).reading.cumulativeWh, 101200);

  const single = await call(db, 'owner-1', '/api/meters/meter-1/readings/reading-2');
  assert.equal(single.status, 200);
  assert.equal((await single.json()).reading.measuredAtMs, 2200);

  const removed = await call(db, 'owner-1', '/api/meters/meter-1/readings/reading-2', { method: 'DELETE' });
  assert.equal(removed.status, 204);
  assert.equal(db.readings.some((row) => row.reading_id === 'reading-2'), false);
});

test('meter and reading bodies validate timezone, billing close, precision and content type', async () => {
  const db = new MemoryDb({ users: [userRow('owner-1')], meters: [meterRow()] });

  const badZone = await call(
    db,
    'owner-1',
    '/api/meters/meter-1',
    jsonInit('PUT', { name: 'Home', timezone: 'Not/AZone', billingClose: { kind: 'day', day: 21 } }),
  );
  assert.equal(badZone.status, 400);

  const badClose = await call(
    db,
    'owner-1',
    '/api/meters/meter-1',
    jsonInit('PUT', { name: 'Home', timezone: 'Asia/Seoul', billingClose: { kind: 'day', day: 32 } }),
  );
  assert.equal(badClose.status, 400);

  const badPrecision = await call(
    db,
    'owner-1',
    '/api/meters/meter-1/readings',
    jsonInit('POST', { measuredAtMs: 2000, cumulativeKwh: '100.0001' }),
  );
  assert.equal(badPrecision.status, 400);

  const wrongType = await call(db, 'owner-1', '/api/meters', { method: 'POST', body: '{}' });
  assert.equal(wrongType.status, 415);
});

test('dynamic resource values remain bound parameters instead of SQL interpolation', async () => {
  const db = new MemoryDb({
    users: [userRow('owner-1')],
    meters: [meterRow()],
    readings: [readingRow('reading-1', 1000, 100000)],
  });
  const response = await call(db, 'owner-1', '/api/meters/meter-1/readings');
  assert.equal(response.status, 200);
  assert.ok(db.calls.length > 0);
  for (const callRecord of db.calls) {
    for (const value of callRecord.values) {
      if (typeof value === 'string' && ['owner-1', 'meter-1', 'reading-1'].includes(value)) {
        assert.equal(callRecord.sql.includes(value), false);
      }
    }
  }
});
