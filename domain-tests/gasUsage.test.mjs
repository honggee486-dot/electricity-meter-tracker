import assert from 'node:assert/strict';
import test from 'node:test';

import { CounterError } from '../.domain-test/domain/counter.js';
import {
  calculateGasUsageForecast,
  calculateGasUsageInterval,
} from '../.domain-test/domain/gasUsage.js';

const at = value => Date.parse(value);
const day = value => ({ kind: 'day', day: value });
const HOUR = 3_600_000;
const closeTo = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

// Gas raw readings are cumulative m³ with at most three fraction digits; a
// point stores 1/1000 m³. Mirrors of the electricity forecast cases reuse the
// same numeric sequences so neutral scalars can be compared field by field.
const gasPoint = (m3, measuredAtMs) => ({ measuredAtMs, cumulativeMilliunit: Math.round(m3 * 1_000) });

function linearDailyReadings(startIso, startM3, days, dailyM3) {
  const startMs = at(startIso);
  return Array.from({ length: days + 1 }, (_, index) =>
    gasPoint(startM3 + index * dailyM3, startMs + index * 24 * HOUR));
}

test('gas interval reports m³, elapsed time and m³/h without power units', () => {
  const interval = calculateGasUsageInterval(
    gasPoint(100, at('2026-09-08T12:00:00Z')),
    gasPoint(100.5, at('2026-09-08T12:30:00Z')),
  );
  assert.equal(interval.usageM3, 0.5);
  assert.equal(interval.elapsedMs, 30 * 60_000);
  assert.equal(interval.elapsedHours, 0.5);
  assert.equal(interval.averageM3PerHour, 1);
});

test('equal gas counters are allowed with zero usage while decreases are rejected', () => {
  const previous = gasPoint(12.345, 1000);
  const equal = calculateGasUsageInterval(previous, gasPoint(12.345, 2000));
  assert.equal(equal.usageM3, 0);
  assert.equal(equal.averageM3PerHour, 0);

  assert.throws(
    () => calculateGasUsageInterval(gasPoint(12.346, 1000), gasPoint(12.345, 2000)),
    error => error instanceof CounterError && error.code === 'COUNTER_DECREASED',
  );
  assert.throws(
    () => calculateGasUsageInterval(previous, gasPoint(12.345, 1000)),
    error => error instanceof CounterError && error.code === 'NON_POSITIVE_INTERVAL',
  );
});

test('gas forecast mirrors the neutral cycle scalars as m³ with provenance intact', () => {
  const readings = linearDailyReadings('2026-08-22T00:00:00+09:00', 100, 17, 24);
  const result = calculateGasUsageForecast(readings, day(21), 'Asia/Seoul', 7);

  assert.equal(result.latestReading?.cumulativeMilliunit, 508_000);
  assert.equal(result.latestInterval?.usageM3, 24);
  assert.equal(result.latestInterval?.averageM3PerHour, 1);
  assert.equal(result.recentDailyAverage?.usageM3PerDay, 24);
  assert.equal(result.recentDailyAverage?.daysUsed, 7);
  assert.equal(result.currentCycle?.usageToDateM3, 408);
  assert.equal(result.currentCycle?.averageDailyUsageM3, 24);
  assert.equal(result.currentCycle?.projectedCloseUsageM3, 744);
  assert.equal(result.currentCycle?.normalized30DayUsageM3, 720);
  closeTo(result.confidence?.observationCoverageRatio ?? -1, 17 / 31);
  assert.equal(result.confidence?.forecastAvailable, true);
});

test('recent gas surge does not overwrite the cycle-average pace', () => {
  const start = at('2026-08-22T00:00:00+09:00');
  const cumulative = [100, 110, 120, 130, 160];
  const readings = cumulative.map((value, index) => gasPoint(value, start + index * 24 * HOUR));
  const result = calculateGasUsageForecast(readings, day(21), 'Asia/Seoul', 3);

  assert.equal(result.latestInterval?.usageM3, 30);
  closeTo(result.recentDailyAverage?.usageM3PerDay ?? -1, 50 / 3);
  assert.equal(result.currentCycle?.averageDailyUsageM3, 15);
});

test('missing cycle-start evidence suppresses the gas cycle forecast without fabricated values', () => {
  const readings = linearDailyReadings('2026-09-01T12:00:00+09:00', 100, 2, 24);
  const result = calculateGasUsageForecast(readings, day(21), 'Asia/Seoul', 7);

  assert.equal(result.currentCycle?.startBoundary, null);
  assert.equal(result.currentCycle?.usageToDateM3, null);
  assert.equal(result.currentCycle?.projectedCloseUsageM3, null);
  assert.equal(result.confidence?.forecastAvailable, false);
});

test('a gas reading exactly at the cycle start keeps zero usage apart from a null forecast', () => {
  const result = calculateGasUsageForecast(
    [gasPoint(100, at('2026-08-22T00:00:00+09:00'))],
    day(21),
    'Asia/Seoul',
    7,
  );

  assert.equal(result.currentCycle?.startBoundary?.provenance, 'actual');
  assert.equal(result.currentCycle?.observedMs, 0);
  assert.equal(result.currentCycle?.usageToDateM3, 0);
  assert.equal(result.currentCycle?.averageDailyUsageM3, null);
  assert.equal(result.currentCycle?.projectedCloseUsageM3, null);
  assert.equal(result.currentCycle?.normalized30DayUsageM3, null);
  assert.equal(result.confidence?.observationCoverageRatio, 0);
  assert.equal(result.confidence?.forecastAvailable, false);
});

test('previous completed gas cycle can be compared with the current projected close usage', () => {
  const readings = [
    gasPoint(100, at('2026-07-22T00:00:00+09:00')),
    gasPoint(700, at('2026-08-22T00:00:00+09:00')),
    gasPoint(1108, at('2026-09-08T00:00:00+09:00')),
  ];
  const result = calculateGasUsageForecast([...readings].reverse(), day(21), 'Asia/Seoul', 7);

  assert.equal(result.previousCycle?.usageM3, 600);
  assert.equal(result.currentCycle?.projectedCloseUsageM3, 744);
  assert.equal(result.comparison?.projectedVsPreviousDeltaM3, 144);
  assert.equal(result.comparison?.projectedVsPreviousPercent, 24);
  assert.equal(result.confidence?.previousCycleAvailable, true);
});

test('gas daily averages use only fully covered local calendar days across a month-end boundary', () => {
  const readings = [
    gasPoint(100, at('2026-09-01T12:00:00+09:00')),
    gasPoint(124, at('2026-09-02T12:00:00+09:00')),
    gasPoint(148, at('2026-09-03T12:00:00+09:00')),
    gasPoint(166, at('2026-09-04T06:00:00+09:00')),
  ];
  const result = calculateGasUsageForecast(readings, { kind: 'month-end' }, 'Asia/Seoul', 7);

  assert.deepEqual(result.recentDailyAverage?.localDates, ['2026-09-02', '2026-09-03']);
  assert.equal(result.recentDailyAverage?.daysUsed, 2);
  assert.equal(result.recentDailyAverage?.usageM3PerDay, 24);
});

test('gas daily splitting survives a DST transition without losing or inventing usage', () => {
  // The 2026-03-08 local day in America/New_York lasts 23 real hours because
  // clocks spring forward, and it must still count as one fully covered day.
  const result = calculateGasUsageForecast(
    [
      gasPoint(100, at('2026-03-08T00:00:00-05:00')),
      gasPoint(148, at('2026-03-09T00:00:00-04:00')),
    ],
    { kind: 'month-end' },
    'America/New_York',
    7,
  );

  assert.deepEqual(result.recentDailyAverage?.localDates, ['2026-03-08']);
  assert.equal(result.recentDailyAverage?.daysUsed, 1);
  assert.equal(result.recentDailyAverage?.usageM3PerDay, 48);
  assert.equal(result.latestInterval?.elapsedMs, 23 * HOUR);
  assert.equal(result.confidence?.forecastAvailable, false);
});

test('gas forecast rejects decreases and invalid windows through the neutral error contract', () => {
  assert.throws(
    () => calculateGasUsageForecast(
      [
        gasPoint(200, at('2026-09-01T00:00:00+09:00')),
        gasPoint(100, at('2026-09-02T00:00:00+09:00')),
      ],
      day(21),
      'Asia/Seoul',
      7,
    ),
    error => error instanceof CounterError && error.code === 'COUNTER_DECREASED',
  );
  assert.throws(
    () => calculateGasUsageForecast([], day(21), 'Asia/Seoul', 0),
    error => error instanceof CounterError && error.code === 'INVALID_FORECAST_WINDOW',
  );
  const empty = calculateGasUsageForecast([], day(21), 'Asia/Seoul', 7);
  assert.equal(empty.latestReading, null);
  assert.equal(empty.currentCycle, null);
  assert.equal(empty.confidence, null);
});
