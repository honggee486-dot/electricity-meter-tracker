// Unit-neutral cumulative counter primitive (docs/GAS_METER_DIRECTION.md §5).
// A counter point is a non-negative safe integer in 1/1000 steps of the meter
// base unit. The meter's immutable utility kind owns what the base unit means:
// electricity keeps a Wh adapter in usage.ts, gas reads the same counter as
// 0.001 m³. Time and monotonicity semantics here are unit-independent.

const MILLIUNIT_PER_UNIT = 1_000;
const MAX_SAFE_MILLIUNIT = BigInt(Number.MAX_SAFE_INTEGER);
const DATE_TIME_CLIP_LIMIT_MS = 8_640_000_000_000_000;

export type CounterErrorCode =
  | 'INVALID_COUNTER_VALUE'
  | 'COUNTER_PRECISION_EXCEEDED'
  | 'COUNTER_OUT_OF_RANGE'
  | 'INVALID_COUNTER_POINT'
  | 'COUNTER_DECREASED'
  | 'NON_POSITIVE_INTERVAL'
  | 'INVALID_FORECAST_WINDOW';

export class CounterError extends Error {
  readonly code: CounterErrorCode;

  constructor(code: CounterErrorCode, message: string) {
    super(message);
    this.name = 'CounterError';
    this.code = code;
  }
}

export interface CounterPoint {
  measuredAtMs: number;
  cumulativeMilliunit: number;
}

export function parseCumulativeCounter(cumulativeValue: string, measuredAtMs: number): CounterPoint {
  if (!Number.isSafeInteger(measuredAtMs) || Math.abs(measuredAtMs) > DATE_TIME_CLIP_LIMIT_MS) {
    throw new CounterError(
      'INVALID_COUNTER_POINT',
      'measuredAtMs must be an integer Unix epoch millisecond instant within the ECMAScript Date range.',
    );
  }

  const match = /^(\d+)(?:\.(\d+))?$/.exec(cumulativeValue);
  if (!match) {
    throw new CounterError(
      'INVALID_COUNTER_VALUE',
      'Cumulative reading must be an unsigned decimal string in meter base units.',
    );
  }

  const [, wholeUnits, fraction = ''] = match;
  if (fraction.length > 3) {
    throw new CounterError(
      'COUNTER_PRECISION_EXCEEDED',
      'Cumulative reading supports at most 0.001 of the meter base unit (1 milli-unit) precision.',
    );
  }

  const normalizedWholeUnits = wholeUnits.replace(/^0+(?=\d)/, '');
  if (normalizedWholeUnits.length > 13) {
    throw new CounterError('COUNTER_OUT_OF_RANGE', 'Cumulative reading is outside the safe integer milli-unit range.');
  }

  const fractionMilliunit = fraction.padEnd(3, '0');
  const totalMilliunit = BigInt(normalizedWholeUnits) * BigInt(MILLIUNIT_PER_UNIT) + BigInt(fractionMilliunit);
  if (totalMilliunit > MAX_SAFE_MILLIUNIT) {
    throw new CounterError('COUNTER_OUT_OF_RANGE', 'Cumulative reading is outside the safe integer milli-unit range.');
  }

  return {
    cumulativeMilliunit: Number(totalMilliunit),
    measuredAtMs,
  };
}

export interface CounterInterval {
  // Cumulative growth between the two counter points, in milli-units.
  cumulativeMilliunitDelta: number;
  elapsedMs: number;
}

export function validateCounterPoint(point: CounterPoint): void {
  if (
    !Number.isSafeInteger(point.cumulativeMilliunit)
    || point.cumulativeMilliunit < 0
    || !Number.isSafeInteger(point.measuredAtMs)
    || Math.abs(point.measuredAtMs) > DATE_TIME_CLIP_LIMIT_MS
  ) {
    throw new CounterError(
      'INVALID_COUNTER_POINT',
      'Counter point must contain a non-negative safe-integer milli-unit value and a valid epoch millisecond instant.',
    );
  }
}

export function calculateCounterInterval(previous: CounterPoint, current: CounterPoint): CounterInterval {
  validateCounterPoint(previous);
  validateCounterPoint(current);

  if (current.cumulativeMilliunit < previous.cumulativeMilliunit) {
    throw new CounterError(
      'COUNTER_DECREASED',
      'The current cumulative counter must not be lower than the previous counter.',
    );
  }

  const elapsedMs = current.measuredAtMs - previous.measuredAtMs;
  if (elapsedMs <= 0) {
    throw new CounterError(
      'NON_POSITIVE_INTERVAL',
      'The current reading instant must be later than the previous reading instant.',
    );
  }

  return {
    cumulativeMilliunitDelta: current.cumulativeMilliunit - previous.cumulativeMilliunit,
    elapsedMs,
  };
}

export function validateRecentWindowDays(recentWindowDays: number): void {
  if (!Number.isInteger(recentWindowDays) || recentWindowDays <= 0) {
    throw new CounterError(
      'INVALID_FORECAST_WINDOW',
      'Recent daily average window must be a positive integer number of full local days.',
    );
  }
}
