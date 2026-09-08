export type D1Value = string | number | null | ArrayBuffer | ArrayBufferView;

export interface D1RunResultLike {
  success: boolean;
}

export interface D1PreparedStatementLike {
  bind(...values: D1Value[]): D1PreparedStatementLike;
  first<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T | null>;
  all<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<D1RunResultLike>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

export interface PersistedUser {
  userId: string;
  googleSubject: string;
  createdAtMs: number;
}

export interface PersistedMeter {
  meterId: string;
  ownerUserId: string;
  name: string;
  timezone: string;
  billingCloseKind: 'day' | 'month-end';
  billingCloseDay: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export type MeterAccessRole = 'owner' | 'viewer';

export interface PersistedMeterAccess {
  meter: PersistedMeter;
  role: MeterAccessRole;
}

export interface PersistedReading {
  readingId: string;
  meterId: string;
  measuredAtMs: number;
  cumulativeWh: number;
  createdAtMs: number;
}

export class PersistenceDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceDataError';
  }
}

type Row = Record<string, unknown>;

function requireString(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== 'string') {
    throw new PersistenceDataError(`Expected ${field} to be a string.`);
  }
  return value;
}

function requireSafeInteger(row: Row, field: string): number {
  const value = row[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new PersistenceDataError(`Expected ${field} to be a safe integer.`);
  }
  return value;
}

function mapUser(row: Row): PersistedUser {
  return {
    userId: requireString(row, 'user_id'),
    googleSubject: requireString(row, 'google_subject'),
    createdAtMs: requireSafeInteger(row, 'created_at_ms'),
  };
}

function mapMeter(row: Row): PersistedMeter {
  const billingCloseKind = requireString(row, 'billing_close_kind');
  if (billingCloseKind !== 'day' && billingCloseKind !== 'month-end') {
    throw new PersistenceDataError('Expected billing_close_kind to be day or month-end.');
  }

  const rawDay = row.billing_close_day;
  const billingCloseDay = rawDay === null ? null : requireSafeInteger(row, 'billing_close_day');
  if (billingCloseKind === 'day' && (billingCloseDay === null || billingCloseDay < 1 || billingCloseDay > 31)) {
    throw new PersistenceDataError('Expected day billing close to include a day from 1 through 31.');
  }
  if (billingCloseKind === 'month-end' && billingCloseDay !== null) {
    throw new PersistenceDataError('Expected month-end billing close to omit billing_close_day.');
  }

  return {
    meterId: requireString(row, 'meter_id'),
    ownerUserId: requireString(row, 'owner_user_id'),
    name: requireString(row, 'name'),
    timezone: requireString(row, 'timezone'),
    billingCloseKind,
    billingCloseDay,
    createdAtMs: requireSafeInteger(row, 'created_at_ms'),
    updatedAtMs: requireSafeInteger(row, 'updated_at_ms'),
  };
}

function mapMeterAccess(row: Row): PersistedMeterAccess {
  const role = requireString(row, 'access_role');
  if (role !== 'owner' && role !== 'viewer') {
    throw new PersistenceDataError('Expected access_role to be owner or viewer.');
  }
  return { meter: mapMeter(row), role };
}

function mapReading(row: Row): PersistedReading {
  return {
    readingId: requireString(row, 'reading_id'),
    meterId: requireString(row, 'meter_id'),
    measuredAtMs: requireSafeInteger(row, 'measured_at_ms'),
    cumulativeWh: requireSafeInteger(row, 'cumulative_wh'),
    createdAtMs: requireSafeInteger(row, 'created_at_ms'),
  };
}

function meterRowsEqual(first: PersistedMeter, second: PersistedMeter): boolean {
  return first.meterId === second.meterId
    && first.ownerUserId === second.ownerUserId
    && first.name === second.name
    && first.timezone === second.timezone
    && first.billingCloseKind === second.billingCloseKind
    && first.billingCloseDay === second.billingCloseDay
    && first.createdAtMs === second.createdAtMs
    && first.updatedAtMs === second.updatedAtMs;
}

function readingRowsEqual(first: PersistedReading, second: PersistedReading): boolean {
  return first.readingId === second.readingId
    && first.meterId === second.meterId
    && first.measuredAtMs === second.measuredAtMs
    && first.cumulativeWh === second.cumulativeWh
    && first.createdAtMs === second.createdAtMs;
}

async function requireRunSuccess(result: Promise<D1RunResultLike>, operation: string): Promise<void> {
  const resolved = await result;
  if (!resolved.success) {
    throw new PersistenceDataError(`${operation} did not complete successfully.`);
  }
}

export async function findUserByGoogleSubject(
  db: D1DatabaseLike,
  googleSubject: string,
): Promise<PersistedUser | null> {
  const row = await db
    .prepare(
      `SELECT user_id, google_subject, created_at_ms
       FROM users
       WHERE google_subject = ?1
       LIMIT 1`,
    )
    .bind(googleSubject)
    .first();

  return row === null ? null : mapUser(row);
}

export async function findUserById(
  db: D1DatabaseLike,
  userId: string,
): Promise<PersistedUser | null> {
  const row = await db
    .prepare(
      `SELECT user_id, google_subject, created_at_ms
       FROM users
       WHERE user_id = ?1
       LIMIT 1`,
    )
    .bind(userId)
    .first();

  return row === null ? null : mapUser(row);
}

export async function ensureUserByGoogleSubject(
  db: D1DatabaseLike,
  googleSubject: string,
  candidateUserId: string,
  createdAtMs: number,
): Promise<PersistedUser> {
  const existing = await findUserByGoogleSubject(db, googleSubject);
  if (existing) {
    return existing;
  }

  await requireRunSuccess(
    db
      .prepare(
        `INSERT OR IGNORE INTO users (user_id, google_subject, created_at_ms)
         VALUES (?1, ?2, ?3)`,
      )
      .bind(candidateUserId, googleSubject, createdAtMs)
      .run(),
    'User insert',
  );

  const stored = await findUserByGoogleSubject(db, googleSubject);
  if (!stored) {
    throw new PersistenceDataError('Failed to resolve user after first-login insert.');
  }
  return stored;
}

export async function listOwnedMeters(
  db: D1DatabaseLike,
  ownerUserId: string,
): Promise<PersistedMeter[]> {
  const { results } = await db
    .prepare(
      `SELECT meter_id, owner_user_id, name, timezone,
              billing_close_kind, billing_close_day, created_at_ms, updated_at_ms
       FROM meters
       WHERE owner_user_id = ?1
       ORDER BY meter_id`,
    )
    .bind(ownerUserId)
    .all();

  return results.map(mapMeter);
}

export async function listViewerMeterIds(
  db: D1DatabaseLike,
  userId: string,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT meter_id
       FROM meter_members
       WHERE user_id = ?1
       ORDER BY meter_id`,
    )
    .bind(userId)
    .all();

  return results.map((row) => requireString(row, 'meter_id'));
}

export async function listAccessibleMeters(
  db: D1DatabaseLike,
  userId: string,
): Promise<PersistedMeterAccess[]> {
  const { results } = await db
    .prepare(
      `SELECT meter_id, owner_user_id, name, timezone,
              billing_close_kind, billing_close_day, created_at_ms, updated_at_ms,
              'owner' AS access_role
       FROM meters
       WHERE owner_user_id = ?1
       UNION ALL
       SELECT m.meter_id, m.owner_user_id, m.name, m.timezone,
              m.billing_close_kind, m.billing_close_day, m.created_at_ms, m.updated_at_ms,
              'viewer' AS access_role
       FROM meter_members AS mm
       JOIN meters AS m ON m.meter_id = mm.meter_id
       WHERE mm.user_id = ?1 AND m.owner_user_id <> ?1
       ORDER BY meter_id`,
    )
    .bind(userId)
    .all();

  return results.map(mapMeterAccess);
}

export async function findMeterById(
  db: D1DatabaseLike,
  meterId: string,
): Promise<PersistedMeter | null> {
  const row = await db
    .prepare(
      `SELECT meter_id, owner_user_id, name, timezone,
              billing_close_kind, billing_close_day, created_at_ms, updated_at_ms
       FROM meters
       WHERE meter_id = ?1
       LIMIT 1`,
    )
    .bind(meterId)
    .first();

  return row === null ? null : mapMeter(row);
}

export async function findMeterAccess(
  db: D1DatabaseLike,
  meterId: string,
  userId: string,
): Promise<PersistedMeterAccess | null> {
  const row = await db
    .prepare(
      `SELECT m.meter_id, m.owner_user_id, m.name, m.timezone,
              m.billing_close_kind, m.billing_close_day, m.created_at_ms, m.updated_at_ms,
              CASE WHEN m.owner_user_id = ?2 THEN 'owner' ELSE 'viewer' END AS access_role
       FROM meters AS m
       LEFT JOIN meter_members AS mm
         ON mm.meter_id = m.meter_id AND mm.user_id = ?2
       WHERE m.meter_id = ?1
         AND (m.owner_user_id = ?2 OR mm.user_id IS NOT NULL)
       LIMIT 1`,
    )
    .bind(meterId, userId)
    .first();

  return row === null ? null : mapMeterAccess(row);
}

export async function createMeter(
  db: D1DatabaseLike,
  meter: PersistedMeter,
): Promise<PersistedMeter> {
  await requireRunSuccess(
    db
      .prepare(
        `INSERT OR IGNORE INTO meters (
           meter_id, owner_user_id, name, timezone,
           billing_close_kind, billing_close_day, created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        meter.meterId,
        meter.ownerUserId,
        meter.name,
        meter.timezone,
        meter.billingCloseKind,
        meter.billingCloseDay,
        meter.createdAtMs,
        meter.updatedAtMs,
      )
      .run(),
    'Meter insert',
  );

  const stored = await findMeterById(db, meter.meterId);
  if (!stored || !meterRowsEqual(stored, meter)) {
    throw new PersistenceDataError('Failed to create the requested meter.');
  }
  return stored;
}

export async function updateMeterSettings(
  db: D1DatabaseLike,
  meterId: string,
  name: string,
  timezone: string,
  billingCloseKind: PersistedMeter['billingCloseKind'],
  billingCloseDay: number | null,
  updatedAtMs: number,
): Promise<PersistedMeter | null> {
  await requireRunSuccess(
    db
      .prepare(
        `UPDATE meters
         SET name = ?2,
             timezone = ?3,
             billing_close_kind = ?4,
             billing_close_day = ?5,
             updated_at_ms = ?6
         WHERE meter_id = ?1`,
      )
      .bind(meterId, name, timezone, billingCloseKind, billingCloseDay, updatedAtMs)
      .run(),
    'Meter update',
  );
  return findMeterById(db, meterId);
}

export async function deleteMeter(db: D1DatabaseLike, meterId: string): Promise<void> {
  await requireRunSuccess(
    db.prepare('DELETE FROM meters WHERE meter_id = ?1').bind(meterId).run(),
    'Meter delete',
  );
}

export async function listMeterReadings(
  db: D1DatabaseLike,
  meterId: string,
): Promise<PersistedReading[]> {
  const { results } = await db
    .prepare(
      `SELECT reading_id, meter_id, measured_at_ms, cumulative_wh, created_at_ms
       FROM readings
       WHERE meter_id = ?1
       ORDER BY measured_at_ms`,
    )
    .bind(meterId)
    .all();

  return results.map(mapReading);
}

export async function findReadingById(
  db: D1DatabaseLike,
  meterId: string,
  readingId: string,
): Promise<PersistedReading | null> {
  const row = await db
    .prepare(
      `SELECT reading_id, meter_id, measured_at_ms, cumulative_wh, created_at_ms
       FROM readings
       WHERE meter_id = ?1 AND reading_id = ?2
       LIMIT 1`,
    )
    .bind(meterId, readingId)
    .first();
  return row === null ? null : mapReading(row);
}

export async function findReadingAt(
  db: D1DatabaseLike,
  meterId: string,
  measuredAtMs: number,
): Promise<PersistedReading | null> {
  const row = await db
    .prepare(
      `SELECT reading_id, meter_id, measured_at_ms, cumulative_wh, created_at_ms
       FROM readings
       WHERE meter_id = ?1 AND measured_at_ms = ?2
       LIMIT 1`,
    )
    .bind(meterId, measuredAtMs)
    .first();
  return row === null ? null : mapReading(row);
}

async function findNeighborReading(
  db: D1DatabaseLike,
  meterId: string,
  measuredAtMs: number,
  direction: 'before' | 'after',
  excludedReadingId?: string,
): Promise<PersistedReading | null> {
  const comparison = direction === 'before' ? '<' : '>';
  const ordering = direction === 'before' ? 'DESC' : 'ASC';
  const exclusion = excludedReadingId === undefined ? '' : ' AND reading_id <> ?3';
  const statement = db.prepare(
    `SELECT reading_id, meter_id, measured_at_ms, cumulative_wh, created_at_ms
     FROM readings
     WHERE meter_id = ?1 AND measured_at_ms ${comparison} ?2${exclusion}
     ORDER BY measured_at_ms ${ordering}
     LIMIT 1`,
  );
  const row = excludedReadingId === undefined
    ? await statement.bind(meterId, measuredAtMs).first()
    : await statement.bind(meterId, measuredAtMs, excludedReadingId).first();
  return row === null ? null : mapReading(row);
}

export function findPreviousReading(
  db: D1DatabaseLike,
  meterId: string,
  measuredAtMs: number,
  excludedReadingId?: string,
): Promise<PersistedReading | null> {
  return findNeighborReading(db, meterId, measuredAtMs, 'before', excludedReadingId);
}

export function findNextReading(
  db: D1DatabaseLike,
  meterId: string,
  measuredAtMs: number,
  excludedReadingId?: string,
): Promise<PersistedReading | null> {
  return findNeighborReading(db, meterId, measuredAtMs, 'after', excludedReadingId);
}

export async function createReading(
  db: D1DatabaseLike,
  reading: PersistedReading,
): Promise<PersistedReading | null> {
  await requireRunSuccess(
    db
      .prepare(
        `INSERT OR IGNORE INTO readings (
           reading_id, meter_id, measured_at_ms, cumulative_wh, created_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(
        reading.readingId,
        reading.meterId,
        reading.measuredAtMs,
        reading.cumulativeWh,
        reading.createdAtMs,
      )
      .run(),
    'Reading insert',
  );

  const stored = await findReadingById(db, reading.meterId, reading.readingId);
  return stored && readingRowsEqual(stored, reading) ? stored : null;
}

export async function updateReading(
  db: D1DatabaseLike,
  existing: PersistedReading,
  measuredAtMs: number,
  cumulativeWh: number,
): Promise<PersistedReading | null> {
  await requireRunSuccess(
    db
      .prepare(
        `UPDATE OR IGNORE readings
         SET measured_at_ms = ?3, cumulative_wh = ?4
         WHERE meter_id = ?1 AND reading_id = ?2`,
      )
      .bind(existing.meterId, existing.readingId, measuredAtMs, cumulativeWh)
      .run(),
    'Reading update',
  );

  const stored = await findReadingById(db, existing.meterId, existing.readingId);
  const expected: PersistedReading = { ...existing, measuredAtMs, cumulativeWh };
  return stored && readingRowsEqual(stored, expected) ? stored : null;
}

export async function deleteReading(
  db: D1DatabaseLike,
  meterId: string,
  readingId: string,
): Promise<void> {
  await requireRunSuccess(
    db
      .prepare('DELETE FROM readings WHERE meter_id = ?1 AND reading_id = ?2')
      .bind(meterId, readingId)
      .run(),
    'Reading delete',
  );
}
