import assert from 'node:assert/strict';
import test from 'node:test';

import {
  UsageDomainError,
  createMeterReadingPoint,
} from '../.domain-test/domain/usage.js';
import {
  calculateBillingCycleUsage,
  getBillingCycleContext,
  getBillingCycleForCloseMonth,
  resolveBillingBoundaryReading,
  resolveEffectiveBillingCloseDate,
} from '../.domain-test/domain/billingCycle.js';

const at = value => Date.parse(value);
const HOUR = 3_600_000;
const expectCode = code => error => error instanceof UsageDomainError && error.code === code;

const day = value => ({ kind: 'day', day: value });
const monthEnd = { kind: 'month-end' };

test('fixed close days fall back to the month end only when the configured day does not exist', () => {
  assert.equal(resolveEffectiveBillingCloseDate(2026, 9, day(21)).localDate, '2026-09-21');
  assert.equal(resolveEffectiveBillingCloseDate(2026, 2, day(30)).localDate, '2026-02-28');
  assert.equal(resolveEffectiveBillingCloseDate(2028, 2, day(30)).localDate, '2028-02-29');
  assert.equal(resolveEffectiveBillingCloseDate(2026, 4, day(31)).localDate, '2026-04-30');
  assert.equal(resolveEffectiveBillingCloseDate(2026, 5, day(31)).localDate, '2026-05-31');
});

test('month-end is a distinct setting and always resolves to the actual last day of that month', () => {
  assert.equal(resolveEffectiveBillingCloseDate(2026, 1, monthEnd).localDate, '2026-01-31');
  assert.equal(resolveEffectiveBillingCloseDate(2026, 2, monthEnd).localDate, '2026-02-28');
  assert.equal(resolveEffectiveBillingCloseDate(2028, 2, monthEnd).localDate, '2028-02-29');
  assert.equal(resolveEffectiveBillingCloseDate(2026, 4, monthEnd).localDate, '2026-04-30');
});

test('invalid fixed close days fail explicitly', () => {
  assert.throws(() => resolveEffectiveBillingCloseDate(2026, 9, day(0)), expectCode('INVALID_BILLING_CLOSE_SETTING'));
  assert.throws(() => resolveEffectiveBillingCloseDate(2026, 9, day(32)), expectCode('INVALID_BILLING_CLOSE_SETTING'));
  assert.throws(() => resolveEffectiveBillingCloseDate(2026, 9, day(1.5)), expectCode('INVALID_BILLING_CLOSE_SETTING'));
});

test('21-day close produces the half-open cycle Aug 22 00:00 through Sep 22 00:00 in meter timezone', () => {
  const cycle = getBillingCycleForCloseMonth(2026, 9, day(21), 'Asia/Seoul');
  assert.equal(cycle.displayStartLocalDate, '2026-08-22');
  assert.equal(cycle.displayEndLocalDate, '2026-09-21');
  assert.equal(cycle.startMs, at('2026-08-22T00:00:00+09:00'));
  assert.equal(cycle.endMs, at('2026-09-22T00:00:00+09:00'));
});

test('30-day fallback keeps consecutive cycle boundaries when February has no day 30', () => {
  const february = getBillingCycleForCloseMonth(2026, 2, day(30), 'Asia/Seoul');
  assert.equal(february.displayStartLocalDate, '2026-01-31');
  assert.equal(february.displayEndLocalDate, '2026-02-28');
  assert.equal(february.startMs, at('2026-01-31T00:00:00+09:00'));
  assert.equal(february.endMs, at('2026-03-01T00:00:00+09:00'));

  const march = getBillingCycleForCloseMonth(2026, 3, day(30), 'Asia/Seoul');
  assert.equal(march.startMs, february.endMs);
  assert.equal(march.displayStartLocalDate, '2026-03-01');
  assert.equal(march.displayEndLocalDate, '2026-03-30');
});

test('month-end setting produces calendar-month cycles', () => {
  const cycle = getBillingCycleForCloseMonth(2026, 9, monthEnd, 'Asia/Seoul');
  assert.equal(cycle.displayStartLocalDate, '2026-09-01');
  assert.equal(cycle.displayEndLocalDate, '2026-09-30');
  assert.equal(cycle.startMs, at('2026-09-01T00:00:00+09:00'));
  assert.equal(cycle.endMs, at('2026-10-01T00:00:00+09:00'));
});

test('billing cycle context selects previous/current/next cycle and remaining duration from the current instant', () => {
  const beforeClose = getBillingCycleContext(at('2026-09-21T12:00:00+09:00'), day(21), 'Asia/Seoul');
  assert.equal(beforeClose.current.displayStartLocalDate, '2026-08-22');
  assert.equal(beforeClose.current.displayEndLocalDate, '2026-09-21');
  assert.equal(beforeClose.previous.displayEndLocalDate, '2026-08-21');
  assert.equal(beforeClose.next.displayEndLocalDate, '2026-10-21');
  assert.equal(beforeClose.remainingHours, 12);

  const afterClose = getBillingCycleContext(at('2026-09-22T00:00:00+09:00'), day(21), 'Asia/Seoul');
  assert.equal(afterClose.current.displayStartLocalDate, '2026-09-22');
  assert.equal(afterClose.current.displayEndLocalDate, '2026-10-21');
});

test('cycle boundaries are timezone-aware and do not assume every day is 24 hours', () => {
  const cycle = getBillingCycleForCloseMonth(2026, 3, monthEnd, 'America/New_York');
  assert.equal(cycle.startMs, at('2026-03-01T00:00:00-05:00'));
  assert.equal(cycle.endMs, at('2026-04-01T00:00:00-04:00'));
  assert.equal((cycle.endMs - cycle.startMs) / HOUR, 31 * 24 - 1);
});

test('exact boundary reading wins over interpolation and can replace an earlier estimate', () => {
  const boundaryMs = at('2026-09-22T00:00:00+09:00');
  const surrounding = [
    createMeterReadingPoint('100', at('2026-09-21T23:00:00+09:00')),
    createMeterReadingPoint('102', at('2026-09-22T01:00:00+09:00')),
  ];
  const interpolated = resolveBillingBoundaryReading(surrounding, boundaryMs);
  assert.deepEqual(interpolated, {
    measuredAtMs: boundaryMs,
    cumulativeWh: 101_000,
    provenance: 'interpolated',
  });

  const actual = resolveBillingBoundaryReading([
    ...surrounding,
    createMeterReadingPoint('101.250', boundaryMs),
  ], boundaryMs);
  assert.deepEqual(actual, {
    measuredAtMs: boundaryMs,
    cumulativeWh: 101_250,
    provenance: 'actual',
  });
});

test('cycle usage uses resolved boundary values and does not fabricate a value when a boundary cannot be resolved', () => {
  const cycle = getBillingCycleForCloseMonth(2026, 9, day(21), 'Asia/Seoul');
  const readings = [
    createMeterReadingPoint('100', at('2026-08-21T23:00:00+09:00')),
    createMeterReadingPoint('102', at('2026-08-22T01:00:00+09:00')),
    createMeterReadingPoint('150', at('2026-09-21T23:00:00+09:00')),
    createMeterReadingPoint('152', at('2026-09-22T01:00:00+09:00')),
  ];
  const result = calculateBillingCycleUsage(readings, cycle);
  assert.equal(result.start?.provenance, 'interpolated');
  assert.equal(result.end?.provenance, 'interpolated');
  assert.equal(result.usageWh, 50_000);
  assert.equal(result.usageKwh, 50);

  const insufficient = calculateBillingCycleUsage(readings.slice(0, 2), cycle);
  assert.equal(insufficient.start?.provenance, 'interpolated');
  assert.equal(insufficient.end, null);
  assert.equal(insufficient.usageWh, null);
  assert.equal(insufficient.usageKwh, null);
});
