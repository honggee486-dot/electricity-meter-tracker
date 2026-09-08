import {
  calculateBillingCycleUsage,
  getBillingCycleContext,
  resolveBillingBoundaryReading,
  type BillingBoundaryReading,
  type BillingCloseSetting,
  type BillingCycle,
  type BillingCycleUsage,
} from './billingCycle.js';
import {
  addLocalDays,
  createLocalDateFormatter,
  getStartOfLocalDateMs,
  type LocalDateParts,
} from './calendar.js';
import { splitUsageIntervalByLocalDate } from './dailyUsage.js';
import {
  UsageDomainError,
  calculateUsageInterval,
  type MeterReadingPoint,
  type UsageInterval,
} from './usage.js';

const WH_PER_KWH = 1_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_NORMALIZED_DAY = 24 * MS_PER_HOUR;

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

export interface PreviousCycleSnapshot extends BillingCycleUsage {
  cycle: BillingCycle;
}

export interface ForecastComparison {
  projectedVsPreviousDeltaWh: number;
  projectedVsPreviousDeltaKwh: number;
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

export interface UsageForecastSnapshot {
  latestReading: MeterReadingPoint | null;
  latestInterval: UsageInterval | null;
  recentDailyAverage: RecentDailyAverage | null;
  currentCycle: CurrentCycleForecast | null;
  previousCycle: PreviousCycleSnapshot | null;
  comparison: ForecastComparison | null;
  confidence: ForecastConfidenceEvidence | null;
}

interface DailyAggregate {
  localDate: string;
  startMs: number;
  endMs: number;
  usageWh: number;
  includesInterpolated: boolean;
}

export function calculateUsageForecast(
  readings: readonly MeterReadingPoint[],
  setting: BillingCloseSetting,
  timeZone: string,
  recentWindowDays: number,
): UsageForecastSnapshot {
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
    calculateUsageInterval(sorted[index - 1], sorted[index]);
  }

  const latestReading = sorted[sorted.length - 1];
  const latestInterval = sorted.length >= 2
    ? calculateUsageInterval(sorted[sorted.length - 2], latestReading)
    : null;
  const context = getBillingCycleContext(latestReading.measuredAtMs, setting, timeZone);
  const currentCycle = calculateCurrentCycleForecast(sorted, latestReading, context.current);
  const recentDailyAverage = calculateRecentDailyAverage(sorted, timeZone, recentWindowDays);
  const previousUsage = calculateBillingCycleUsage(sorted, context.previous);
  const previousCycle: PreviousCycleSnapshot = { cycle: context.previous, ...previousUsage };
  const comparison = calculateComparison(currentCycle.projectedCloseUsageWh, previousUsage.usageWh);
  const cycleDurationMs = context.current.endMs - context.current.startMs;

  return {
    latestReading,
    latestInterval,
    recentDailyAverage,
    currentCycle,
    previousCycle,
    comparison,
    confidence: {
      forecastAvailable: currentCycle.projectedCloseUsageWh !== null,
      observedMs: currentCycle.observedMs,
      cycleDurationMs,
      observationCoverageRatio: cycleDurationMs > 0 ? currentCycle.observedMs / cycleDurationMs : 0,
      recentFullDaysUsed: recentDailyAverage?.daysUsed ?? 0,
      requestedRecentDays: recentWindowDays,
      startBoundaryProvenance: currentCycle.startBoundary?.provenance ?? null,
      latestIntervalElapsedMs: latestInterval?.elapsedMs ?? null,
      previousCycleAvailable: previousUsage.usageWh !== null,
    },
  };
}

function calculateCurrentCycleForecast(
  readings: readonly MeterReadingPoint[],
  latestReading: MeterReadingPoint,
  cycle: BillingCycle,
): CurrentCycleForecast {
  const eligibleReadings = readings.filter(reading => reading.measuredAtMs <= latestReading.measuredAtMs);
  const startBoundary = resolveBillingBoundaryReading(eligibleReadings, cycle.startMs);
  const observedMs = latestReading.measuredAtMs - cycle.startMs;
  const remainingMs = cycle.endMs - latestReading.measuredAtMs;

  if (startBoundary === null || observedMs <= 0) {
    return emptyCurrentCycleForecast(cycle, startBoundary, Math.max(0, observedMs), remainingMs);
  }

  const usageToDateWh = latestReading.cumulativeWh - startBoundary.cumulativeWh;
  if (usageToDateWh < 0) {
    throw new UsageDomainError(
      'READING_DECREASED',
      'Current cycle latest reading must not be lower than its resolved start boundary.',
    );
  }

  const averagePowerW = usageToDateWh * MS_PER_HOUR / observedMs;
  const averageDailyUsageWh = averagePowerW * 24;
  const cycleDurationMs = cycle.endMs - cycle.startMs;
  const projectedCloseUsageWh = usageToDateWh * cycleDurationMs / observedMs;
  const normalized30DayUsageWh = usageToDateWh * (30 * MS_PER_NORMALIZED_DAY) / observedMs;

  return {
    cycle,
    startBoundary,
    usageToDateWh,
    usageToDateKwh: usageToDateWh / WH_PER_KWH,
    observedMs,
    remainingMs,
    averagePowerW,
    averageDailyUsageWh,
    averageDailyUsageKwh: averageDailyUsageWh / WH_PER_KWH,
    projectedCloseUsageWh,
    projectedCloseUsageKwh: projectedCloseUsageWh / WH_PER_KWH,
    normalized30DayUsageWh,
    normalized30DayUsageKwh: normalized30DayUsageWh / WH_PER_KWH,
  };
}

function emptyCurrentCycleForecast(
  cycle: BillingCycle,
  startBoundary: BillingBoundaryReading | null,
  observedMs: number,
  remainingMs: number,
): CurrentCycleForecast {
  return {
    cycle,
    startBoundary,
    usageToDateWh: null,
    usageToDateKwh: null,
    observedMs,
    remainingMs,
    averagePowerW: null,
    averageDailyUsageWh: null,
    averageDailyUsageKwh: null,
    projectedCloseUsageWh: null,
    projectedCloseUsageKwh: null,
    normalized30DayUsageWh: null,
    normalized30DayUsageKwh: null,
  };
}

function calculateRecentDailyAverage(
  readings: readonly MeterReadingPoint[],
  timeZone: string,
  recentWindowDays: number,
): RecentDailyAverage | null {
  if (readings.length < 2) return null;

  const aggregates = new Map<string, DailyAggregate>();
  for (let index = 1; index < readings.length; index += 1) {
    const split = splitUsageIntervalByLocalDate(readings[index - 1], readings[index], timeZone);
    for (const slice of split.days) {
      const existing = aggregates.get(slice.localDate);
      if (existing) {
        existing.startMs = Math.min(existing.startMs, slice.start.measuredAtMs);
        existing.endMs = Math.max(existing.endMs, slice.end.measuredAtMs);
        existing.usageWh += slice.usageWh;
        existing.includesInterpolated ||= slice.provenance === 'interpolated';
      } else {
        aggregates.set(slice.localDate, {
          localDate: slice.localDate,
          startMs: slice.start.measuredAtMs,
          endMs: slice.end.measuredAtMs,
          usageWh: slice.usageWh,
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
  const totalWh = fullDays.reduce((sum, day) => sum + day.usageWh, 0);
  const usageWhPerDay = totalWh / fullDays.length;
  return {
    requestedDays: recentWindowDays,
    daysUsed: fullDays.length,
    localDates: fullDays.map(day => day.localDate),
    usageWhPerDay,
    usageKwhPerDay: usageWhPerDay / WH_PER_KWH,
    includesInterpolated: fullDays.some(day => day.includesInterpolated),
  };
}

function isFullLocalDay(day: DailyAggregate, timeZone: string): boolean {
  const date = parseLocalDate(day.localDate);
  const startMs = getStartOfLocalDateMs(date, timeZone);
  const endMs = getStartOfLocalDateMs(addLocalDays(date, 1), timeZone);
  return day.startMs === startMs && day.endMs === endMs;
}

function parseLocalDate(localDate: string): LocalDateParts {
  const [year, month, day] = localDate.split('-').map(Number);
  return { year, month, day };
}

function calculateComparison(projectedWh: number | null, previousWh: number | null): ForecastComparison | null {
  if (projectedWh === null || previousWh === null) return null;
  const deltaWh = projectedWh - previousWh;
  return {
    projectedVsPreviousDeltaWh: deltaWh,
    projectedVsPreviousDeltaKwh: deltaWh / WH_PER_KWH,
    projectedVsPreviousPercent: previousWh === 0 ? null : deltaWh / previousWh * 100,
  };
}

function validateRecentWindowDays(recentWindowDays: number): void {
  if (!Number.isInteger(recentWindowDays) || recentWindowDays <= 0) {
    throw new UsageDomainError(
      'INVALID_FORECAST_WINDOW',
      'Recent daily average window must be a positive integer number of full local days.',
    );
  }
}
