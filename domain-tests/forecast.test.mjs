import assert from 'node:assert/strict';
import test from 'node:test';

import { createMeterReadingPoint, UsageDomainError } from '../.domain-test/domain/usage.js';
import { calculateUsageForecast } from '../.domain-test/domain/forecast.js';

const at = value => Date.parse(value);
const day = value => ({ kind: 'day', day: value });
const HOUR = 3_600_000;
const closeTo = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

function linearDailyReadings(startIso, startKwh, days, dailyKwh) {
  const startMs = at(startIso);
  return Array.from({ length: days + 1 }, (_, index) =>
    createMeterReadingPoint(String(startKwh + index * dailyKwh), startMs + index * 24 * HOUR));
}

test('cycle-average forecast keeps latest interval, recent daily average, close forecast, and 30-day normalization separate', () => {
  const readings = linearDailyReadings('2026-08-22T00:00:00+09:00', 100, 17, 24);
  const result = calculateUsageForecast(readings, day(21), 'Asia/Seoul', 7);

  assert.equal(result.latestInterval?.usageKwh, 24);
  assert.equal(result.latestInterval?.averagePowerW, 1_000);
  assert.equal(result.recentDailyAverage?.usageKwhPerDay, 24);
  assert.equal(result.recentDailyAverage?.daysUsed, 7);
  assert.equal(result.currentCycle?.usageToDateKwh, 408);
  assert.equal(result.currentCycle?.averageDailyUsageKwh, 24);
  assert.equal(result.currentCycle?.projectedCloseUsageKwh, 744);
  assert.equal(result.currentCycle?.normalized30DayUsageKwh, 720);
  closeTo(result.confidence?.observationCoverageRatio ?? -1, 17 / 31);
  assert.equal(result.confidence?.forecastAvailable, true);
});

test('recent surge does not overwrite latest-interval or cycle-average pace', () => {
  const start = at('2026-08-22T00:00:00+09:00');
  const cumulative = [100, 110, 120, 130, 160];
  const readings = cumulative.map((value, index) => createMeterReadingPoint(String(value), start + index * 24 * HOUR));
  const result = calculateUsageForecast(readings, day(21), 'Asia/Seoul', 3);

  assert.equal(result.latestInterval?.usageKwh, 30);
  closeTo(result.recentDailyAverage?.usageKwhPerDay ?? -1, 50 / 3);
  assert.equal(result.currentCycle?.averageDailyUsageKwh, 15);
});

test('missing cycle-start evidence suppresses cycle forecast while independent evidence remains available', () => {
  const readings = linearDailyReadings('2026-09-01T12:00:00+09:00', 100, 2, 24);
  const result = calculateUsageForecast(readings, day(21), 'Asia/Seoul', 7);

  assert.equal(result.latestInterval?.usageKwh, 24);
  assert.equal(result.recentDailyAverage?.usageKwhPerDay, 24);
  assert.equal(result.currentCycle?.startBoundary, null);
  assert.equal(result.currentCycle?.usageToDateKwh, null);
  assert.equal(result.currentCycle?.projectedCloseUsageKwh, null);
  assert.equal(result.confidence?.forecastAvailable, false);
});

test('cycle start itself has known zero usage but no average or forecast', () => {
  const readings = [createMeterReadingPoint('100', at('2026-08-22T00:00:00+09:00'))];
  const result = calculateUsageForecast(readings, day(21), 'Asia/Seoul', 7);

  assert.equal(result.currentCycle?.startBoundary?.provenance, 'actual');
  assert.equal(result.currentCycle?.observedMs, 0);
  assert.equal(result.currentCycle?.usageToDateWh, 0);
  assert.equal(result.currentCycle?.usageToDateKwh, 0);
  assert.equal(result.currentCycle?.averagePowerW, null);
  assert.equal(result.currentCycle?.averageDailyUsageKwh, null);
  assert.equal(result.currentCycle?.projectedCloseUsageKwh, null);
  assert.equal(result.currentCycle?.normalized30DayUsageKwh, null);
  assert.equal(result.confidence?.observationCoverageRatio, 0);
  assert.equal(result.confidence?.forecastAvailable, false);
});

test('a reading closing the previous month starts the next cycle with known zero usage', () => {
  const readings = [
    createMeterReadingPoint('100', at('2026-08-01T00:00:00+09:00')),
    createMeterReadingPoint('200', at('2026-09-01T00:00:00+09:00')),
  ];
  const result = calculateUsageForecast(readings, { kind: 'month-end' }, 'Asia/Seoul', 7);

  assert.equal(result.previousCycle?.usageWh, 100_000);
  assert.equal(result.latestInterval?.usageWh, 100_000);
  assert.equal(result.currentCycle?.startBoundary?.provenance, 'actual');
  assert.equal(result.currentCycle?.usageToDateWh, 0);
  assert.equal(result.currentCycle?.usageToDateKwh, 0);
  assert.equal(result.currentCycle?.projectedCloseUsageWh, null);
  assert.equal(result.confidence?.forecastAvailable, false);
  assert.equal(result.comparison, null);
});

test('interpolated cycle start is preserved as confidence evidence', () => {
  const readings = [
    createMeterReadingPoint('100', at('2026-08-21T23:00:00+09:00')),
    createMeterReadingPoint('102', at('2026-08-22T01:00:00+09:00')),
    createMeterReadingPoint('125', at('2026-08-23T00:00:00+09:00')),
  ];
  const result = calculateUsageForecast(readings, day(21), 'Asia/Seoul', 7);

  assert.equal(result.currentCycle?.startBoundary?.cumulativeWh, 101_000);
  assert.equal(result.confidence?.startBoundaryProvenance, 'interpolated');
  assert.equal(result.currentCycle?.usageToDateKwh, 24);
  assert.equal(result.currentCycle?.projectedCloseUsageKwh, 744);
});

test('previous completed cycle can be compared with current projected close usage', () => {
  const readings = [
    createMeterReadingPoint('100', at('2026-07-22T00:00:00+09:00')),
    createMeterReadingPoint('700', at('2026-08-22T00:00:00+09:00')),
    createMeterReadingPoint('1108', at('2026-09-08T00:00:00+09:00')),
  ];
  const result = calculateUsageForecast([...readings].reverse(), day(21), 'Asia/Seoul', 7);

  assert.equal(result.previousCycle?.usageKwh, 600);
  assert.equal(result.currentCycle?.projectedCloseUsageKwh, 744);
  assert.equal(result.comparison?.projectedVsPreviousDeltaKwh, 144);
  assert.equal(result.comparison?.projectedVsPreviousPercent, 24);
  assert.equal(result.confidence?.previousCycleAvailable, true);
});

test('forecast remains stable near the final cycle day and reports the real remaining duration', () => {
  const startMs = at('2026-08-22T00:00:00+09:00');
  const latestMs = at('2026-09-21T12:00:00+09:00');
  const elapsedHours = (latestMs - startMs) / HOUR;
  const readings = [
    createMeterReadingPoint('100', startMs),
    createMeterReadingPoint(String(100 + elapsedHours), latestMs),
  ];
  const result = calculateUsageForecast(readings, day(21), 'Asia/Seoul', 7);

  assert.equal(result.currentCycle?.remainingMs, 12 * HOUR);
  assert.equal(result.currentCycle?.projectedCloseUsageKwh, 744);
});

test('recent daily average uses only fully covered local calendar days', () => {
  const readings = [
    createMeterReadingPoint('100', at('2026-09-01T12:00:00+09:00')),
    createMeterReadingPoint('124', at('2026-09-02T12:00:00+09:00')),
    createMeterReadingPoint('148', at('2026-09-03T12:00:00+09:00')),
    createMeterReadingPoint('166', at('2026-09-04T06:00:00+09:00')),
  ];
  const result = calculateUsageForecast(readings, { kind: 'month-end' }, 'Asia/Seoul', 7);

  assert.deepEqual(result.recentDailyAverage?.localDates, ['2026-09-02', '2026-09-03']);
  assert.equal(result.recentDailyAverage?.daysUsed, 2);
  assert.equal(result.recentDailyAverage?.usageKwhPerDay, 24);
});

test('short latest interval is exposed as evidence but does not become the cycle forecast pace', () => {
  const startMs = at('2026-08-22T00:00:00+09:00');
  const beforeLatestMs = at('2026-09-08T11:30:00+09:00');
  const latestMs = at('2026-09-08T12:00:00+09:00');
  const steadyUsageBeforeWh = (beforeLatestMs - startMs) / HOUR * 1_000;
  const readings = [
    createMeterReadingPoint('100', startMs),
    createMeterReadingPoint(String(100 + steadyUsageBeforeWh / 1_000), beforeLatestMs),
    createMeterReadingPoint(String(100 + steadyUsageBeforeWh / 1_000 + 5), latestMs),
  ];
  const result = calculateUsageForecast(readings, day(21), 'Asia/Seoul', 7);

  assert.equal(result.latestInterval?.elapsedMs, 30 * 60_000);
  assert.equal(result.latestInterval?.usageKwh, 5);
  assert.equal(result.confidence?.latestIntervalElapsedMs, 30 * 60_000);
  assert.ok((result.currentCycle?.averageDailyUsageKwh ?? 0) < 30);
});

test('invalid recent-day window fails explicitly and empty readings remain insufficient without fabricated values', () => {
  assert.throws(
    () => calculateUsageForecast([], day(21), 'Asia/Seoul', 0),
    error => error instanceof UsageDomainError && error.code === 'INVALID_FORECAST_WINDOW',
  );
  const empty = calculateUsageForecast([], day(21), 'Asia/Seoul', 7);
  assert.equal(empty.latestReading, null);
  assert.equal(empty.currentCycle, null);
  assert.equal(empty.confidence, null);
});
