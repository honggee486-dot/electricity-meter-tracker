import {
  UsageDomainError,
  calculateUsageInterval,
  type MeterReadingPoint,
} from './usage.js';

const WH_PER_KWH = 1_000;
const MS_PER_HOUR = 3_600_000;

export type ReadingProvenance = 'actual' | 'interpolated';

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

interface InternalBoundaryPoint extends DailyBoundaryPoint {
  usageWhFromPrevious: number;
}

export function splitUsageIntervalByLocalDate(
  previous: MeterReadingPoint,
  current: MeterReadingPoint,
  timeZone: string,
): DailyUsageSplit {
  const interval = calculateUsageInterval(previous, current);
  const formatter = createLocalDateFormatter(timeZone);

  const points: InternalBoundaryPoint[] = [
    {
      measuredAtMs: previous.measuredAtMs,
      cumulativeWh: previous.cumulativeWh,
      localDate: getLocalDate(formatter, previous.measuredAtMs),
      provenance: 'actual',
      usageWhFromPrevious: 0,
    },
  ];

  let cursorMs = previous.measuredAtMs;
  while (cursorMs < current.measuredAtMs) {
    const boundaryMs = findFirstLocalDateBoundary(formatter, cursorMs, current.measuredAtMs);
    if (boundaryMs === null || boundaryMs >= current.measuredAtMs) {
      break;
    }

    const usageWhFromPrevious = interpolateUsageWh(
      interval.usageWh,
      interval.elapsedMs,
      boundaryMs - previous.measuredAtMs,
    );

    points.push({
      measuredAtMs: boundaryMs,
      cumulativeWh: previous.cumulativeWh + usageWhFromPrevious,
      localDate: getLocalDate(formatter, boundaryMs),
      provenance: 'interpolated',
      usageWhFromPrevious,
    });
    cursorMs = boundaryMs;
  }

  points.push({
    measuredAtMs: current.measuredAtMs,
    cumulativeWh: current.cumulativeWh,
    localDate: getLocalDate(formatter, current.measuredAtMs),
    provenance: 'actual',
    usageWhFromPrevious: interval.usageWh,
  });

  const days: DailyUsageSlice[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const elapsedMs = end.measuredAtMs - start.measuredAtMs;
    const usageWh = end.usageWhFromPrevious - start.usageWhFromPrevious;

    days.push({
      localDate: start.localDate,
      start: toPublicPoint(start),
      end: toPublicPoint(end),
      provenance: start.provenance === 'actual' && end.provenance === 'actual' ? 'actual' : 'interpolated',
      usageWh,
      usageKwh: usageWh / WH_PER_KWH,
      elapsedMs,
      averagePowerW: usageWh * MS_PER_HOUR / elapsedMs,
    });
  }

  return {
    points: points.map(toPublicPoint),
    days,
    totalUsageWh: interval.usageWh,
    totalElapsedMs: interval.elapsedMs,
  };
}

function createLocalDateFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    throw new UsageDomainError('INVALID_TIME_ZONE', `Invalid meter time zone: ${timeZone}`);
  }
}

function getLocalDate(formatter: Intl.DateTimeFormat, measuredAtMs: number): string {
  const parts = formatter.formatToParts(measuredAtMs);
  let year = '';
  let month = '';
  let day = '';

  for (const part of parts) {
    if (part.type === 'year') year = part.value;
    else if (part.type === 'month') month = part.value;
    else if (part.type === 'day') day = part.value;
  }

  return `${year.padStart(4, '0')}-${month}-${day}`;
}

function findFirstLocalDateBoundary(
  formatter: Intl.DateTimeFormat,
  fromMs: number,
  toMs: number,
): number | null {
  const fromDate = getLocalDate(formatter, fromMs);
  if (getLocalDate(formatter, toMs) === fromDate) {
    return null;
  }

  let low = fromMs;
  let high = toMs;
  while (low + 1 < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (getLocalDate(formatter, middle) === fromDate) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return high;
}

function interpolateUsageWh(totalUsageWh: number, totalElapsedMs: number, elapsedMs: number): number {
  return totalUsageWh * elapsedMs / totalElapsedMs;
}

function toPublicPoint(point: InternalBoundaryPoint): DailyBoundaryPoint {
  return {
    measuredAtMs: point.measuredAtMs,
    cumulativeWh: point.cumulativeWh,
    localDate: point.localDate,
    provenance: point.provenance,
  };
}
