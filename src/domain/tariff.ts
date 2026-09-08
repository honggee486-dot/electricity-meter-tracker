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
 * only allowed on the last band of a season.
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
  /** Bill components this revision deliberately does not represent. */
  excludedComponents: readonly string[];
}

export interface TariffCostInput {
  closeYear: number;
  closeMonth: number;
  /** Non-negative safe integer total billed usage. */
  usageWh: number;
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
  subtotalWon: number;
  excludedComponents: readonly string[];
  confirmedOn: string;
  sources: readonly string[];
}

const WH_PER_KWH = 1_000;
const MAX_USAGE_KWH = 1_000_000_000;
const MAX_USAGE_WH = MAX_USAGE_KWH * WH_PER_KWH;
const MAX_BAND_KWH = MAX_USAGE_KWH;
const MAX_ENERGY_TENTH_WON_PER_KWH = 1_000_000;
const CLOSE_MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const UNBOUNDED_CLOSE_MONTH = '9999-12';

export const TARIFF_POLICIES: readonly TariffPolicyVersion[] = [
  {
    versionId: 'residential-low-2023-11-09',
    label: '주택용(저압) 2023-11-09 개정적용',
    appliesFromCloseMonth: '2023-11',
    appliesToCloseMonth: null,
    confirmedOn: '2026-09-09',
    sources: [
      'https://cyber.kepco.co.kr/ckepco/front/jsp/CY/E/E/CYEEHP00101.jsp',
      'https://easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=1008&ccfNo=2&cciNo=1&cnpClsNo=1',
    ],
    seasons: [
      {
        seasonId: 'summer',
        closeMonths: [7, 8],
        bands: [
          { upToKwh: 300, baseFeeWonPerHousehold: 910, energyTenthWonPerKwh: 1_200 },
          { upToKwh: 450, baseFeeWonPerHousehold: 1_600, energyTenthWonPerKwh: 2_146 },
          { upToKwh: null, baseFeeWonPerHousehold: 7_300, energyTenthWonPerKwh: 3_073 },
        ],
      },
      {
        seasonId: 'other',
        closeMonths: [1, 2, 3, 4, 5, 6, 9, 10, 11, 12],
        bands: [
          { upToKwh: 200, baseFeeWonPerHousehold: 910, energyTenthWonPerKwh: 1_200 },
          { upToKwh: 400, baseFeeWonPerHousehold: 1_600, energyTenthWonPerKwh: 2_146 },
          { upToKwh: null, baseFeeWonPerHousehold: 7_300, energyTenthWonPerKwh: 3_073 },
        ],
      },
    ],
    excludedComponents: [
      '연료비조정요금',
      '기후환경요금',
      '부가가치세',
      '전력산업기반기금',
      '복지할인(구 필수사용량보장공제)',
      '1,000kWh 초과 누진할증',
      '동계 소용량 할인',
      'TV수신료',
    ],
  },
];

export function validateTariffPolicies(policies: readonly TariffPolicyVersion[]): void {
  const seen: TariffPolicyVersion[] = [];
  for (const policy of policies) {
    if (!policy.versionId || !policy.label || !policy.sources.length || !policy.confirmedOn) {
      throw new TariffPolicyError('INVALID_TARIFF_POLICY', 'Policy versions need identity, sources, and a confirmation date.');
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
  const energyFeeBigWon = (energyNumerator + 5_000n) / 10_000n;
  if (energyFeeBigWon > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TariffPolicyError('INVALID_TARIFF_USAGE', 'Tariff calculation overflows the safe integer won range.');
  }
  const energyFeeWon = Number(energyFeeBigWon);

  return {
    policyVersionId: policy.versionId,
    label: policy.label,
    seasonId: season.seasonId,
    closeYearMonth,
    usageWh: input.usageWh,
    usageKwh: input.usageWh / WH_PER_KWH,
    baseFeeWon,
    energyFeeWon,
    subtotalWon: baseFeeWon + energyFeeWon,
    excludedComponents: [...policy.excludedComponents],
    confirmedOn: policy.confirmedOn,
    sources: [...policy.sources],
  };
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

function closeMonthWindowsOverlap(left: TariffPolicyVersion, right: TariffPolicyVersion): boolean {
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
