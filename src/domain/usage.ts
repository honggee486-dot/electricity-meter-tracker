const WH_PER_KWH = 1_000;
const MS_PER_HOUR = 3_600_000;
const MAX_SAFE_WH = BigInt(Number.MAX_SAFE_INTEGER);
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

export function parseCumulativeKwhToWh(value: string): number {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new UsageDomainError(
      'INVALID_READING_VALUE',
      'Cumulative reading must be an unsigned decimal kWh string.',
    );
  }

  const [, wholeKwh, fraction = ''] = match;
  if (fraction.length > 3) {
    throw new UsageDomainError(
      'READING_PRECISION_EXCEEDED',
      'Cumulative reading supports at most 0.001 kWh (1 Wh) precision.',
    );
  }

  const normalizedWholeKwh = wholeKwh.replace(/^0+(?=\d)/, '');
  if (normalizedWholeKwh.length > 13) {
    throw new UsageDomainError('READING_OUT_OF_RANGE', 'Cumulative reading is outside the safe integer Wh range.');
  }

  const fractionWh = fraction.padEnd(3, '0');
  const totalWh = BigInt(normalizedWholeKwh) * BigInt(WH_PER_KWH) + BigInt(fractionWh);
  if (totalWh > MAX_SAFE_WH) {
    throw new UsageDomainError('READING_OUT_OF_RANGE', 'Cumulative reading is outside the safe integer Wh range.');
  }

  return Number(totalWh);
}

export function createMeterReadingPoint(cumulativeKwh: string, measuredAtMs: number): MeterReadingPoint {
  if (!Number.isSafeInteger(measuredAtMs) || Math.abs(measuredAtMs) > DATE_TIME_CLIP_LIMIT_MS) {
    throw new UsageDomainError(
      'INVALID_READING_POINT',
      'measuredAtMs must be an integer Unix epoch millisecond instant within the ECMAScript Date range.',
    );
  }

  return {
    cumulativeWh: parseCumulativeKwhToWh(cumulativeKwh),
    measuredAtMs,
  };
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
