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
  CounterError,
  calculateCounterInterval,
  type CounterPoint,
} from './counter.js';
import {
  toCounterPoint,
  toUsageDomainError,
  UsageDomainError,
  type MeterReadingPoint,
} from './usage.js';

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

export interface CounterBoundaryReading {
  measuredAtMs: number;
  cumulativeMilliunit: number;
  provenance: 'actual' | 'interpolated';
}

export interface CounterBillingCycleUsage {
  start: CounterBoundaryReading | null;
  end: CounterBoundaryReading | null;
  usageMilliunit: number | null;
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

// Unit-neutral boundary resolution: the reading bracketing a cycle boundary is
// used as-is when exact, otherwise linearly interpolated in counter milli-units.
export function resolveCounterBoundaryReading(
  readings: readonly CounterPoint[],
  boundaryMs: number,
): CounterBoundaryReading | null {
  const exact = readings.find(reading => reading.measuredAtMs === boundaryMs);
  if (exact) {
    return {
      measuredAtMs: boundaryMs,
      cumulativeMilliunit: exact.cumulativeMilliunit,
      provenance: 'actual',
    };
  }

  let before: CounterPoint | null = null;
  let after: CounterPoint | null = null;
  for (const reading of readings) {
    if (reading.measuredAtMs < boundaryMs && (before === null || reading.measuredAtMs > before.measuredAtMs)) {
      before = reading;
    } else if (reading.measuredAtMs > boundaryMs && (after === null || reading.measuredAtMs < after.measuredAtMs)) {
      after = reading;
    }
  }

  if (before === null || after === null) return null;
  const interval = calculateCounterInterval(before, after);
  const elapsedToBoundary = boundaryMs - before.measuredAtMs;
  const cumulativeMilliunit = before.cumulativeMilliunit + interval.cumulativeMilliunitDelta * elapsedToBoundary / interval.elapsedMs;
  return {
    measuredAtMs: boundaryMs,
    cumulativeMilliunit,
    provenance: 'interpolated',
  };
}

export function calculateCounterBillingCycleUsage(
  readings: readonly CounterPoint[],
  cycle: BillingCycle,
): CounterBillingCycleUsage {
  const start = resolveCounterBoundaryReading(readings, cycle.startMs);
  const end = resolveCounterBoundaryReading(readings, cycle.endMs);
  if (start === null || end === null) {
    return { start, end, usageMilliunit: null };
  }
  if (end.cumulativeMilliunit < start.cumulativeMilliunit) {
    throw new CounterError('COUNTER_DECREASED', 'The billing cycle end counter must not be lower than its start counter.');
  }
  return { start, end, usageMilliunit: end.cumulativeMilliunit - start.cumulativeMilliunit };
}

// --- electricity adapter -----------------------------------------------------

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

export function resolveBillingBoundaryReading(
  readings: readonly MeterReadingPoint[],
  boundaryMs: number,
): BillingBoundaryReading | null {
  const counterReadings = readings.map(toCounterPoint);
  const boundary = resolveCounterBoundaryReading(counterReadings, boundaryMs);
  return boundary === null ? null : electricityBoundary(boundary);
}

export function calculateBillingCycleUsage(
  readings: readonly MeterReadingPoint[],
  cycle: BillingCycle,
): BillingCycleUsage {
  try {
    const usage = calculateCounterBillingCycleUsage(readings.map(toCounterPoint), cycle);
    return {
      start: usage.start === null ? null : electricityBoundary(usage.start),
      end: usage.end === null ? null : electricityBoundary(usage.end),
      usageWh: usage.usageMilliunit,
      usageKwh: usage.usageMilliunit === null ? null : usage.usageMilliunit / WH_PER_KWH,
    };
  } catch (error) {
    throw toUsageDomainError(error);
  }
}

const WH_PER_KWH = 1_000;

function electricityBoundary(boundary: CounterBoundaryReading): BillingBoundaryReading {
  return {
    measuredAtMs: boundary.measuredAtMs,
    cumulativeWh: boundary.cumulativeMilliunit,
    provenance: boundary.provenance,
  };
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
