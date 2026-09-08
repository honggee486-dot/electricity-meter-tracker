export type D1Value = string | number | null | ArrayBuffer | ArrayBufferView;

export interface D1PreparedStatementLike {
  bind(...values: D1Value[]): D1PreparedStatementLike;
  first<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T | null>;
  all<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<{ results: T[] }>;
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

function mapReading(row: Row): PersistedReading {
  return {
    readingId: requireString(row, 'reading_id'),
    meterId: requireString(row, 'meter_id'),
    measuredAtMs: requireSafeInteger(row, 'measured_at_ms'),
    cumulativeWh: requireSafeInteger(row, 'cumulative_wh'),
    createdAtMs: requireSafeInteger(row, 'created_at_ms'),
  };
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
