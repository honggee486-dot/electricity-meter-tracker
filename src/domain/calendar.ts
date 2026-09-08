import { UsageDomainError } from './usage.js';

const SEARCH_MARGIN_MS = 48 * 3_600_000;

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export function createLocalDateFormatter(timeZone: string): Intl.DateTimeFormat {
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

export function getLocalDate(formatter: Intl.DateTimeFormat, measuredAtMs: number): string {
  const { year, month, day } = getLocalDateParts(formatter, measuredAtMs);
  return formatLocalDate({ year, month, day });
}

export function getLocalDateParts(formatter: Intl.DateTimeFormat, measuredAtMs: number): LocalDateParts {
  const parts = formatter.formatToParts(measuredAtMs);
  let year = 0;
  let month = 0;
  let day = 0;

  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
  }

  return { year, month, day };
}

export function formatLocalDate(date: LocalDateParts): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function addLocalDays(date: LocalDateParts, delta: number): LocalDateParts {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + delta));
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

export function getStartOfLocalDateMs(date: LocalDateParts, timeZone: string): number {
  const formatter = createLocalDateFormatter(timeZone);
  const target = formatLocalDate(date);
  const approximateMs = Date.UTC(date.year, date.month - 1, date.day);
  let low = approximateMs - SEARCH_MARGIN_MS;
  let high = approximateMs + SEARCH_MARGIN_MS;

  while (low + 1 < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (getLocalDate(formatter, middle) < target) low = middle;
    else high = middle;
  }

  if (getLocalDate(formatter, high) !== target) {
    throw new UsageDomainError('UNRESOLVABLE_LOCAL_DATE', `Local date does not exist in ${timeZone}: ${target}`);
  }
  return high;
}

export function findFirstLocalDateBoundary(
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
    if (getLocalDate(formatter, middle) === fromDate) low = middle;
    else high = middle;
  }
  return high;
}
