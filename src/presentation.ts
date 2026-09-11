import type { MeterResource, ReadingResource, UtilityKind } from './api';
import { getBillingCycleContext } from './domain/billingCycle';
import { splitCounterIntervalByLocalDate } from './domain/dailyUsage';
import type { CounterPoint } from './domain/counter';
import {
  calculateUsageForecast,
  type ForecastConfidenceEvidence,
} from './domain/forecast';
import { calculateGasUsageForecast } from './domain/gasUsage';
import {
  calculateTariffCost,
  resolveTariffPolicyForCloseMonth,
  tariffCoverageForCloseMonth,
  TariffPolicyError,
  TARIFF_POLICIES,
  type TariffCostResult,
  type TariffPolicyVersion,
} from './domain/tariff';

const RECENT_WINDOW_DAYS = 7;
const DAILY_LIST_LIMIT = 7;
const MILLIUNIT_PER_UNIT = 1_000;

// Utility presentation layer: the Phase B domain results are unit-correct, so
// this layer only maps them into one shared view model for the UI template and
// owns the utility-specific labels, units and the electricity tariff display.

export interface UtilityPresentation {
  kind: UtilityKind;
  label: string;
  counterUnit: string;
  dailyUnit: string;
  flowTitle: string;
  flowUnit: string;
  tariffTitle: string;
  readingPrecisionNote: string;
  defaultMeterName: string;
  tariffFallbackNote: string;
}

export const UTILITY_PRESENTATIONS: Record<UtilityKind, UtilityPresentation> = {
  electricity: {
    kind: 'electricity',
    label: '전기',
    counterUnit: 'kWh',
    dailyUnit: 'kWh/일',
    flowTitle: '평균 소비전력',
    flowUnit: 'W',
    tariffTitle: '예상 전기요금',
    readingPrecisionNote: '기록 시각은 자동 · 소수 3자리(1 Wh)까지',
    defaultMeterName: '우리집 전기',
    tariffFallbackNote: '요금은 아직 계산하지 않습니다. 사용량과 예측은 저장된 원본 기록에서 다시 계산합니다.',
  },
  gas: {
    kind: 'gas',
    label: '가스',
    counterUnit: 'm³',
    dailyUnit: 'm³/일',
    flowTitle: '시간당 사용량',
    flowUnit: 'm³/h',
    tariffTitle: '예상 가스요금',
    readingPrecisionNote: '기록 시각은 자동 · 소수 3자리(0.001 m³)까지',
    defaultMeterName: '우리집 가스',
    tariffFallbackNote: '예상 가스요금은 공급사·지역 공식 요금 근거가 확인되기 전까지 계산하지 않습니다. 사용량과 예측은 저장된 원본 기록에서 다시 계산합니다.',
  },
};

export function presentationFor(kind: UtilityKind): UtilityPresentation {
  return UTILITY_PRESENTATIONS[kind];
}

export const UTILITY_ORDER: readonly UtilityKind[] = ['electricity', 'gas'];

export function formatCounterValue(counter: number): string {
  // Raw fixed-point counter (1/1000 base unit) → decimal display string.
  const whole = Math.floor(counter / MILLIUNIT_PER_UNIT);
  const fraction = counter % MILLIUNIT_PER_UNIT;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(3, '0').replace(/0+$/, '')}`;
}

export function formatFlow(flow: number, presentation: UtilityPresentation): string {
  if (presentation.kind === 'electricity') {
    return `${Math.round(flow).toLocaleString('ko-KR')} ${presentation.flowUnit}`;
  }
  return `${flow.toLocaleString('ko-KR', { maximumFractionDigits: 3 })} ${presentation.flowUnit}`;
}

export interface UtilityDailyUsage {
  localDate: string;
  usage: number;
  interpolated: boolean;
}

export interface UtilityLiveCycle {
  displayStartLocalDate: string;
  displayEndLocalDate: string;
  remainingMs: number;
  closeYear: number;
  closeMonth: number;
}

export interface UtilityCurrentCycle {
  usageToDate: number | null;
  averageDailyUsage: number | null;
  projectedClose: number | null;
  normalized30Day: number | null;
}

export interface UtilityTariffView {
  amount: string;
  note: string;
}

export interface UtilityView {
  latestReadingCounter: number | null;
  latestIntervalUsage: number | null;
  latestIntervalElapsedMs: number | null;
  latestIntervalFlow: number | null;
  liveCycle: UtilityLiveCycle;
  currentCycle: UtilityCurrentCycle | null;
  recentDailyAverage: number | null;
  recentDailyAverageDays: number;
  comparison: { delta: number; percent: number | null } | null;
  confidence: ForecastConfidenceEvidence | null;
  daily: UtilityDailyUsage[];
  tariff: UtilityTariffView | null;
}

function toCounterPoints(readings: readonly ReadingResource[]): CounterPoint[] {
  return readings.map(reading => ({
    measuredAtMs: reading.measuredAtMs,
    cumulativeMilliunit: reading.cumulativeMilliUnit,
  }));
}

function dailyViews(points: readonly CounterPoint[], timeZone: string): UtilityDailyUsage[] {
  const aggregates = new Map<string, { localDate: string; usageMilliunit: number; interpolated: boolean }>();
  for (let index = 1; index < points.length; index += 1) {
    const split = splitCounterIntervalByLocalDate(points[index - 1], points[index], timeZone);
    for (const day of split.days) {
      const current = aggregates.get(day.localDate);
      if (current) {
        current.usageMilliunit += day.usageMilliunit;
        current.interpolated ||= day.provenance === 'interpolated';
      } else {
        aggregates.set(day.localDate, {
          localDate: day.localDate,
          usageMilliunit: day.usageMilliunit,
          interpolated: day.provenance === 'interpolated',
        });
      }
    }
  }
  return [...aggregates.values()]
    .sort((left, right) => right.localDate.localeCompare(left.localDate))
    .slice(0, DAILY_LIST_LIMIT)
    .map(day => ({
      localDate: day.localDate,
      usage: day.usageMilliunit / MILLIUNIT_PER_UNIT,
      interpolated: day.interpolated,
    }));
}

interface RawUtilityForecast {
  latestReadingCounter: number | null;
  latestInterval: { usage: number; elapsedMs: number; flow: number } | null;
  forecastCycle: {
    startMs: number;
    endMs: number;
    usageToDate: number | null;
    averageDailyUsage: number | null;
    projectedClose: number | null;
    normalized30Day: number | null;
    // Exact counter-scale projection, kept only for the electricity tariff.
    projectedCloseCounter?: number | null;
  } | null;
  recentDailyAverage: { usage: number; daysUsed: number } | null;
  comparison: { delta: number; percent: number | null } | null;
  confidence: ForecastConfidenceEvidence | null;
}

function electricRawForecast(meter: MeterResource, points: readonly CounterPoint[]): RawUtilityForecast {
  const electricityPoints = points.map(point => ({
    measuredAtMs: point.measuredAtMs,
    cumulativeWh: point.cumulativeMilliunit,
  }));
  const forecast = calculateUsageForecast(electricityPoints, meter.billingClose, meter.timezone, RECENT_WINDOW_DAYS);
  return {
    latestReadingCounter: forecast.latestReading?.cumulativeWh ?? null,
    latestInterval: forecast.latestInterval === null ? null : {
      usage: forecast.latestInterval.usageKwh,
      elapsedMs: forecast.latestInterval.elapsedMs,
      flow: forecast.latestInterval.averagePowerW,
    },
    forecastCycle: forecast.currentCycle === null ? null : {
      startMs: forecast.currentCycle.cycle.startMs,
      endMs: forecast.currentCycle.cycle.endMs,
      usageToDate: forecast.currentCycle.usageToDateKwh,
      averageDailyUsage: forecast.currentCycle.averageDailyUsageKwh,
      projectedClose: forecast.currentCycle.projectedCloseUsageKwh,
      normalized30Day: forecast.currentCycle.normalized30DayUsageKwh,
      projectedCloseCounter: forecast.currentCycle.projectedCloseUsageWh,
    },
    recentDailyAverage: forecast.recentDailyAverage === null ? null : {
      usage: forecast.recentDailyAverage.usageKwhPerDay,
      daysUsed: forecast.recentDailyAverage.daysUsed,
    },
    comparison: forecast.comparison === null ? null : {
      delta: forecast.comparison.projectedVsPreviousDeltaKwh,
      percent: forecast.comparison.projectedVsPreviousPercent,
    },
    confidence: forecast.confidence,
  };
}

function gasRawForecast(meter: MeterResource, points: readonly CounterPoint[]): RawUtilityForecast {
  const forecast = calculateGasUsageForecast(points, meter.billingClose, meter.timezone, RECENT_WINDOW_DAYS);
  return {
    latestReadingCounter: forecast.latestReading?.cumulativeMilliunit ?? null,
    latestInterval: forecast.latestInterval === null ? null : {
      usage: forecast.latestInterval.usageM3,
      elapsedMs: forecast.latestInterval.elapsedMs,
      flow: forecast.latestInterval.averageM3PerHour,
    },
    forecastCycle: forecast.currentCycle === null ? null : {
      startMs: forecast.currentCycle.cycle.startMs,
      endMs: forecast.currentCycle.cycle.endMs,
      usageToDate: forecast.currentCycle.usageToDateM3,
      averageDailyUsage: forecast.currentCycle.averageDailyUsageM3,
      projectedClose: forecast.currentCycle.projectedCloseUsageM3,
      normalized30Day: forecast.currentCycle.normalized30DayUsageM3,
    },
    recentDailyAverage: forecast.recentDailyAverage === null ? null : {
      usage: forecast.recentDailyAverage.usageM3PerDay,
      daysUsed: forecast.recentDailyAverage.daysUsed,
    },
    comparison: forecast.comparison === null ? null : {
      delta: forecast.comparison.projectedVsPreviousDeltaM3,
      percent: forecast.comparison.projectedVsPreviousPercent,
    },
    confidence: forecast.confidence,
  };
}

export function utilityView(
  meter: MeterResource,
  readings: readonly ReadingResource[],
  nowMs: number,
): UtilityView {
  const points = toCounterPoints(readings);
  const live = getBillingCycleContext(nowMs, meter.billingClose, meter.timezone);
  const raw = meter.utilityKind === 'gas'
    ? gasRawForecast(meter, points)
    : electricRawForecast(meter, points);

  const currentCycle = raw.forecastCycle !== null
    && raw.forecastCycle.startMs === live.current.startMs
    && raw.forecastCycle.endMs === live.current.endMs
    ? {
        usageToDate: raw.forecastCycle.usageToDate,
        averageDailyUsage: raw.forecastCycle.averageDailyUsage,
        projectedClose: raw.forecastCycle.projectedClose,
        normalized30Day: raw.forecastCycle.normalized30Day,
      }
    : null;

  const tariff = meter.utilityKind === 'gas'
    ? null
    : tariffDisplay(
        live.current.closeYear,
        live.current.closeMonth,
        currentCycle === null ? null : raw.forecastCycle?.projectedCloseCounter ?? null,
      );

  return {
    latestReadingCounter: raw.latestReadingCounter,
    latestIntervalUsage: raw.latestInterval?.usage ?? null,
    latestIntervalElapsedMs: raw.latestInterval?.elapsedMs ?? null,
    latestIntervalFlow: raw.latestInterval?.flow ?? null,
    liveCycle: {
      displayStartLocalDate: live.current.displayStartLocalDate,
      displayEndLocalDate: live.current.displayEndLocalDate,
      remainingMs: live.remainingMs,
      closeYear: live.current.closeYear,
      closeMonth: live.current.closeMonth,
    },
    currentCycle,
    recentDailyAverage: raw.recentDailyAverage?.usage ?? null,
    recentDailyAverageDays: raw.recentDailyAverage?.daysUsed ?? 0,
    comparison: currentCycle === null ? null : raw.comparison,
    confidence: currentCycle === null ? null : raw.confidence,
    daily: dailyViews(points, meter.timezone),
    tariff,
  };
}

interface TariffFuelWindowLike {
  rateTenthWonPerKwh: number | null;
  appliesFromCloseMonth: string;
  appliesToCloseMonth: string | null;
}

function tariffFuelWindowText(fuel: TariffFuelWindowLike): string {
  const rateTenthWon = fuel.rateTenthWonPerKwh ?? 0;
  const sign = rateTenthWon > 0 ? '+' : '';
  const rate = `${sign}${(rateTenthWon / 10).toFixed(1)}원/kWh`;
  const window = fuel.appliesToCloseMonth === null
    ? `${fuel.appliesFromCloseMonth}부터`
    : `${fuel.appliesFromCloseMonth}~${fuel.appliesToCloseMonth}`;
  return `연료비조정요금은 ${window} 고지 단가 ${rate}를 적용합니다.`;
}

function tariffNote(
  policy: TariffPolicyVersion,
  includedComponentLabels: readonly string[],
  excludedComponents: readonly string[],
  fuelAdjustment: TariffFuelWindowLike | null,
): string {
  const included = ['기본요금', '전력량요금', ...includedComponentLabels].join('·');
  const parts = [`요금은 ${policy.label} (확인일 ${policy.confirmedOn}) 기준으로 ${included} 항목을 더한 예상 전기요금입니다.`];
  if (fuelAdjustment) parts.push(tariffFuelWindowText(fuelAdjustment));
  if (excludedComponents.length) parts.push(`${excludedComponents.join('·')} 항목은 미반영입니다.`);
  parts.push('사용량과 예측은 저장된 원본 기록에서 다시 계산합니다.');
  return parts.join(' ');
}

function tariffDisplay(closeYear: number, closeMonth: number, projectedUsageWh: number | null): UtilityTariffView | null {
  let policy;
  try {
    policy = resolveTariffPolicyForCloseMonth(TARIFF_POLICIES, closeYear, closeMonth);
  } catch (error) {
    if (error instanceof TariffPolicyError) return null;
    throw error;
  }
  let cost: TariffCostResult | null = null;
  if (projectedUsageWh !== null) {
    try {
      cost = calculateTariffCost(TARIFF_POLICIES, { closeYear, closeMonth, usageWh: Math.round(projectedUsageWh) });
    } catch (error) {
      if (!(error instanceof TariffPolicyError)) throw error;
    }
  }
  if (cost) {
    const fuel = cost.appliedComponents.find(component => component.componentId === 'fuelAdjustment') ?? null;
    return {
      amount: `${cost.estimatedTotalWon.toLocaleString('ko-KR')} 원`,
      note: tariffNote(policy, cost.appliedComponents.map(component => component.label), cost.excludedComponents, fuel),
    };
  }
  const coverage = tariffCoverageForCloseMonth(closeYear, closeMonth);
  return {
    amount: '자료 부족',
    note: tariffNote(policy, coverage.includedComponentLabels, [...policy.excludedComponents, ...coverage.uncoveredComponentLabels], coverage.fuelAdjustment),
  };
}
