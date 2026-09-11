import {
  CounterError,
  calculateCounterInterval,
  parseCumulativeCounter,
  type CounterErrorCode,
  type CounterPoint,
} from './counter.js';

const WH_PER_KWH = 1_000;
const MS_PER_HOUR = 3_600_000;

export type UsageDomainErrorCode =
  | 'INVALID_READING_VALUE'
  | 'READING_PRECISION_EXCEEDED'
  | 'READING_OUT_OF_RANGE'
  | 'INVALID_READING_POINT'
  | 'READING_DECREASED'
  | 'NON_POSITIVE_INTERVAL'
  | 'INVALID_TIME_ZONE'
  | 'INVALID_BILLING_CLOSE_SETTING'
  | 'UNRESOLVABLE_LOCAL_DATE'
  | 'INVALID_FORECAST_WINDOW';

export class UsageDomainError extends Error {
  readonly code: UsageDomainErrorCode;

  constructor(code: UsageDomainErrorCode, message: string) {
    super(message);
    this.name = 'UsageDomainError';
    this.code = code;
  }
}

export interface MeterReadingPoint {
  cumulativeWh: number;
  measuredAtMs: number;
}

export interface UsageInterval {
  usageWh: number;
  usageKwh: number;
  elapsedMs: number;
  elapsedHours: number;
  averagePowerW: number;
}

// electricity stores the raw counter in Wh: 1 milli-unit is 1 Wh.
export function toCounterPoint(point: MeterReadingPoint): CounterPoint {
  return { measuredAtMs: point.measuredAtMs, cumulativeMilliunit: point.cumulativeWh };
}

const READING_ERROR_CODES: Record<CounterErrorCode, UsageDomainErrorCode> = {
  INVALID_COUNTER_VALUE: 'INVALID_READING_VALUE',
  COUNTER_PRECISION_EXCEEDED: 'READING_PRECISION_EXCEEDED',
  COUNTER_OUT_OF_RANGE: 'READING_OUT_OF_RANGE',
  INVALID_COUNTER_POINT: 'INVALID_READING_POINT',
  COUNTER_DECREASED: 'READING_DECREASED',
  NON_POSITIVE_INTERVAL: 'NON_POSITIVE_INTERVAL',
  INVALID_FORECAST_WINDOW: 'INVALID_FORECAST_WINDOW',
};

const READING_ERROR_MESSAGES: Record<CounterErrorCode, string> = {
  INVALID_COUNTER_VALUE: 'Cumulative reading must be an unsigned decimal kWh string.',
  COUNTER_PRECISION_EXCEEDED: 'Cumulative reading supports at most 0.001 kWh (1 Wh) precision.',
  COUNTER_OUT_OF_RANGE: 'Cumulative reading is outside the safe integer Wh range.',
  INVALID_COUNTER_POINT: 'Reading point must contain a non-negative safe-integer Wh value and a valid epoch millisecond instant.',
  COUNTER_DECREASED: 'Current cumulative reading must not be lower than the previous reading.',
  NON_POSITIVE_INTERVAL: 'Current reading instant must be later than the previous reading instant.',
  INVALID_FORECAST_WINDOW: 'Recent daily average window must be a positive integer number of full local days.',
};

// The neutral counter core throws unit-neutral errors; electricity callers keep
// the established UsageDomainError contract. Non-counter errors pass through.
export function toUsageDomainError(error: unknown): unknown {
  if (error instanceof CounterError) {
    return new UsageDomainError(READING_ERROR_CODES[error.code], READING_ERROR_MESSAGES[error.code]);
  }
  return error;
}

export function parseCumulativeKwhToWh(value: string): number {
  try {
    return parseCumulativeCounter(value, 0).cumulativeMilliunit;
  } catch (error) {
    throw toUsageDomainError(error);
  }
}

export function createMeterReadingPoint(cumulativeKwh: string, measuredAtMs: number): MeterReadingPoint {
  try {
    const point = parseCumulativeCounter(cumulativeKwh, measuredAtMs);
    return {
      cumulativeWh: point.cumulativeMilliunit,
      measuredAtMs: point.measuredAtMs,
    };
  } catch (error) {
    throw toUsageDomainError(error);
  }
}

export function calculateUsageInterval(previous: MeterReadingPoint, current: MeterReadingPoint): UsageInterval {
  try {
    const interval = calculateCounterInterval(toCounterPoint(previous), toCounterPoint(current));
    const usageWh = interval.cumulativeMilliunitDelta;
    return {
      usageWh,
      usageKwh: usageWh / WH_PER_KWH,
      elapsedMs: interval.elapsedMs,
      elapsedHours: interval.elapsedMs / MS_PER_HOUR,
      averagePowerW: usageWh * MS_PER_HOUR / interval.elapsedMs,
    };
  } catch (error) {
    throw toUsageDomainError(error);
  }
}
