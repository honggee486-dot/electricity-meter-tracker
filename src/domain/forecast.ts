import {
  getBillingCycleContext,
  calculateCounterBillingCycleUsage,
  resolveCounterBoundaryReading,
  type BillingBoundaryReading,
  type BillingCloseSetting,
  type BillingCycle,
  type CounterBoundaryReading,
} from './billingCycle.js';
import {
  addLocalDays,
  createLocalDateFormatter,
  getStartOfLocalDateMs,
  type LocalDateParts,
} from './calendar.js';
import {
  calculateCounterInterval,
  validateRecentWindowDays,
  type CounterInterval,
  type CounterPoint,
} from './counter.js';
import { splitCounterIntervalByLocalDate } from './dailyUsage.js';
import {
  toCounterPoint,
  toUsageDomainError,
  UsageDomainError,
  type MeterReadingPoint,
  type UsageInterval,
} from './usage.js';

const WH_PER_KWH = 1_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_NORMALIZED_DAY = 24 * MS_PER_HOUR;

// --- unit-neutral forecast core ---------------------------------------------
// Every scalar is a counter delta in meter milli-units or a duration. The
// utility-specific conversions (kWh/W, m³/m³·h) live in the adapters below.

export interface CounterRecentDailyAverage {
  requestedDays: number;
  daysUsed: number;
  localDates: string[];
  usageMilliunitPerDay: number;
  includesInterpolated: boolean;
}

export interface CounterCurrentCycleForecast {
  cycle: BillingCycle;
  startBoundary: CounterBoundaryReading | null;
  usageToDateMilliunit: number | null;
  observedMs: number;
  remainingMs: number;
  averageDailyUsageMilliunit: number | null;
  projectedCloseUsageMilliunit: number | null;
  normalized30DayUsageMilliunit: number | null;
}

export interface CounterPreviousCycleSnapshot {
  cycle: BillingCycle;
  start: CounterBoundaryReading | null;
  end: CounterBoundaryReading | null;
  usageMilliunit: number | null;
}

export interface CounterForecastComparison {
  projectedVsPreviousDeltaMilliunit: number;
  projectedVsPreviousPercent: number | null;
}

export interface ForecastConfidenceEvidence {
  forecastAvailable: boolean;
  observedMs: number;
  cycleDurationMs: number;
  observationCoverageRatio: number;
  recentFullDaysUsed: number;
  requestedRecentDays: number;
  startBoundaryProvenance: 'actual' | 'interpolated' | null;
  latestIntervalElapsedMs: number | null;
  previousCycleAvailable: boolean;
}

export interface CounterForecastSnapshot {
  latestReading: CounterPoint | null;
  latestInterval: CounterInterval | null;
  recentDailyAverage: CounterRecentDailyAverage | null;
  currentCycle: CounterCurrentCycleForecast | null;
  previousCycle: CounterPreviousCycleSnapshot | null;
  comparison: CounterForecastComparison | null;
  confidence: ForecastConfidenceEvidence | null;
}

interface CounterDailyAggregate {
  localDate: string;
  startMs: number;
  endMs: number;
  usageMilliunit: number;
  includesInterpolated: boolean;
}

export function calculateCounterForecast(
  readings: readonly CounterPoint[],
  setting: BillingCloseSetting,
  timeZone: string,
  recentWindowDays: number,
): CounterForecastSnapshot {
  validateRecentWindowDays(recentWindowDays);
  createLocalDateFormatter(timeZone);

  if (readings.length === 0) {
    return {
      latestReading: null,
      latestInterval: null,
      recentDailyAverage: null,
      currentCycle: null,
      previousCycle: null,
      comparison: null,
      confidence: null,
    };
  }

  const sorted = [...readings].sort((left, right) => left.measuredAtMs - right.measuredAtMs);
  for (let index = 1; index < sorted.length; index += 1) {
    calculateCounterInterval(sorted[index - 1], sorted[index]);
  }

  const latestReading = sorted[sorted.length - 1];
  const latestInterval = sorted.length >= 2
    ? calculateCounterInterval(sorted[sorted.length - 2], latestReading)
    : null;
  const context = getBillingCycleContext(latestReading.measuredAtMs, setting, timeZone);
  const currentCycle = calculateCounterCurrentCycleForecast(sorted, latestReading, context.current);
  const recentDailyAverage = calculateCounterRecentDailyAverage(sorted, timeZone, recentWindowDays);
  const previousUsage = calculateCounterBillingCycleUsage(sorted, context.previous);
  const previousCycle: CounterPreviousCycleSnapshot = { cycle: context.previous, ...previousUsage };
  const comparison = calculateCounterComparison(currentCycle.projectedCloseUsageMilliunit, previousUsage.usageMilliunit);
  const cycleDurationMs = context.current.endMs - context.current.startMs;

  return {
    latestReading,
    latestInterval,
    recentDailyAverage,
    currentCycle,
    previousCycle,
    comparison,
    confidence: {
      forecastAvailable: currentCycle.projectedCloseUsageMilliunit !== null,
      observedMs: currentCycle.observedMs,
      cycleDurationMs,
      observationCoverageRatio: cycleDurationMs > 0 ? currentCycle.observedMs / cycleDurationMs : 0,
      recentFullDaysUsed: recentDailyAverage?.daysUsed ?? 0,
      requestedRecentDays: recentWindowDays,
      startBoundaryProvenance: currentCycle.startBoundary?.provenance ?? null,
      latestIntervalElapsedMs: latestInterval?.elapsedMs ?? null,
      previousCycleAvailable: previousUsage.usageMilliunit !== null,
    },
  };
}

function calculateCounterCurrentCycleForecast(
  readings: readonly CounterPoint[],
  latestReading: CounterPoint,
  cycle: BillingCycle,
): CounterCurrentCycleForecast {
  const eligibleReadings = readings.filter(reading => reading.measuredAtMs <= latestReading.measuredAtMs);
  const startBoundary = resolveCounterBoundaryReading(eligibleReadings, cycle.startMs);
  const observedMs = latestReading.measuredAtMs - cycle.startMs;
  const remainingMs = cycle.endMs - latestReading.measuredAtMs;

  if (startBoundary === null || observedMs < 0) {
    return emptyCounterCurrentCycleForecast(cycle, startBoundary, Math.max(0, observedMs), remainingMs);
  }

  if (observedMs === 0) {
    return {
      ...emptyCounterCurrentCycleForecast(cycle, startBoundary, observedMs, remainingMs),
      usageToDateMilliunit: 0,
    };
  }

  const usageToDateMilliunit = latestReading.cumulativeMilliunit - startBoundary.cumulativeMilliunit;
  if (usageToDateMilliunit < 0) {
    throw new UsageDomainError(
      'READING_DECREASED',
      'Current cycle latest reading must not be lower than its resolved start boundary.',
    );
  }

  const cycleDurationMs = cycle.endMs - cycle.startMs;
  return {
    cycle,
    startBoundary,
    usageToDateMilliunit,
    observedMs,
    remainingMs,
    averageDailyUsageMilliunit: usageToDateMilliunit * MS_PER_HOUR / observedMs * 24,
    projectedCloseUsageMilliunit: usageToDateMilliunit * cycleDurationMs / observedMs,
    normalized30DayUsageMilliunit: usageToDateMilliunit * (30 * MS_PER_NORMALIZED_DAY) / observedMs,
  };
}

function emptyCounterCurrentCycleForecast(
  cycle: BillingCycle,
  startBoundary: CounterBoundaryReading | null,
  observedMs: number,
  remainingMs: number,
): CounterCurrentCycleForecast {
  return {
    cycle,
    startBoundary,
    usageToDateMilliunit: null,
    observedMs,
    remainingMs,
    averageDailyUsageMilliunit: null,
    projectedCloseUsageMilliunit: null,
    normalized30DayUsageMilliunit: null,
  };
}

function calculateCounterRecentDailyAverage(
  readings: readonly CounterPoint[],
  timeZone: string,
  recentWindowDays: number,
): CounterRecentDailyAverage | null {
  if (readings.length < 2) return null;

  const aggregates = new Map<string, CounterDailyAggregate>();
  for (let index = 1; index < readings.length; index += 1) {
    const split = splitCounterIntervalByLocalDate(readings[index - 1], readings[index], timeZone);
    for (const slice of split.days) {
      const existing = aggregates.get(slice.localDate);
      if (existing) {
        existing.startMs = Math.min(existing.startMs, slice.start.measuredAtMs);
        existing.endMs = Math.max(existing.endMs, slice.end.measuredAtMs);
        existing.usageMilliunit += slice.usageMilliunit;
        existing.includesInterpolated ||= slice.provenance === 'interpolated';
      } else {
        aggregates.set(slice.localDate, {
          localDate: slice.localDate,
          startMs: slice.start.measuredAtMs,
          endMs: slice.end.measuredAtMs,
          usageMilliunit: slice.usageMilliunit,
          includesInterpolated: slice.provenance === 'interpolated',
        });
      }
    }
  }

  const fullDays = [...aggregates.values()]
    .filter(day => isFullLocalDay(day, timeZone))
    .sort((left, right) => left.localDate.localeCompare(right.localDate))
    .slice(-recentWindowDays);

  if (fullDays.length === 0) return null;
  const totalMilliunit = fullDays.reduce((sum, day) => sum + day.usageMilliunit, 0);
  return {
    requestedDays: recentWindowDays,
    daysUsed: fullDays.length,
    localDates: fullDays.map(day => day.localDate),
    usageMilliunitPerDay: totalMilliunit / fullDays.length,
    includesInterpolated: fullDays.some(day => day.includesInterpolated),
  };
}

function isFullLocalDay(day: CounterDailyAggregate, timeZone: string): boolean {
  const date = parseLocalDate(day.localDate);
  const startMs = getStartOfLocalDateMs(date, timeZone);
  const endMs = getStartOfLocalDateMs(addLocalDays(date, 1), timeZone);
  return day.startMs === startMs && day.endMs === endMs;
}

function parseLocalDate(localDate: string): LocalDateParts {
  const [year, month, day] = localDate.split('-').map(Number);
  return { year, month, day };
}

function calculateCounterComparison(
  projectedMilliunit: number | null,
  previousMilliunit: number | null,
): CounterForecastComparison | null {
  if (projectedMilliunit === null || previousMilliunit === null) return null;
  const deltaMilliunit = projectedMilliunit - previousMilliunit;
  return {
    projectedVsPreviousDeltaMilliunit: deltaMilliunit,
    projectedVsPreviousPercent: previousMilliunit === 0 ? null : deltaMilliunit / previousMilliunit * 100,
  };
}

// --- electricity adapter -----------------------------------------------------

export interface RecentDailyAverage {
  requestedDays: number;
  daysUsed: number;
  localDates: string[];
  usageWhPerDay: number;
  usageKwhPerDay: number;
  includesInterpolated: boolean;
}

export interface CurrentCycleForecast {
  cycle: BillingCycle;
  startBoundary: BillingBoundaryReading | null;
  usageToDateWh: number | null;
  usageToDateKwh: number | null;
  observedMs: number;
  remainingMs: number;
  averagePowerW: number | null;
  averageDailyUsageWh: number | null;
  averageDailyUsageKwh: number | null;
  projectedCloseUsageWh: number | null;
  projectedCloseUsageKwh: number | null;
  normalized30DayUsageWh: number | null;
  normalized30DayUsageKwh: number | null;
}

export interface PreviousCycleSnapshot {
  cycle: BillingCycle;
  start: BillingBoundaryReading | null;
  end: BillingBoundaryReading | null;
  usageWh: number | null;
  usageKwh: number | null;
}

export interface ForecastComparison {
  projectedVsPreviousDeltaWh: number;
  projectedVsPreviousDeltaKwh: number;
  projectedVsPreviousPercent: number | null;
}

export interface UsageForecastSnapshot {
  latestReading: MeterReadingPoint | null;
  latestInterval: UsageInterval | null;
  recentDailyAverage: RecentDailyAverage | null;
  currentCycle: CurrentCycleForecast | null;
  previousCycle: PreviousCycleSnapshot | null;
  comparison: ForecastComparison | null;
  confidence: ForecastConfidenceEvidence | null;
}

export function calculateUsageForecast(
  readings: readonly MeterReadingPoint[],
  setting: BillingCloseSetting,
  timeZone: string,
  recentWindowDays: number,
): UsageForecastSnapshot {
  try {
    const snapshot = calculateCounterForecast(readings.map(toCounterPoint), setting, timeZone, recentWindowDays);
    return {
      latestReading: snapshot.latestReading === null
        ? null
        : { measuredAtMs: snapshot.latestReading.measuredAtMs, cumulativeWh: snapshot.latestReading.cumulativeMilliunit },
      latestInterval: snapshot.latestInterval === null ? null : electricityInterval(snapshot.latestInterval),
      recentDailyAverage: snapshot.recentDailyAverage === null ? null : {
        requestedDays: snapshot.recentDailyAverage.requestedDays,
        daysUsed: snapshot.recentDailyAverage.daysUsed,
        localDates: snapshot.recentDailyAverage.localDates,
        usageWhPerDay: snapshot.recentDailyAverage.usageMilliunitPerDay,
        usageKwhPerDay: snapshot.recentDailyAverage.usageMilliunitPerDay / WH_PER_KWH,
        includesInterpolated: snapshot.recentDailyAverage.includesInterpolated,
      },
      currentCycle: snapshot.currentCycle === null ? null : {
        cycle: snapshot.currentCycle.cycle,
        startBoundary: snapshot.currentCycle.startBoundary === null
          ? null
          : electricityBoundary(snapshot.currentCycle.startBoundary),
        usageToDateWh: snapshot.currentCycle.usageToDateMilliunit,
        usageToDateKwh: snapshot.currentCycle.usageToDateMilliunit === null
          ? null
          : snapshot.currentCycle.usageToDateMilliunit / WH_PER_KWH,
        observedMs: snapshot.currentCycle.observedMs,
        remainingMs: snapshot.currentCycle.remainingMs,
        averagePowerW: snapshot.currentCycle.usageToDateMilliunit === null || snapshot.currentCycle.observedMs === 0
          ? null
          : snapshot.currentCycle.usageToDateMilliunit * MS_PER_HOUR / snapshot.currentCycle.observedMs,
        averageDailyUsageWh: snapshot.currentCycle.averageDailyUsageMilliunit,
        averageDailyUsageKwh: snapshot.currentCycle.averageDailyUsageMilliunit === null
          ? null
          : snapshot.currentCycle.averageDailyUsageMilliunit / WH_PER_KWH,
        projectedCloseUsageWh: snapshot.currentCycle.projectedCloseUsageMilliunit,
        projectedCloseUsageKwh: snapshot.currentCycle.projectedCloseUsageMilliunit === null
          ? null
          : snapshot.currentCycle.projectedCloseUsageMilliunit / WH_PER_KWH,
        normalized30DayUsageWh: snapshot.currentCycle.normalized30DayUsageMilliunit,
        normalized30DayUsageKwh: snapshot.currentCycle.normalized30DayUsageMilliunit === null
          ? null
          : snapshot.currentCycle.normalized30DayUsageMilliunit / WH_PER_KWH,
      },
      previousCycle: snapshot.previousCycle === null ? null : {
        cycle: snapshot.previousCycle.cycle,
        start: snapshot.previousCycle.start === null ? null : electricityBoundary(snapshot.previousCycle.start),
        end: snapshot.previousCycle.end === null ? null : electricityBoundary(snapshot.previousCycle.end),
        usageWh: snapshot.previousCycle.usageMilliunit,
        usageKwh: snapshot.previousCycle.usageMilliunit === null ? null : snapshot.previousCycle.usageMilliunit / WH_PER_KWH,
      },
      comparison: snapshot.comparison === null ? null : {
        projectedVsPreviousDeltaWh: snapshot.comparison.projectedVsPreviousDeltaMilliunit,
        projectedVsPreviousDeltaKwh: snapshot.comparison.projectedVsPreviousDeltaMilliunit / WH_PER_KWH,
        projectedVsPreviousPercent: snapshot.comparison.projectedVsPreviousPercent,
      },
      confidence: snapshot.confidence,
    };
  } catch (error) {
    throw toUsageDomainError(error);
  }
}

function electricityInterval(interval: CounterInterval): UsageInterval {
  const usageWh = interval.cumulativeMilliunitDelta;
  return {
    usageWh,
    usageKwh: usageWh / WH_PER_KWH,
    elapsedMs: interval.elapsedMs,
    elapsedHours: interval.elapsedMs / MS_PER_HOUR,
    averagePowerW: usageWh * MS_PER_HOUR / interval.elapsedMs,
  };
}

function electricityBoundary(boundary: CounterBoundaryReading): BillingBoundaryReading {
  return {
    measuredAtMs: boundary.measuredAtMs,
    cumulativeWh: boundary.cumulativeMilliunit,
    provenance: boundary.provenance,
  };
}
