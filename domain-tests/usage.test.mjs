import assert from 'node:assert/strict';
import test from 'node:test';

import {
  UsageDomainError,
  calculateUsageInterval,
  createMeterReadingPoint,
  parseCumulativeKwhToWh,
} from '../.domain-test/domain/usage.js';

const at = value => Date.parse(value);
const expectCode = (code) => (error) => error instanceof UsageDomainError && error.code === code;

test('parses cumulative kWh exactly into integer Wh without floating-point subtraction', () => {
  assert.equal(parseCumulativeKwhToWh('0'), 0);
  assert.equal(parseCumulativeKwhToWh('0007'), 7_000);
  assert.equal(parseCumulativeKwhToWh('7127'), 7_127_000);
  assert.equal(parseCumulativeKwhToWh('7127.1'), 7_127_100);
  assert.equal(parseCumulativeKwhToWh('7127.01'), 7_127_010);
  assert.equal(parseCumulativeKwhToWh('7127.001'), 7_127_001);
  assert.equal(parseCumulativeKwhToWh('9007199254740.991'), Number.MAX_SAFE_INTEGER);
});

test('rejects invalid syntax, precision beyond 1 Wh, and unsafe range', () => {
  for (const value of ['', ' ', '+1', '-1', '.5', '5.', '1e3', '1,000', '1 000']) {
    assert.throws(() => parseCumulativeKwhToWh(value), expectCode('INVALID_READING_VALUE'), value);
  }
  assert.throws(() => parseCumulativeKwhToWh('1.0001'), expectCode('READING_PRECISION_EXCEEDED'));
  assert.throws(() => parseCumulativeKwhToWh('9007199254740.992'), expectCode('READING_OUT_OF_RANGE'));
  assert.throws(() => parseCumulativeKwhToWh('10000000000000'), expectCode('READING_OUT_OF_RANGE'));
});

test('creates reading points from an exact kWh string and absolute epoch-millisecond instant', () => {
  const reading = createMeterReadingPoint('7127.125', at('2026-09-08T12:00:00+09:00'));
  assert.deepEqual(reading, {
    cumulativeWh: 7_127_125,
    measuredAtMs: 1_788_836_400_000,
  });
  assert.throws(() => createMeterReadingPoint('1', Number.NaN), expectCode('INVALID_READING_POINT'));
  assert.throws(() => createMeterReadingPoint('1', 1.5), expectCode('INVALID_READING_POINT'));
});

test('calculates arbitrary-time interval usage, elapsed time, and average power', () => {
  const previous = createMeterReadingPoint('7127', at('2026-09-08T12:00:00+09:00'));
  const current = createMeterReadingPoint('7132', at('2026-09-08T18:30:00+09:00'));
  const result = calculateUsageInterval(previous, current);

  assert.equal(result.usageWh, 5_000);
  assert.equal(result.usageKwh, 5);
  assert.equal(result.elapsedMs, 6.5 * 3_600_000);
  assert.equal(result.elapsedHours, 6.5);
  assert.ok(Math.abs(result.averagePowerW - 769.2307692307693) < 1e-9);
});

test('allows the same cumulative value and returns zero energy and power', () => {
  const result = calculateUsageInterval(
    createMeterReadingPoint('7127.5', at('2026-09-08T12:00:00Z')),
    createMeterReadingPoint('7127.5', at('2026-09-08T13:00:00Z')),
  );
  assert.equal(result.usageWh, 0);
  assert.equal(result.averagePowerW, 0);
});

test('rejects a decreased cumulative value', () => {
  assert.throws(
    () => calculateUsageInterval(
      createMeterReadingPoint('7132', at('2026-09-08T12:00:00Z')),
      createMeterReadingPoint('7127', at('2026-09-08T13:00:00Z')),
    ),
    expectCode('READING_DECREASED'),
  );
});

test('rejects duplicate or reversed instants', () => {
  const reading = createMeterReadingPoint('7127', at('2026-09-08T12:00:00Z'));
  assert.throws(() => calculateUsageInterval(reading, { ...reading }), expectCode('NON_POSITIVE_INTERVAL'));
  assert.throws(
    () => calculateUsageInterval(
      createMeterReadingPoint('7127', at('2026-09-08T13:00:00Z')),
      createMeterReadingPoint('7128', at('2026-09-08T12:00:00Z')),
    ),
    expectCode('NON_POSITIVE_INTERVAL'),
  );
});

test('cross-midnight intervals use absolute instants and do not depend on calendar boundaries', () => {
  const result = calculateUsageInterval(
    createMeterReadingPoint('100.250', at('2026-12-31T23:30:00+09:00')),
    createMeterReadingPoint('101.750', at('2027-01-01T01:00:00+09:00')),
  );
  assert.equal(result.usageWh, 1_500);
  assert.equal(result.elapsedHours, 1.5);
  assert.equal(result.averagePowerW, 1_000);
});

test('calculation is independent of process timezone because the domain accepts absolute instants', () => {
  const previous = createMeterReadingPoint('10', at('2026-09-08T03:00:00Z'));
  const current = createMeterReadingPoint('11', at('2026-09-08T04:00:00Z'));
  const before = process.env.TZ;

  try {
    process.env.TZ = 'UTC';
    const utc = calculateUsageInterval(previous, current);
    process.env.TZ = 'Asia/Seoul';
    const seoul = calculateUsageInterval(previous, current);
    assert.deepEqual(seoul, utc);
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});
