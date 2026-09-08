import {
  addLocalDays,
  addMonths,
  createLocalDateFormatter,
  daysInMonth,
  formatLocalDate,
  getLocalDateParts,
  getStartOfLocalDateMs,
  type LocalDateParts,
} from './calendar.js';
import {
  UsageDomainError,
  calculateUsageInterval,
  type MeterReadingPoint,
} from './usage.js';

const WH_PER_KWH = 1_000;
const MS_PER_HOUR = 3_600_000;

export type BillingCloseSetting =
  | { kind: 'day'; day: number }
  | { kind: 'month-end' };

export interface EffectiveBillingCloseDate extends LocalDateParts {
  localDate: string;
}

export interface BillingCycle {
  closeYear: number;
  closeMonth: number;
  startMs: number;
  endMs: number;
  displayStartLocalDate: string;
  displayEndLocalDate: string;
}

export interface BillingCycleContext {
  previous: BillingCycle;
  current: BillingCycle;
  next: BillingCycle;
  remainingMs: number;
  remainingHours: number;
}

export interface BillingBoundaryReading {
  measuredAtMs: number;
  cumulativeWh: number;
  provenance: 'actual' | 'interpolated';
}

export interface BillingCycleUsage {
  start: BillingBoundaryReading | null;
  end: BillingBoundaryReading | null;
  usageWh: number | null;
  usageKwh: number | null;
}

export function resolveEffectiveBillingCloseDate(
  year: number,
  month: number,
  setting: BillingCloseSetting,
): EffectiveBillingCloseDate {
  validateCloseSetting(setting);
  const monthLastDay = daysInMonth(year, month);
  const day = setting.kind === 'month-end' ? monthLastDay : Math.min(setting.day, monthLastDay);
  const date = { year, month, day };
  return { ...date, localDate: formatLocalDate(date) };
}

export function getBillingCycleForCloseMonth(
  closeYear: number,
  closeMonth: number,
  setting: BillingCloseSetting,
  timeZone: string,
): BillingCycle {
  const previousMonth = addMonths(closeYear, closeMonth, -1);
  const previousClose = resolveEffectiveBillingCloseDate(previousMonth.year, previousMonth.month, setting);
  const currentClose = resolveEffectiveBillingCloseDate(closeYear, closeMonth, setting);
  const displayStart = addLocalDays(previousClose, 1);
  const endBoundaryDate = addLocalDays(currentClose, 1);

  return {
    closeYear,
    closeMonth,
    startMs: getStartOfLocalDateMs(displayStart, timeZone),
    endMs: getStartOfLocalDateMs(endBoundaryDate, timeZone),
    displayStartLocalDate: formatLocalDate(displayStart),
    displayEndLocalDate: currentClose.localDate,
  };
}

export function getBillingCycleContext(
  measuredAtMs: number,
  setting: BillingCloseSetting,
  timeZone: string,
): BillingCycleContext {
  const formatter = createLocalDateFormatter(timeZone);
  const local = getLocalDateParts(formatter, measuredAtMs);
  let closeMonth = { year: local.year, month: local.month };
  let current = getBillingCycleForCloseMonth(closeMonth.year, closeMonth.month, setting, timeZone);

  if (measuredAtMs >= current.endMs) {
    closeMonth = addMonths(closeMonth.year, closeMonth.month, 1);
    current = getBillingCycleForCloseMonth(closeMonth.year, closeMonth.month, setting, timeZone);
  }

  const previousCloseMonth = addMonths(closeMonth.year, closeMonth.month, -1);
  const nextCloseMonth = addMonths(closeMonth.year, closeMonth.month, 1);
  const remainingMs = current.endMs - measuredAtMs;

  return {
    previous: getBillingCycleForCloseMonth(previousCloseMonth.year, previousCloseMonth.month, setting, timeZone),
    current,
    next: getBillingCycleForCloseMonth(nextCloseMonth.year, nextCloseMonth.month, setting, timeZone),
    remainingMs,
    remainingHours: remainingMs / MS_PER_HOUR,
  };
}

export function resolveBillingBoundaryReading(
  readings: readonly MeterReadingPoint[],
  boundaryMs: number,
): BillingBoundaryReading | null {
  const exact = readings.find(reading => reading.measuredAtMs === boundaryMs);
  if (exact) {
    return {
      measuredAtMs: boundaryMs,
      cumulativeWh: exact.cumulativeWh,
      provenance: 'actual',
    };
  }

  let before: MeterReadingPoint | null = null;
  let after: MeterReadingPoint | null = null;
  for (const reading of readings) {
    if (reading.measuredAtMs < boundaryMs && (before === null || reading.measuredAtMs > before.measuredAtMs)) {
      before = reading;
    } else if (reading.measuredAtMs > boundaryMs && (after === null || reading.measuredAtMs < after.measuredAtMs)) {
      after = reading;
    }
  }

  if (before === null || after === null) return null;
  const interval = calculateUsageInterval(before, after);
  const elapsedToBoundary = boundaryMs - before.measuredAtMs;
  const cumulativeWh = before.cumulativeWh + interval.usageWh * elapsedToBoundary / interval.elapsedMs;
  return {
    measuredAtMs: boundaryMs,
    cumulativeWh,
    provenance: 'interpolated',
  };
}

export function calculateBillingCycleUsage(
  readings: readonly MeterReadingPoint[],
  cycle: BillingCycle,
): BillingCycleUsage {
  const start = resolveBillingBoundaryReading(readings, cycle.startMs);
  const end = resolveBillingBoundaryReading(readings, cycle.endMs);
  if (start === null || end === null) {
    return { start, end, usageWh: null, usageKwh: null };
  }
  if (end.cumulativeWh < start.cumulativeWh) {
    throw new UsageDomainError('READING_DECREASED', 'Billing cycle end reading must not be lower than its start reading.');
  }
  const usageWh = end.cumulativeWh - start.cumulativeWh;
  return { start, end, usageWh, usageKwh: usageWh / WH_PER_KWH };
}

function validateCloseSetting(setting: BillingCloseSetting): void {
  if (setting.kind === 'month-end') return;
  if (setting.kind !== 'day' || !Number.isInteger(setting.day) || setting.day < 1 || setting.day > 31) {
    throw new UsageDomainError(
      'INVALID_BILLING_CLOSE_SETTING',
      'Billing close day must be an integer from 1 through 31, or month-end.',
    );
  }
}
