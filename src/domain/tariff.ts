// Tariff policy is owned separately from the pure usage domain (AGENTS.md):
// it only consumes integer Wh totals and billed months and never imports
// usage, billing, or calendar internals.

export type TariffPolicyErrorCode =
  | 'INVALID_TARIFF_POLICY'
  | 'NO_TARIFF_POLICY_VERSION'
  | 'NO_TARIFF_SEASON'
  | 'INVALID_TARIFF_USAGE';

export class TariffPolicyError extends Error {
  readonly code: TariffPolicyErrorCode;

  constructor(code: TariffPolicyErrorCode, message: string) {
    super(message);
    this.name = 'TariffPolicyError';
    this.code = code;
  }
}

/**
 * One progressive usage band. `upToKwh: null` marks the open top band and is
 * only allowed on the last band of a season. The superuser surcharge band
 * reuses the top base fee because 별표1 defines no additional base fee band.
 */
export interface TariffBand {
  upToKwh: number | null;
  baseFeeWonPerHousehold: number;
  energyTenthWonPerKwh: number;
}

/** Season rule selected by the billed (close) month of the metering cycle. */
export interface TariffSeasonRule {
  seasonId: string;
  closeMonths: readonly number[];
  bands: readonly TariffBand[];
}

export interface TariffPolicyVersion {
  versionId: string;
  label: string;
  /** Inclusive billed month 'YYYY-MM' from which this revision applies. */
  appliesFromCloseMonth: string;
  /** Inclusive billed month 'YYYY-MM' until which this revision applies; null = no later revision verified. */
  appliesToCloseMonth: string | null;
  /** 'YYYY-MM-DD' the repository last verified the source evidence for these figures. */
  confirmedOn: string;
  sources: readonly string[];
  seasons: readonly TariffSeasonRule[];
  /** Official monthly minimum electricity charge (월간 최저요금) in won; null when none is defined. */
  minimumElectricityChargeWon: number | null;
  /** Bill components this revision deliberately does not represent. */
  excludedComponents: readonly string[];
}

/**
 * A per-kWh bill component whose rate has its own verified effective window
 * (기후환경요금 단가, 분기별 연료비조정단가). Rates are signed in 0.1 won/kWh.
 */
export interface TariffPerKwhComponent {
  componentId: 'climateEnvironment' | 'fuelAdjustment';
  label: string;
  rateTenthWonPerKwh: number;
  appliesFromCloseMonth: string;
  appliesToCloseMonth: string | null;
  source: string;
  confirmedOn: string;
}

/**
 * One statutory levy window. `rateBasisPoints` is the rate against the
 * electricity charge (전기요금) in basis points; rounding is the officially
 * applied won-level rule verified from KEPCO's published calculation formula.
 */
export interface TariffTaxRateWindow {
  taxId: 'valueAddedTax' | 'electricityIndustryFoundationFund';
  label: string;
  rateBasisPoints: number;
  rounding: 'won-half-up' | 'ten-won-truncate';
  appliesFromCloseMonth: string;
  appliesToCloseMonth: string | null;
  source: string;
  confirmedOn: string;
}

export interface TariffCostInput {
  closeYear: number;
  closeMonth: number;
  /** Non-negative safe integer total billed usage. */
  usageWh: number;
}

export interface TariffAppliedComponent {
  componentId: string;
  label: string;
  won: number;
  rateTenthWonPerKwh: number | null;
  rateBasisPoints: number | null;
  appliesFromCloseMonth: string;
  appliesToCloseMonth: string | null;
  source: string;
  confirmedOn: string;
}

export interface TariffCostResult {
  policyVersionId: string;
  label: string;
  seasonId: string;
  closeYearMonth: string;
  usageWh: number;
  usageKwh: number;
  baseFeeWon: number;
  energyFeeWon: number;
  /** baseFeeWon + energyFeeWon. Kept for continuity; not a bill total. */
  subtotalWon: number;
  /** Components beyond base+energy that this billed month actually applies. */
  appliedComponents: readonly TariffAppliedComponent[];
  /** 전기요금 = subtotal + covered per-kWh components, floored at the official monthly minimum. */
  electricityChargeWon: number;
  /** 전기요금 + 부가가치세 + 전력산업기반기금 with the official sub-10-won truncation. */
  estimatedTotalWon: number;
  /** Components deliberately not represented for this billed month. */
  excludedComponents: readonly string[];
  confirmedOn: string;
  sources: readonly string[];
}

const WH_PER_KWH = 1_000;
const MAX_USAGE_KWH = 1_000_000_000;
const MAX_USAGE_WH = MAX_USAGE_KWH * WH_PER_KWH;
const MAX_BAND_KWH = MAX_USAGE_KWH;
const MAX_ENERGY_TENTH_WON_PER_KWH = 1_000_000;
const MAX_PER_KWH_TENTH_WON = 10_000;
const MAX_RATE_BASIS_POINTS = 10_000;
const CLOSE_MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const UNBOUNDED_CLOSE_MONTH = '9999-12';
const WON_NUMERATOR = 10_000n;
const PER_KWH_COMPONENT_IDS = ['climateEnvironment', 'fuelAdjustment'] as const;
const TAX_IDS = ['valueAddedTax', 'electricityIndustryFoundationFund'] as const;

export const TARIFF_POLICIES: readonly TariffPolicyVersion[] = [
  {
    versionId: 'residential-low-2023-11-09',
    label: '주택용(저압) 2023-11-09 개정적용',
    appliesFromCloseMonth: '2023-11',
    appliesToCloseMonth: null,
    confirmedOn: '2026-09-09',
    sources: [
      'https://cyber.kepco.co.kr/ckepco/front/jsp/CY/D/C/CYDCHP00401.jsp',
      'https://cyber.kepco.co.kr/ckepco/front/jsp/CY/E/E/CYEEHP00101.jsp',
      'https://easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=1008&ccfNo=2&cciNo=1&cnpClsNo=1',
    ],
    minimumElectricityChargeWon: 1_000,
    seasons: [
      {
        seasonId: 'summer',
        closeMonths: [7, 8],
        bands: [
          { upToKwh: 300, baseFeeWonPerHousehold: 910, energyTenthWonPerKwh: 1_200 },
          { upToKwh: 450, baseFeeWonPerHousehold: 1_600, energyTenthWonPerKwh: 2_146 },
          { upToKwh: 1_000, baseFeeWonPerHousehold: 7_300, energyTenthWonPerKwh: 3_073 },
          { upToKwh: null, baseFeeWonPerHousehold: 7_300, energyTenthWonPerKwh: 7_362 },
        ],
      },
      {
        seasonId: 'winter',
        closeMonths: [12, 1, 2],
        bands: [
          { upToKwh: 200, baseFeeWonPerHousehold: 910, energyTenthWonPerKwh: 1_200 },
          { upToKwh: 400, baseFeeWonPerHousehold: 1_600, energyTenthWonPerKwh: 2_146 },
          { upToKwh: 1_000, baseFeeWonPerHousehold: 7_300, energyTenthWonPerKwh: 3_073 },
          { upToKwh: null, baseFeeWonPerHousehold: 7_300, energyTenthWonPerKwh: 7_362 },
        ],
      },
      {
        seasonId: 'other',
        closeMonths: [3, 4, 5, 6, 9, 10, 11],
        bands: [
          { upToKwh: 200, baseFeeWonPerHousehold: 910, energyTenthWonPerKwh: 1_200 },
          { upToKwh: 400, baseFeeWonPerHousehold: 1_600, energyTenthWonPerKwh: 2_146 },
          { upToKwh: null, baseFeeWonPerHousehold: 7_300, energyTenthWonPerKwh: 3_073 },
        ],
      },
    ],
    excludedComponents: [
      '복지할인(구 필수사용량보장공제)',
      'TV수신료',
    ],
  },
];

// 기후환경요금: 기본공급약관 별표7 운영지침 부칙(2022-12-30)이 2023-01-01부터 9.0원/kWh로
// 정하고 이후 단가 변경 부칙은 없다. 2026-09-09에 현행 약관 별표7에서 직접 확인.
// 연료비조정요금: 분기별 한전 고지 단가만 적용한다(별표8 운영지침). 고지되지 않은 분기는
// 직전 값을 자동 연장하지 않고 미커버로 둔다.
export const TARIFF_PER_KWH_COMPONENTS: readonly TariffPerKwhComponent[] = [
  {
    componentId: 'climateEnvironment',
    label: '기후환경요금',
    rateTenthWonPerKwh: 90,
    appliesFromCloseMonth: '2023-01',
    appliesToCloseMonth: null,
    source: 'https://cyber.kepco.co.kr/ckepco/front/jsp/CY/D/C/CYDCHP00408.jsp (기본공급약관 별표7, 2023-01-01부터 9.0원/kWh)',
    confirmedOn: '2026-09-09',
  },
  {
    componentId: 'fuelAdjustment',
    label: '연료비조정요금',
    rateTenthWonPerKwh: 50,
    appliesFromCloseMonth: '2026-04',
    appliesToCloseMonth: '2026-06',
    source: 'https://online.kepco.co.kr/PRM004D00 (한전ON 고지: 2026년 3분기 단가가 2분기와 동일한 5.0원/kWh로 계속 적용)',
    confirmedOn: '2026-09-09',
  },
  {
    componentId: 'fuelAdjustment',
    label: '연료비조정요금',
    rateTenthWonPerKwh: 50,
    appliesFromCloseMonth: '2026-07',
    appliesToCloseMonth: '2026-09',
    source: 'https://www.kepco.co.kr/home/media/newsroom/notice/boardView.do?boardMngNo=14&boardNo=2673 (2026년 3분기 연료비조정단가 산정내역, 2026-06-19)',
    confirmedOn: '2026-09-09',
  },
];

// 부가가치세는 전기요금(기본+전력량+기후환경+연료비)을 과세기준으로 하고 원 단위 미만 4사5입,
// 전력산업기반기금은 전기요금에 요율을 곱하고 10원 미만 절사한다(한전ON 공식 계산식,
// 2023-11-09 시행 주택용(저압) 공식 요금표 PDF). 기금은 VAT 과세대상에서 제외된다.
// 기금 요율은 3.7%(2023-11 시점) → 3.2%(2024-07) → 2.7%(2025-07~)로 분기 창을 둔다.
export const TARIFF_TAX_RATES: readonly TariffTaxRateWindow[] = [
  {
    taxId: 'valueAddedTax',
    label: '부가가치세',
    rateBasisPoints: 1_000,
    rounding: 'won-half-up',
    appliesFromCloseMonth: '2023-11',
    appliesToCloseMonth: null,
    source: 'https://www.law.go.kr/법령/부가가치세법/제30조 (세율 10%); https://online.kepco.co.kr/PRM033D00 (과세기준 전기요금, 원단위 미만 4사5입)',
    confirmedOn: '2026-09-09',
  },
  {
    taxId: 'electricityIndustryFoundationFund',
    label: '전력산업기반기금',
    rateBasisPoints: 370,
    rounding: 'ten-won-truncate',
    appliesFromCloseMonth: '2023-11',
    appliesToCloseMonth: '2024-06',
    source: '한전 2023-11-09 시행 주택용(저압) 공식 요금표 PDF (전기요금의 3.7%, 10원 미만 절사); https://www.korea.kr/news/policyNewsView.do?newsId=148929635 (3.7%→3.2% 인하 일정)',
    confirmedOn: '2026-09-09',
  },
  {
    taxId: 'electricityIndustryFoundationFund',
    label: '전력산업기반기금',
    rateBasisPoints: 320,
    rounding: 'ten-won-truncate',
    appliesFromCloseMonth: '2024-07',
    appliesToCloseMonth: '2025-06',
    source: 'https://www.korea.kr/news/policyNewsView.do?newsId=148929635 (2024년 7월부터 3.2% 적용)',
    confirmedOn: '2026-09-09',
  },
  {
    taxId: 'electricityIndustryFoundationFund',
    label: '전력산업기반기금',
    rateBasisPoints: 270,
    rounding: 'ten-won-truncate',
    appliesFromCloseMonth: '2025-07',
    appliesToCloseMonth: null,
    source: 'https://www.law.go.kr/법령/전기사업법 시행령/제36조 (전기요금의 1천분의 27); https://online.kepco.co.kr/PRM004D00 (10원 미만 절사)',
    confirmedOn: '2026-09-09',
  },
];

export function validateTariffPolicies(policies: readonly TariffPolicyVersion[]): void {
  const seen: TariffPolicyVersion[] = [];
  for (const policy of policies) {
    if (!policy.versionId || !policy.label || !policy.sources.length || !policy.confirmedOn) {
      throw new TariffPolicyError('INVALID_TARIFF_POLICY', 'Policy versions need identity, sources, and a confirmation date.');
    }
    if (policy.minimumElectricityChargeWon !== null
      && (!Number.isSafeInteger(policy.minimumElectricityChargeWon) || policy.minimumElectricityChargeWon < 0)) {
      throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Policy ${policy.versionId} minimum charge must be a non-negative safe integer or null.`);
    }
    validateCloseMonthValue(policy.appliesFromCloseMonth, policy.versionId);
    if (policy.appliesToCloseMonth !== null) {
      validateCloseMonthValue(policy.appliesToCloseMonth, policy.versionId);
      if (policy.appliesToCloseMonth < policy.appliesFromCloseMonth) {
        throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Policy ${policy.versionId} ends before it starts.`);
      }
    }
    for (const previous of seen) {
      if (closeMonthWindowsOverlap(previous, policy)) {
        throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Policies ${previous.versionId} and ${policy.versionId} overlap.`);
      }
    }
    if (policy.seasons.length === 0) {
      throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Policy ${policy.versionId} needs at least one season.`);
    }
    const coveredMonths = new Set<number>();
    for (const season of policy.seasons) {
      validateSeasonRule(policy.versionId, season, coveredMonths);
    }
    if (coveredMonths.size !== 12) {
      throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Policy ${policy.versionId} seasons must cover all twelve billed months.`);
    }
    seen.push(policy);
  }
}

export function validateTariffPerKwhComponents(components: readonly TariffPerKwhComponent[]): void {
  const seenByComponentId = new Map<string, TariffPerKwhComponent[]>();
  for (const component of components) {
    if (!PER_KWH_COMPONENT_IDS.includes(component.componentId)) {
      throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Unknown per-kWh component id ${component.componentId}.`);
    }
    if (!component.label || !component.source || !component.confirmedOn) {
      throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Per-kWh component ${component.componentId} needs a label, source, and confirmation date.`);
    }
    if (!Number.isInteger(component.rateTenthWonPerKwh)
      || Math.abs(component.rateTenthWonPerKwh) > MAX_PER_KWH_TENTH_WON) {
      throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Per-kWh component ${component.componentId} rate must be an integer within ±${MAX_PER_KWH_TENTH_WON} (0.1 won per kWh).`);
    }
    validateCloseMonthValue(component.appliesFromCloseMonth, component.componentId);
    if (component.appliesToCloseMonth !== null) {
      validateCloseMonthValue(component.appliesToCloseMonth, component.componentId);
      if (component.appliesToCloseMonth < component.appliesFromCloseMonth) {
        throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Per-kWh component ${component.componentId} window ends before it starts.`);
      }
    }
    const seen = seenByComponentId.get(component.componentId) ?? [];
    for (const previous of seen) {
      if (closeMonthWindowsOverlap(previous, component)) {
        throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Per-kWh component ${component.componentId} windows overlap.`);
      }
    }
    seen.push(component);
    seenByComponentId.set(component.componentId, seen);
  }
}

export function validateTariffTaxRates(taxRates: readonly TariffTaxRateWindow[]): void {
  const seenByTaxId = new Map<string, TariffTaxRateWindow[]>();
  for (const taxRate of taxRates) {
    if (!TAX_IDS.includes(taxRate.taxId)) {
      throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Unknown tax id ${taxRate.taxId}.`);
    }
    if (!taxRate.label || !taxRate.source || !taxRate.confirmedOn) {
      throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Tax window ${taxRate.taxId} needs a label, source, and confirmation date.`);
    }
    if (!Number.isInteger(taxRate.rateBasisPoints) || taxRate.rateBasisPoints <= 0 || taxRate.rateBasisPoints > MAX_RATE_BASIS_POINTS) {
      throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Tax window ${taxRate.taxId} rate must be a basis-point integer from 1 through ${MAX_RATE_BASIS_POINTS}.`);
    }
    if (taxRate.rounding !== 'won-half-up' && taxRate.rounding !== 'ten-won-truncate') {
      throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Tax window ${taxRate.taxId} has an unverified rounding rule.`);
    }
    validateCloseMonthValue(taxRate.appliesFromCloseMonth, taxRate.taxId);
    if (taxRate.appliesToCloseMonth !== null) {
      validateCloseMonthValue(taxRate.appliesToCloseMonth, taxRate.taxId);
      if (taxRate.appliesToCloseMonth < taxRate.appliesFromCloseMonth) {
        throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Tax window ${taxRate.taxId} ends before it starts.`);
      }
    }
    const seen = seenByTaxId.get(taxRate.taxId) ?? [];
    for (const previous of seen) {
      if (closeMonthWindowsOverlap(previous, taxRate)) {
        throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Tax windows for ${taxRate.taxId} overlap.`);
      }
    }
    seen.push(taxRate);
    seenByTaxId.set(taxRate.taxId, seen);
  }
}

export function resolveTariffPolicyForCloseMonth(
  policies: readonly TariffPolicyVersion[],
  closeYear: number,
  closeMonth: number,
): TariffPolicyVersion {
  const closeYearMonth = formatCloseYearMonth(closeYear, closeMonth);
  validateTariffPolicies(policies);
  const policy = policies.find(candidate =>
    candidate.appliesFromCloseMonth <= closeYearMonth
    && (candidate.appliesToCloseMonth === null || closeYearMonth <= candidate.appliesToCloseMonth));
  if (!policy) {
    throw new TariffPolicyError(
      'NO_TARIFF_POLICY_VERSION',
      `No verified tariff policy covers billed month ${closeYearMonth}.`,
    );
  }
  return policy;
}

export function calculateTariffCost(
  policies: readonly TariffPolicyVersion[],
  input: TariffCostInput,
): TariffCostResult {
  validateCostInput(input);
  validateTariffPerKwhComponents(TARIFF_PER_KWH_COMPONENTS);
  validateTariffTaxRates(TARIFF_TAX_RATES);
  const policy = resolveTariffPolicyForCloseMonth(policies, input.closeYear, input.closeMonth);
  const closeYearMonth = formatCloseYearMonth(input.closeYear, input.closeMonth);
  const season = policy.seasons.find(candidate => candidate.closeMonths.includes(input.closeMonth));
  if (!season) {
    throw new TariffPolicyError(
      'NO_TARIFF_SEASON',
      `Policy ${policy.versionId} has no season for billed month ${closeYearMonth}.`,
    );
  }

  let baseFeeWon: number | null = null;
  let energyNumerator = 0n;
  let bandStartWh = 0;
  for (const band of season.bands) {
    const bandEndWh = band.upToKwh === null ? Number.POSITIVE_INFINITY : band.upToKwh * WH_PER_KWH;
    const bandWh = Math.max(0, Math.min(input.usageWh, bandEndWh) - bandStartWh);
    if (baseFeeWon === null && input.usageWh <= bandEndWh) {
      baseFeeWon = band.baseFeeWonPerHousehold;
    }
    energyNumerator += BigInt(bandWh) * BigInt(band.energyTenthWonPerKwh);
    bandStartWh = bandEndWh;
  }
  if (baseFeeWon === null) {
    throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Policy ${policy.versionId} has no open top band.`);
  }

  // Band energy costs accumulate exactly in 1/10000 won units and round half-up once.
  const energyFeeWon = Number(divideHalfUp(energyNumerator, WON_NUMERATOR));
  if (!Number.isSafeInteger(energyFeeWon)) {
    throw new TariffPolicyError('INVALID_TARIFF_USAGE', 'Tariff calculation overflows the safe integer won range.');
  }
  const subtotalWon = baseFeeWon + energyFeeWon;

  const appliedComponents: TariffAppliedComponent[] = [];
  const excludedComponents = [...policy.excludedComponents];
  let perKwhChargeWon = 0;
  for (const componentId of PER_KWH_COMPONENT_IDS) {
    const component = findCoveredPerKwhComponent(TARIFF_PER_KWH_COMPONENTS, componentId, closeYearMonth);
    if (!component) {
      excludedComponents.push(componentLabelFor(componentId));
      continue;
    }
    const numerator = BigInt(input.usageWh) * BigInt(component.rateTenthWonPerKwh);
    const won = Number(divideHalfUp(numerator, WON_NUMERATOR));
    appliedComponents.push(toAppliedComponent(component.componentId, component, won));
    perKwhChargeWon += won;
  }

  // 별표1: 월간 최저요금 applies to the electricity charge before levies.
  const minimumChargeWon = policy.minimumElectricityChargeWon ?? 0;
  const electricityChargeWon = Math.max(minimumChargeWon, subtotalWon + perKwhChargeWon);

  let vatWon = 0;
  const vatRate = findCoveredTaxRate(TARIFF_TAX_RATES, 'valueAddedTax', closeYearMonth);
  if (vatRate) {
    vatWon = taxComponentWon(electricityChargeWon, vatRate);
    appliedComponents.push(toTaxAppliedComponent(vatRate, vatWon));
  } else {
    excludedComponents.push('부가가치세');
  }

  let fundWon = 0;
  const fundRate = findCoveredTaxRate(TARIFF_TAX_RATES, 'electricityIndustryFoundationFund', closeYearMonth);
  if (fundRate) {
    fundWon = taxComponentWon(electricityChargeWon, fundRate);
    appliedComponents.push(toTaxAppliedComponent(fundRate, fundWon));
  } else {
    excludedComponents.push('전력산업기반기금');
  }

  // 약관 제7조②/한전ON 계산식: the billed total drops its sub-10-won tail.
  const estimatedTotalWon = Math.floor((electricityChargeWon + vatWon + fundWon) / 10) * 10;

  return {
    policyVersionId: policy.versionId,
    label: policy.label,
    seasonId: season.seasonId,
    closeYearMonth,
    usageWh: input.usageWh,
    usageKwh: input.usageWh / WH_PER_KWH,
    baseFeeWon,
    energyFeeWon,
    subtotalWon,
    appliedComponents,
    electricityChargeWon,
    estimatedTotalWon,
    excludedComponents,
    confirmedOn: policy.confirmedOn,
    sources: [...policy.sources],
  };
}

export interface TariffCoverage {
  /** Covered per-kWh/tax component labels for this billed month, in bill order. */
  includedComponentLabels: readonly string[];
  /** Component labels with no verified window for this billed month. */
  uncoveredComponentLabels: readonly string[];
  /** The covered fuel adjustment entry, or null when the quarter is unverified. */
  fuelAdjustment: TariffPerKwhComponent | null;
}

/**
 * Which bill components this billed month would apply, independent of any
 * usage value (used by the UI for provenance and the no-usage-yet state).
 */
export function tariffCoverageForCloseMonth(closeYear: number, closeMonth: number): TariffCoverage {
  const closeYearMonth = formatCloseYearMonth(closeYear, closeMonth);
  validateTariffPerKwhComponents(TARIFF_PER_KWH_COMPONENTS);
  validateTariffTaxRates(TARIFF_TAX_RATES);
  const includedComponentLabels: string[] = [];
  const uncoveredComponentLabels: string[] = [];
  let fuelAdjustment: TariffPerKwhComponent | null = null;
  for (const componentId of PER_KWH_COMPONENT_IDS) {
    const component = findCoveredPerKwhComponent(TARIFF_PER_KWH_COMPONENTS, componentId, closeYearMonth);
    if (component) {
      includedComponentLabels.push(component.label);
      if (componentId === 'fuelAdjustment') fuelAdjustment = component;
    } else {
      uncoveredComponentLabels.push(componentLabelFor(componentId));
    }
  }
  for (const taxId of TAX_IDS) {
    const taxRate = findCoveredTaxRate(TARIFF_TAX_RATES, taxId, closeYearMonth);
    if (taxRate) {
      includedComponentLabels.push(taxRate.label);
    } else {
      uncoveredComponentLabels.push(taxId === 'valueAddedTax' ? '부가가치세' : '전력산업기반기금');
    }
  }
  return { includedComponentLabels, uncoveredComponentLabels, fuelAdjustment };
}

function componentLabelFor(componentId: string): string {
  return componentId === 'climateEnvironment' ? '기후환경요금' : '연료비조정요금';
}

function findCoveredPerKwhComponent(
  components: readonly TariffPerKwhComponent[],
  componentId: string,
  closeYearMonth: string,
): TariffPerKwhComponent | undefined {
  return components.find(component =>
    component.componentId === componentId && closeMonthWindowCovers(component, closeYearMonth));
}

function findCoveredTaxRate(
  taxRates: readonly TariffTaxRateWindow[],
  taxId: string,
  closeYearMonth: string,
): TariffTaxRateWindow | undefined {
  return taxRates.find(taxRate =>
    taxRate.taxId === taxId && closeMonthWindowCovers(taxRate, closeYearMonth));
}

function closeMonthWindowCovers(entry: { appliesFromCloseMonth: string; appliesToCloseMonth: string | null }, closeYearMonth: string): boolean {
  return entry.appliesFromCloseMonth <= closeYearMonth
    && (entry.appliesToCloseMonth === null || closeYearMonth <= entry.appliesToCloseMonth);
}

function taxComponentWon(electricityChargeWon: number, rate: TariffTaxRateWindow): number {
  const numerator = BigInt(electricityChargeWon) * BigInt(rate.rateBasisPoints);
  if (rate.rounding === 'won-half-up') {
    return Number(divideHalfUp(numerator, WON_NUMERATOR));
  }
  // ten-won truncation: floor to the nearest 10 won after applying the rate.
  return Number(numerator / 100_000n) * 10;
}

function toAppliedComponent(
  componentId: string,
  component: TariffPerKwhComponent,
  won: number,
): TariffAppliedComponent {
  return {
    componentId,
    label: component.label,
    won,
    rateTenthWonPerKwh: component.rateTenthWonPerKwh,
    rateBasisPoints: null,
    appliesFromCloseMonth: component.appliesFromCloseMonth,
    appliesToCloseMonth: component.appliesToCloseMonth,
    source: component.source,
    confirmedOn: component.confirmedOn,
  };
}

function toTaxAppliedComponent(rate: TariffTaxRateWindow, won: number): TariffAppliedComponent {
  return {
    componentId: rate.taxId,
    label: rate.label,
    won,
    rateTenthWonPerKwh: null,
    rateBasisPoints: rate.rateBasisPoints,
    appliesFromCloseMonth: rate.appliesFromCloseMonth,
    appliesToCloseMonth: rate.appliesToCloseMonth,
    source: rate.source,
    confirmedOn: rate.confirmedOn,
  };
}

/** Half-up division for signed BigInt numerators (4사5입 away from zero). */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const half = denominator / 2n;
  if (numerator >= 0n) {
    return (numerator + half) / denominator;
  }
  return -((-numerator + half) / denominator);
}

function validateCostInput(input: TariffCostInput): void {
  if (!Number.isSafeInteger(input.closeYear) || input.closeYear < 1 || input.closeYear > 9999) {
    throw new TariffPolicyError('INVALID_TARIFF_USAGE', 'Billed close year must be an integer between 1 and 9999.');
  }
  if (!Number.isInteger(input.closeMonth) || input.closeMonth < 1 || input.closeMonth > 12) {
    throw new TariffPolicyError('INVALID_TARIFF_USAGE', 'Billed close month must be an integer from 1 through 12.');
  }
  if (!Number.isSafeInteger(input.usageWh) || input.usageWh < 0 || input.usageWh > MAX_USAGE_WH) {
    throw new TariffPolicyError('INVALID_TARIFF_USAGE', 'Billed usage must be a non-negative safe integer Wh total.');
  }
}

function validateSeasonRule(
  versionId: string,
  season: TariffSeasonRule,
  coveredMonths: Set<number>,
): void {
  if (!season.seasonId || season.closeMonths.length === 0 || season.bands.length === 0) {
    throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Policy ${versionId} has an incomplete season rule.`);
  }
  for (const month of season.closeMonths) {
    if (!Number.isInteger(month) || month < 1 || month > 12 || coveredMonths.has(month)) {
      throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Policy ${versionId} season months must be unique integers 1..12.`);
    }
    coveredMonths.add(month);
  }

  let previousUpperKwh = 0;
  season.bands.forEach((band, index) => {
    const isLast = index === season.bands.length - 1;
    if (band.upToKwh === null) {
      if (!isLast) {
        throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Policy ${versionId} only the last band may be open.`);
      }
    } else {
      if (!Number.isSafeInteger(band.upToKwh) || band.upToKwh <= previousUpperKwh || band.upToKwh > MAX_BAND_KWH) {
        throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Policy ${versionId} band bounds must ascend within the supported usage range.`);
      }
      previousUpperKwh = band.upToKwh;
    }
    if (!Number.isSafeInteger(band.baseFeeWonPerHousehold) || band.baseFeeWonPerHousehold < 0) {
      throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Policy ${versionId} base fees must be non-negative safe integers.`);
    }
    if (!Number.isSafeInteger(band.energyTenthWonPerKwh) || band.energyTenthWonPerKwh < 0 || band.energyTenthWonPerKwh > MAX_ENERGY_TENTH_WON_PER_KWH) {
      throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Policy ${versionId} energy prices must be non-negative safe integers in 0.1 won per kWh.`);
    }
  });
}

function validateCloseMonthValue(value: string, versionId: string): void {
  if (!CLOSE_MONTH_PATTERN.test(value)) {
    throw new TariffPolicyError('INVALID_TARIFF_POLICY', `Policy ${versionId} billed months must use the YYYY-MM format.`);
  }
}

interface CloseMonthWindow {
  appliesFromCloseMonth: string;
  appliesToCloseMonth: string | null;
}

function closeMonthWindowsOverlap(left: CloseMonthWindow, right: CloseMonthWindow): boolean {
  const leftEnd = left.appliesToCloseMonth ?? UNBOUNDED_CLOSE_MONTH;
  const rightEnd = right.appliesToCloseMonth ?? UNBOUNDED_CLOSE_MONTH;
  return left.appliesFromCloseMonth <= rightEnd && right.appliesFromCloseMonth <= leftEnd;
}

function formatCloseYearMonth(closeYear: number, closeMonth: number): string {
  if (!Number.isSafeInteger(closeYear) || closeYear < 1 || closeYear > 9999) {
    throw new TariffPolicyError('INVALID_TARIFF_USAGE', 'Billed close year must be an integer between 1 and 9999.');
  }
  if (!Number.isInteger(closeMonth) || closeMonth < 1 || closeMonth > 12) {
    throw new TariffPolicyError('INVALID_TARIFF_USAGE', 'Billed close month must be an integer from 1 through 12.');
  }
  return `${closeYear}-${String(closeMonth).padStart(2, '0')}`;
}
