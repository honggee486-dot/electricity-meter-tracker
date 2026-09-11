import {
  createLocalDateFormatter,
  findFirstLocalDateBoundary,
  getLocalDate,
} from './calendar.js';
import {
  calculateCounterInterval,
  type CounterPoint,
} from './counter.js';
import {
  toCounterPoint,
  toUsageDomainError,
  type MeterReadingPoint,
} from './usage.js';

const WH_PER_KWH = 1_000;
const MS_PER_HOUR = 3_600_000;

export type ReadingProvenance = 'actual' | 'interpolated';

export interface CounterBoundaryPoint {
  measuredAtMs: number;
  cumulativeMilliunit: number;
  localDate: string;
  provenance: ReadingProvenance;
}

export interface CounterDailySlice {
  localDate: string;
  start: CounterBoundaryPoint;
  end: CounterBoundaryPoint;
  provenance: ReadingProvenance;
  usageMilliunit: number;
  elapsedMs: number;
}

export interface CounterDailySplit {
  points: CounterBoundaryPoint[];
  days: CounterDailySlice[];
  totalUsageMilliunit: number;
  totalElapsedMs: number;
}

interface InternalBoundaryPoint extends CounterBoundaryPoint {
  usageMilliunitFromPrevious: number;
}

// Unit-neutral local-date splitting of one cumulative interval. The cumulative
// unit meaning is owned by the meter's utility kind; this core only handles
// monotone counters, elapsed time and linear interpolation across local dates.
export function splitCounterIntervalByLocalDate(
  previous: CounterPoint,
  current: CounterPoint,
  timeZone: string,
): CounterDailySplit {
  const interval = calculateCounterInterval(previous, current);
  const formatter = createLocalDateFormatter(timeZone);

  const points: InternalBoundaryPoint[] = [
    {
      measuredAtMs: previous.measuredAtMs,
      cumulativeMilliunit: previous.cumulativeMilliunit,
      localDate: getLocalDate(formatter, previous.measuredAtMs),
      provenance: 'actual',
      usageMilliunitFromPrevious: 0,
    },
  ];

  let cursorMs = previous.measuredAtMs;
  while (cursorMs < current.measuredAtMs) {
    const boundaryMs = findFirstLocalDateBoundary(formatter, cursorMs, current.measuredAtMs);
    if (boundaryMs === null || boundaryMs >= current.measuredAtMs) {
      break;
    }

    const usageMilliunitFromPrevious = interpolateUsage(
      interval.cumulativeMilliunitDelta,
      interval.elapsedMs,
      boundaryMs - previous.measuredAtMs,
    );

    points.push({
      measuredAtMs: boundaryMs,
      cumulativeMilliunit: previous.cumulativeMilliunit + usageMilliunitFromPrevious,
      localDate: getLocalDate(formatter, boundaryMs),
      provenance: 'interpolated',
      usageMilliunitFromPrevious,
    });
    cursorMs = boundaryMs;
  }

  points.push({
    measuredAtMs: current.measuredAtMs,
    cumulativeMilliunit: current.cumulativeMilliunit,
    localDate: getLocalDate(formatter, current.measuredAtMs),
    provenance: 'actual',
    usageMilliunitFromPrevious: interval.cumulativeMilliunitDelta,
  });

  const days: CounterDailySlice[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    days.push({
      localDate: start.localDate,
      start: toPublicCounterPoint(start),
      end: toPublicCounterPoint(end),
      provenance: start.provenance === 'actual' && end.provenance === 'actual' ? 'actual' : 'interpolated',
      usageMilliunit: end.usageMilliunitFromPrevious - start.usageMilliunitFromPrevious,
      elapsedMs: end.measuredAtMs - start.measuredAtMs,
    });
  }

  return {
    points: points.map(toPublicCounterPoint),
    days,
    totalUsageMilliunit: interval.cumulativeMilliunitDelta,
    totalElapsedMs: interval.elapsedMs,
  };
}

function interpolateUsage(totalUsageMilliunit: number, totalElapsedMs: number, elapsedMs: number): number {
  return totalUsageMilliunit * elapsedMs / totalElapsedMs;
}

function toPublicCounterPoint(point: InternalBoundaryPoint): CounterBoundaryPoint {
  return {
    measuredAtMs: point.measuredAtMs,
    cumulativeMilliunit: point.cumulativeMilliunit,
    localDate: point.localDate,
    provenance: point.provenance,
  };
}

// --- electricity adapter -----------------------------------------------------

export interface DailyBoundaryPoint {
  measuredAtMs: number;
  cumulativeWh: number;
  localDate: string;
  provenance: ReadingProvenance;
}

export interface DailyUsageSlice {
  localDate: string;
  start: DailyBoundaryPoint;
  end: DailyBoundaryPoint;
  provenance: ReadingProvenance;
  usageWh: number;
  usageKwh: number;
  elapsedMs: number;
  averagePowerW: number;
}

export interface DailyUsageSplit {
  points: DailyBoundaryPoint[];
  days: DailyUsageSlice[];
  totalUsageWh: number;
  totalElapsedMs: number;
}

export function splitUsageIntervalByLocalDate(
  previous: MeterReadingPoint,
  current: MeterReadingPoint,
  timeZone: string,
): DailyUsageSplit {
  let split: CounterDailySplit;
  try {
    split = splitCounterIntervalByLocalDate(toCounterPoint(previous), toCounterPoint(current), timeZone);
  } catch (error) {
    throw toUsageDomainError(error);
  }

  return {
    points: split.points.map(electricityPoint),
    days: split.days.map(day => {
      const usageWh = day.usageMilliunit;
      return {
        localDate: day.localDate,
        start: electricityPoint(day.start),
        end: electricityPoint(day.end),
        provenance: day.provenance,
        usageWh,
        usageKwh: usageWh / WH_PER_KWH,
        elapsedMs: day.elapsedMs,
        averagePowerW: usageWh * MS_PER_HOUR / day.elapsedMs,
      };
    }),
    totalUsageWh: split.totalUsageMilliunit,
    totalElapsedMs: split.totalElapsedMs,
  };
}

function electricityPoint(point: CounterBoundaryPoint): DailyBoundaryPoint {
  return {
    measuredAtMs: point.measuredAtMs,
    cumulativeWh: point.cumulativeMilliunit,
    localDate: point.localDate,
    provenance: point.provenance,
  };
}
