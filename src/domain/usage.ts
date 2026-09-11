import {
  CounterError,
  parseCumulativeCounter,
  type CounterErrorCode,
} from './counter.js';

const WH_PER_KWH = 1_000;
const MS_PER_HOUR = 3_600_000;
const DATE_TIME_CLIP_LIMIT_MS = 8_640_000_000_000_000;

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

const READING_ERROR_CODES: Record<CounterErrorCode, UsageDomainErrorCode> = {
  INVALID_COUNTER_VALUE: 'INVALID_READING_VALUE',
  COUNTER_PRECISION_EXCEEDED: 'READING_PRECISION_EXCEEDED',
  COUNTER_OUT_OF_RANGE: 'READING_OUT_OF_RANGE',
  INVALID_COUNTER_POINT: 'INVALID_READING_POINT',
};

const READING_ERROR_MESSAGES: Record<CounterErrorCode, string> = {
  INVALID_COUNTER_VALUE: 'Cumulative reading must be an unsigned decimal kWh string.',
  COUNTER_PRECISION_EXCEEDED: 'Cumulative reading supports at most 0.001 kWh (1 Wh) precision.',
  COUNTER_OUT_OF_RANGE: 'Cumulative reading is outside the safe integer Wh range.',
  INVALID_COUNTER_POINT: 'measuredAtMs must be an integer Unix epoch millisecond instant within the ECMAScript Date range.',
};

function asUsageDomainError(error: unknown): unknown {
  if (error instanceof CounterError) {
    return new UsageDomainError(READING_ERROR_CODES[error.code], READING_ERROR_MESSAGES[error.code]);
  }
  return error;
}

export function parseCumulativeKwhToWh(value: string): number {
  try {
    return parseCumulativeCounter(value, 0).cumulativeMilliunit;
  } catch (error) {
    throw asUsageDomainError(error);
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
    throw asUsageDomainError(error);
  }
}

export function calculateUsageInterval(previous: MeterReadingPoint, current: MeterReadingPoint): UsageInterval {
  validateReadingPoint(previous);
  validateReadingPoint(current);

  if (current.cumulativeWh < previous.cumulativeWh) {
    throw new UsageDomainError(
      'READING_DECREASED',
      'Current cumulative reading must not be lower than the previous reading.',
    );
  }

  const elapsedMs = current.measuredAtMs - previous.measuredAtMs;
  if (elapsedMs <= 0) {
    throw new UsageDomainError(
      'NON_POSITIVE_INTERVAL',
      'Current reading instant must be later than the previous reading instant.',
    );
  }

  const usageWh = current.cumulativeWh - previous.cumulativeWh;
  return {
    usageWh,
    usageKwh: usageWh / WH_PER_KWH,
    elapsedMs,
    elapsedHours: elapsedMs / MS_PER_HOUR,
    averagePowerW: usageWh * MS_PER_HOUR / elapsedMs,
  };
}

function validateReadingPoint(point: MeterReadingPoint): void {
  if (
    !Number.isSafeInteger(point.cumulativeWh)
    || point.cumulativeWh < 0
    || !Number.isSafeInteger(point.measuredAtMs)
    || Math.abs(point.measuredAtMs) > DATE_TIME_CLIP_LIMIT_MS
  ) {
    throw new UsageDomainError(
      'INVALID_READING_POINT',
      'Reading point must contain a non-negative safe-integer Wh value and a valid epoch millisecond instant.',
    );
  }
}
