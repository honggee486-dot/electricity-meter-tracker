import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CounterError,
  calculateCounterInterval,
  parseCumulativeCounter,
  validateCounterPoint,
  validateRecentWindowDays,
} from '../.domain-test/domain/counter.js';

const at = value => Date.parse(value);
const expectCode = (code) => (error) => error instanceof CounterError && error.code === code;

test('parses decimal base-unit strings into exact integer milli-units', () => {
  assert.deepEqual(parseCumulativeCounter('0', 1000), { cumulativeMilliunit: 0, measuredAtMs: 1000 });
  assert.deepEqual(parseCumulativeCounter('0007', 1000), { cumulativeMilliunit: 7_000, measuredAtMs: 1000 });
  assert.deepEqual(parseCumulativeCounter('12.345', 1000), { cumulativeMilliunit: 12_345, measuredAtMs: 1000 });
  assert.deepEqual(parseCumulativeCounter('12.3', 1000), { cumulativeMilliunit: 12_300, measuredAtMs: 1000 });
  assert.deepEqual(
    parseCumulativeCounter('9007199254740.991', 1000),
    { cumulativeMilliunit: Number.MAX_SAFE_INTEGER, measuredAtMs: 1000 },
  );
});

test('rejects malformed, over-precise and out-of-range counter strings', () => {
  for (const value of ['', ' ', 'abc', '-1', '1e3', '12..3', '.', '12.', '+12', '12,3']) {
    assert.throws(() => parseCumulativeCounter(value, 1000), expectCode('INVALID_COUNTER_VALUE'), value);
  }
  assert.throws(() => parseCumulativeCounter('12.3456', 1000), expectCode('COUNTER_PRECISION_EXCEEDED'));
  assert.throws(() => parseCumulativeCounter('9007199254740.992', 1000), expectCode('COUNTER_OUT_OF_RANGE'));
  assert.throws(() => parseCumulativeCounter('10000000000000', 1000), expectCode('COUNTER_OUT_OF_RANGE'));
});

test('rejects instants outside the epoch-millisecond contract', () => {
  assert.throws(() => parseCumulativeCounter('1', Number.NaN), expectCode('INVALID_COUNTER_POINT'));
  assert.throws(() => parseCumulativeCounter('1', 1.5), expectCode('INVALID_COUNTER_POINT'));
  assert.throws(() => parseCumulativeCounter('1', 8_640_000_000_000_001), expectCode('INVALID_COUNTER_POINT'));
  assert.throws(
    () => validateCounterPoint({ cumulativeMilliunit: 1, measuredAtMs: 8_640_000_000_000_001 }),
    expectCode('INVALID_COUNTER_POINT'),
  );
});

test('counter interval keeps the delta and elapsed time separately without unit semantics', () => {
  const interval = calculateCounterInterval(
    { cumulativeMilliunit: 7_126_000, measuredAtMs: at('2026-09-08T12:00:00Z') },
    { cumulativeMilliunit: 7_127_000, measuredAtMs: at('2026-09-08T18:30:00Z') },
  );
  assert.equal(interval.cumulativeMilliunitDelta, 1_000);
  assert.equal(interval.elapsedMs, 6.5 * 3_600_000);
});

test('counter interval allows equal counters but rejects decreases and non-positive intervals', () => {
  const previous = { cumulativeMilliunit: 100_000, measuredAtMs: 1000 };
  assert.deepEqual(
    calculateCounterInterval(previous, { cumulativeMilliunit: 100_000, measuredAtMs: 2000 }),
    { cumulativeMilliunitDelta: 0, elapsedMs: 1000 },
  );
  assert.throws(
    () => calculateCounterInterval(
      { cumulativeMilliunit: 100_001, measuredAtMs: 1000 },
      { cumulativeMilliunit: 100_000, measuredAtMs: 2000 },
    ),
    expectCode('COUNTER_DECREASED'),
  );
  assert.throws(
    () => calculateCounterInterval(previous, { cumulativeMilliunit: 100_000, measuredAtMs: 1000 }),
    expectCode('NON_POSITIVE_INTERVAL'),
  );
});

test('counter points must be non-negative safe integers with valid instants', () => {
  assert.throws(
    () => calculateCounterInterval(
      { cumulativeMilliunit: -1, measuredAtMs: 1000 },
      { cumulativeMilliunit: 100, measuredAtMs: 2000 },
    ),
    expectCode('INVALID_COUNTER_POINT'),
  );
  assert.throws(
    () => calculateCounterInterval(
      { cumulativeMilliunit: 0.5, measuredAtMs: 1000 },
      { cumulativeMilliunit: 100, measuredAtMs: 2000 },
    ),
    expectCode('INVALID_COUNTER_POINT'),
  );
  assert.throws(
    () => calculateCounterInterval(
      { cumulativeMilliunit: Number.MAX_SAFE_INTEGER + 1, measuredAtMs: 1000 },
      { cumulativeMilliunit: 100, measuredAtMs: 2000 },
    ),
    expectCode('INVALID_COUNTER_POINT'),
  );
});

test('recent-day window must be a positive integer number of days', () => {
  for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => validateRecentWindowDays(invalid), expectCode('INVALID_FORECAST_WINDOW'), String(invalid));
  }
  validateRecentWindowDays(1);
  validateRecentWindowDays(30);
});
