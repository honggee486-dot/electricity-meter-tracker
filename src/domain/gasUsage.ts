import type { BillingCloseSetting, BillingCycle, CounterBoundaryReading } from './billingCycle.js';
import {
  calculateCounterInterval,
  type CounterInterval,
  type CounterPoint,
} from './counter.js';
import {
  calculateCounterForecast,
  type ForecastConfidenceEvidence,
} from './forecast.js';

const M3_PER_MILLIUNIT = 1 / 1_000;
const MS_PER_HOUR = 3_600_000;

// Gas adapter over the unit-neutral counter/usage/forecast core
// (docs/GAS_METER_DIRECTION.md §5). One counter milli-unit is 0.001 m³ and the
// gas-specific derived unit is the average flow m³/h. Estimating a gas bill is
// out of scope here: tariff provenance does not exist yet, so no cost is computed.

export interface GasUsageInterval {
  usageM3: number;
  elapsedMs: number;
  elapsedHours: number;
  averageM3PerHour: number;
}

export function calculateGasUsageInterval(previous: CounterPoint, current: CounterPoint): GasUsageInterval {
  const interval = calculateCounterInterval(previous, current);
  const usageM3 = interval.cumulativeMilliunitDelta * M3_PER_MILLIUNIT;
  return {
    usageM3,
    elapsedMs: interval.elapsedMs,
    elapsedHours: interval.elapsedMs / MS_PER_HOUR,
    averageM3PerHour: usageM3 * MS_PER_HOUR / interval.elapsedMs,
  };
}

export interface GasRecentDailyAverage {
  requestedDays: number;
  daysUsed: number;
  localDates: string[];
  usageM3PerDay: number;
  includesInterpolated: boolean;
}

export interface GasCurrentCycleForecast {
  cycle: BillingCycle;
  startBoundary: CounterBoundaryReading | null;
  usageToDateM3: number | null;
  observedMs: number;
  remainingMs: number;
  averageDailyUsageM3: number | null;
  projectedCloseUsageM3: number | null;
  normalized30DayUsageM3: number | null;
}

export interface GasPreviousCycleSnapshot {
  cycle: BillingCycle;
  start: CounterBoundaryReading | null;
  end: CounterBoundaryReading | null;
  usageM3: number | null;
}

export interface GasForecastComparison {
  projectedVsPreviousDeltaM3: number;
  projectedVsPreviousPercent: number | null;
}

export interface GasUsageForecastSnapshot {
  latestReading: CounterPoint | null;
  latestInterval: GasUsageInterval | null;
  recentDailyAverage: GasRecentDailyAverage | null;
  currentCycle: GasCurrentCycleForecast | null;
  previousCycle: GasPreviousCycleSnapshot | null;
  comparison: GasForecastComparison | null;
  confidence: ForecastConfidenceEvidence | null;
}

export function calculateGasUsageForecast(
  readings: readonly CounterPoint[],
  setting: BillingCloseSetting,
  timeZone: string,
  recentWindowDays: number,
): GasUsageForecastSnapshot {
  const snapshot = calculateCounterForecast(readings, setting, timeZone, recentWindowDays);

  return {
    latestReading: snapshot.latestReading,
    latestInterval: snapshot.latestInterval === null ? null : gasInterval(snapshot.latestInterval),
    recentDailyAverage: snapshot.recentDailyAverage === null ? null : {
      requestedDays: snapshot.recentDailyAverage.requestedDays,
      daysUsed: snapshot.recentDailyAverage.daysUsed,
      localDates: snapshot.recentDailyAverage.localDates,
      usageM3PerDay: snapshot.recentDailyAverage.usageMilliunitPerDay * M3_PER_MILLIUNIT,
      includesInterpolated: snapshot.recentDailyAverage.includesInterpolated,
    },
    currentCycle: snapshot.currentCycle === null ? null : {
      cycle: snapshot.currentCycle.cycle,
      startBoundary: snapshot.currentCycle.startBoundary,
      usageToDateM3: toM3(snapshot.currentCycle.usageToDateMilliunit),
      observedMs: snapshot.currentCycle.observedMs,
      remainingMs: snapshot.currentCycle.remainingMs,
      averageDailyUsageM3: toM3(snapshot.currentCycle.averageDailyUsageMilliunit),
      projectedCloseUsageM3: toM3(snapshot.currentCycle.projectedCloseUsageMilliunit),
      normalized30DayUsageM3: toM3(snapshot.currentCycle.normalized30DayUsageMilliunit),
    },
    previousCycle: snapshot.previousCycle === null ? null : {
      cycle: snapshot.previousCycle.cycle,
      start: snapshot.previousCycle.start,
      end: snapshot.previousCycle.end,
      usageM3: toM3(snapshot.previousCycle.usageMilliunit),
    },
    comparison: snapshot.comparison === null ? null : {
      projectedVsPreviousDeltaM3: snapshot.comparison.projectedVsPreviousDeltaMilliunit * M3_PER_MILLIUNIT,
      projectedVsPreviousPercent: snapshot.comparison.projectedVsPreviousPercent,
    },
    confidence: snapshot.confidence,
  };
}

function toM3(milliunit: number | null): number | null {
  return milliunit === null ? null : milliunit * M3_PER_MILLIUNIT;
}

function gasInterval(interval: CounterInterval): GasUsageInterval {
  const usageM3 = interval.cumulativeMilliunitDelta * M3_PER_MILLIUNIT;
  return {
    usageM3,
    elapsedMs: interval.elapsedMs,
    elapsedHours: interval.elapsedMs / MS_PER_HOUR,
    averageM3PerHour: usageM3 * MS_PER_HOUR / interval.elapsedMs,
  };
}
