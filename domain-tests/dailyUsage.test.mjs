import assert from 'node:assert/strict';
import test from 'node:test';

import {
  UsageDomainError,
  createMeterReadingPoint,
} from '../.domain-test/domain/usage.js';
import {
  splitUsageIntervalByLocalDate,
} from '../.domain-test/domain/dailyUsage.js';

const at = value => Date.parse(value);
const HOUR = 3_600_000;
const expectCode = code => error => error instanceof UsageDomainError && error.code === code;
const closeTo = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

test('same local date remains one actual-to-actual daily slice', () => {
  const result = splitUsageIntervalByLocalDate(
    createMeterReadingPoint('100', at('2026-09-08T12:00:00+09:00')),
    createMeterReadingPoint('106', at('2026-09-08T18:00:00+09:00')),
    'Asia/Seoul',
  );

  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].localDate, '2026-09-08');
  assert.equal(result.days[0].usageWh, 6_000);
  assert.equal(result.days[0].elapsedMs, 6 * HOUR);
  assert.deepEqual(result.points.map(point => point.provenance), ['actual', 'actual']);
  assert.equal(result.days[0].provenance, 'actual');
});

test('cross-midnight usage is linearly interpolated at the meter local boundary', () => {
  const result = splitUsageIntervalByLocalDate(
    createMeterReadingPoint('100', at('2026-09-08T22:00:00+09:00')),
    createMeterReadingPoint('104', at('2026-09-09T02:00:00+09:00')),
    'Asia/Seoul',
  );

  assert.deepEqual(result.days.map(day => day.localDate), ['2026-09-08', '2026-09-09']);
  assert.deepEqual(result.days.map(day => day.usageWh), [2_000, 2_000]);
  assert.equal(result.points[1].measuredAtMs, at('2026-09-09T00:00:00+09:00'));
  assert.equal(result.points[1].cumulativeWh, 102_000);
  assert.equal(result.points[1].provenance, 'interpolated');
  assert.deepEqual(result.days.map(day => day.provenance), ['interpolated', 'interpolated']);
});

test('multiple local dates preserve total usage and allocate by elapsed time', () => {
  const result = splitUsageIntervalByLocalDate(
    createMeterReadingPoint('200', at('2026-09-08T12:00:00+09:00')),
    createMeterReadingPoint('248', at('2026-09-10T12:00:00+09:00')),
    'Asia/Seoul',
  );

  assert.deepEqual(result.days.map(day => day.localDate), ['2026-09-08', '2026-09-09', '2026-09-10']);
  assert.deepEqual(result.days.map(day => day.elapsedMs), [12 * HOUR, 24 * HOUR, 12 * HOUR]);
  assert.deepEqual(result.days.map(day => day.usageWh), [12_000, 24_000, 12_000]);
  closeTo(result.days.reduce((sum, day) => sum + day.usageWh, 0), result.totalUsageWh);
});

test('month end, year end, and leap day boundaries use the meter calendar', () => {
  const yearEnd = splitUsageIntervalByLocalDate(
    createMeterReadingPoint('10', at('2026-12-31T12:00:00+09:00')),
    createMeterReadingPoint('34', at('2027-01-01T12:00:00+09:00')),
    'Asia/Seoul',
  );
  assert.deepEqual(yearEnd.days.map(day => day.localDate), ['2026-12-31', '2027-01-01']);

  const leap = splitUsageIntervalByLocalDate(
    createMeterReadingPoint('50', at('2028-02-28T12:00:00+09:00')),
    createMeterReadingPoint('98', at('2028-03-01T12:00:00+09:00')),
    'Asia/Seoul',
  );
  assert.deepEqual(leap.days.map(day => day.localDate), ['2028-02-28', '2028-02-29', '2028-03-01']);
  assert.deepEqual(leap.days.map(day => day.elapsedMs), [12 * HOUR, 24 * HOUR, 12 * HOUR]);
});

test('an actual reading exactly on midnight is not replaced by an interpolated point', () => {
  const result = splitUsageIntervalByLocalDate(
    createMeterReadingPoint('100', at('2026-09-08T22:00:00+09:00')),
    createMeterReadingPoint('102', at('2026-09-09T00:00:00+09:00')),
    'Asia/Seoul',
  );

  assert.equal(result.points.length, 2);
  assert.deepEqual(result.points.map(point => point.provenance), ['actual', 'actual']);
  assert.equal(result.points[1].localDate, '2026-09-09');
  assert.equal(result.days[0].localDate, '2026-09-08');
});

test('DST day length is derived from the explicit meter timezone instead of assuming 24 hours', () => {
  const result = splitUsageIntervalByLocalDate(
    createMeterReadingPoint('0', at('2026-03-07T12:00:00-05:00')),
    createMeterReadingPoint('47', at('2026-03-09T12:00:00-04:00')),
    'America/New_York',
  );

  assert.deepEqual(result.days.map(day => day.localDate), ['2026-03-07', '2026-03-08', '2026-03-09']);
  assert.deepEqual(result.days.map(day => day.elapsedMs), [12 * HOUR, 23 * HOUR, 12 * HOUR]);
  assert.deepEqual(result.days.map(day => day.usageWh), [12_000, 23_000, 12_000]);
});

test('explicit meter timezone makes results independent of the process timezone', () => {
  const previous = createMeterReadingPoint('100', at('2026-09-08T22:00:00+09:00'));
  const current = createMeterReadingPoint('104', at('2026-09-09T02:00:00+09:00'));
  const before = process.env.TZ;

  try {
    process.env.TZ = 'UTC';
    const utcProcess = splitUsageIntervalByLocalDate(previous, current, 'Asia/Seoul');
    process.env.TZ = 'America/Los_Angeles';
    const laProcess = splitUsageIntervalByLocalDate(previous, current, 'Asia/Seoul');
    assert.deepEqual(laProcess, utcProcess);
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test('invalid meter timezone fails explicitly', () => {
  assert.throws(
    () => splitUsageIntervalByLocalDate(
      createMeterReadingPoint('1', at('2026-09-08T12:00:00Z')),
      createMeterReadingPoint('2', at('2026-09-08T13:00:00Z')),
      'Not/A_Timezone',
    ),
    expectCode('INVALID_TIME_ZONE'),
  );
});

test('fractional interpolation keeps provenance while preserving total energy within numeric tolerance', () => {
  const result = splitUsageIntervalByLocalDate(
    createMeterReadingPoint('100.001', at('2026-09-08T23:17:00+09:00')),
    createMeterReadingPoint('105.006', at('2026-09-10T02:41:00+09:00')),
    'Asia/Seoul',
  );

  assert.ok(result.points.some(point => point.provenance === 'interpolated' && !Number.isInteger(point.cumulativeWh)));
  closeTo(result.days.reduce((sum, day) => sum + day.usageWh, 0), 5_005, 1e-9);
  closeTo(result.days.reduce((sum, day) => sum + day.usageKwh, 0), 5.005, 1e-12);
});
