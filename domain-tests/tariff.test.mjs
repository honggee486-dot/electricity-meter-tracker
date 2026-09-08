import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TariffPolicyError,
  TARIFF_PER_KWH_COMPONENTS,
  TARIFF_POLICIES,
  TARIFF_TAX_RATES,
  calculateTariffCost,
  resolveTariffPolicyForCloseMonth,
  tariffCoverageForCloseMonth,
  validateTariffPerKwhComponents,
  validateTariffPolicies,
  validateTariffTaxRates,
} from '../.domain-test/domain/tariff.js';

const expectCode = code => error => error instanceof TariffPolicyError && error.code === code;

const residentialPolicy = TARIFF_POLICIES[0];

const componentById = (cost, componentId) =>
  cost.appliedComponents.find(component => component.componentId === componentId) ?? null;

test('bundled policy registry is valid', () => {
  assert.doesNotThrow(() => validateTariffPolicies(TARIFF_POLICIES));
  assert.doesNotThrow(() => validateTariffPerKwhComponents(TARIFF_PER_KWH_COMPONENTS));
  assert.doesNotThrow(() => validateTariffTaxRates(TARIFF_TAX_RATES));
  assert.equal(TARIFF_POLICIES.length, 1);
  assert.equal(residentialPolicy.versionId, 'residential-low-2023-11-09');
  assert.equal(residentialPolicy.confirmedOn, '2026-09-09');
  assert.ok(residentialPolicy.sources.length >= 2);
  assert.equal(residentialPolicy.minimumElectricityChargeWon, 1_000);
  assert.ok(residentialPolicy.excludedComponents.includes('복지할인(구 필수사용량보장공제)'));
  assert.ok(residentialPolicy.excludedComponents.includes('TV수신료'));
  assert.ok(!residentialPolicy.excludedComponents.includes('부가가치세'));
  assert.ok(!residentialPolicy.excludedComponents.includes('연료비조정요금'));
  assert.ok(!residentialPolicy.excludedComponents.includes('동계 소용량 할인'));
});

test('bundled component windows match the officially verified periods', () => {
  const climate = TARIFF_PER_KWH_COMPONENTS.filter(entry => entry.componentId === 'climateEnvironment');
  assert.equal(climate.length, 1);
  assert.equal(climate[0].rateTenthWonPerKwh, 90);
  assert.equal(climate[0].appliesFromCloseMonth, '2023-01');
  assert.equal(climate[0].appliesToCloseMonth, null);
  assert.equal(climate[0].confirmedOn, '2026-09-09');

  const fuel = TARIFF_PER_KWH_COMPONENTS.filter(entry => entry.componentId === 'fuelAdjustment');
  assert.deepEqual(
    fuel.map(entry => [entry.appliesFromCloseMonth, entry.appliesToCloseMonth, entry.rateTenthWonPerKwh]),
    [['2026-04', '2026-06', 50], ['2026-07', '2026-09', 50]],
  );

  const [vat] = TARIFF_TAX_RATES.filter(entry => entry.taxId === 'valueAddedTax');
  assert.equal(vat.rateBasisPoints, 1_000);
  assert.equal(vat.rounding, 'won-half-up');
  assert.equal(vat.appliesFromCloseMonth, '2023-11');
  assert.equal(vat.appliesToCloseMonth, null);

  const fund = TARIFF_TAX_RATES.filter(entry => entry.taxId === 'electricityIndustryFoundationFund');
  assert.deepEqual(
    fund.map(entry => [entry.appliesFromCloseMonth, entry.appliesToCloseMonth, entry.rateBasisPoints]),
    [['2023-11', '2024-06', 370], ['2024-07', '2025-06', 320], ['2025-07', null, 270]],
  );
  for (const entry of fund) assert.equal(entry.rounding, 'ten-won-truncate');
});

test('zero usage still bills the official 1,000 won monthly minimum', () => {
  const cost = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 9, usageWh: 0 });
  assert.equal(cost.seasonId, 'other');
  assert.equal(cost.baseFeeWon, 910);
  assert.equal(cost.energyFeeWon, 0);
  assert.equal(cost.subtotalWon, 910);
  assert.equal(cost.electricityChargeWon, 1_000);
  assert.equal(componentById(cost, 'valueAddedTax').won, 100);
  assert.equal(componentById(cost, 'electricityIndustryFoundationFund').won, 20);
  assert.equal(cost.estimatedTotalWon, 1_120);
  assert.equal(cost.usageKwh, 0);
});

test('exact first band boundary stays in the first band during the other season', () => {
  const cost = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 9, usageWh: 200_000 });
  assert.equal(cost.baseFeeWon, 910);
  assert.equal(cost.energyFeeWon, 24_000);
  assert.equal(cost.subtotalWon, 24_910);
  assert.equal(componentById(cost, 'climateEnvironment').won, 1_800);
  assert.equal(componentById(cost, 'fuelAdjustment').won, 1_000);
  assert.equal(cost.electricityChargeWon, 27_710);
  assert.equal(componentById(cost, 'valueAddedTax').won, 2_771);
  assert.equal(componentById(cost, 'electricityIndustryFoundationFund').won, 740);
  assert.equal(cost.estimatedTotalWon, 31_220);
  assert.deepEqual(cost.excludedComponents, ['복지할인(구 필수사용량보장공제)', 'TV수신료']);
});

test('one Wh above the first band boundary switches the base fee to the second band', () => {
  const cost = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 9, usageWh: 200_001 });
  assert.equal(cost.baseFeeWon, 1_600);
  assert.equal(cost.subtotalWon, 25_600);
  assert.equal(cost.estimatedTotalWon, 32_000);
});

test('second band boundary itself is billed with second band base fee', () => {
  const cost = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 9, usageWh: 400_000 });
  assert.equal(cost.baseFeeWon, 1_600);
  assert.equal(cost.energyFeeWon, 66_920);
  assert.equal(cost.subtotalWon, 68_520);
  assert.equal(cost.estimatedTotalWon, 83_530);
});

test('a September estimate for 561593 Wh sums every verified component', () => {
  const cost = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 9, usageWh: 561_593 });
  assert.equal(cost.seasonId, 'other');
  assert.equal(cost.baseFeeWon, 7_300);
  assert.equal(cost.energyFeeWon, 116_578);
  assert.equal(cost.subtotalWon, 123_878);
  assert.equal(componentById(cost, 'climateEnvironment').won, 5_054);
  assert.equal(componentById(cost, 'fuelAdjustment').won, 2_808);
  assert.equal(cost.electricityChargeWon, 131_740);
  assert.equal(componentById(cost, 'valueAddedTax').won, 13_174);
  assert.equal(componentById(cost, 'electricityIndustryFoundationFund').won, 3_550);
  // 131740 + 13174 + 3550 = 148464 → 약관 제7조② 10원 미만 절사.
  assert.equal(cost.estimatedTotalWon, 148_460);
  assert.equal(cost.closeYearMonth, '2026-09');
  assert.equal(cost.policyVersionId, 'residential-low-2023-11-09');
});

test('summer close months use widened 300/450 band boundaries', () => {
  const july = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 7, usageWh: 350_000 });
  assert.equal(july.seasonId, 'summer');
  assert.equal(july.baseFeeWon, 1_600);
  assert.equal(july.energyFeeWon, 46_730);
  assert.equal(july.subtotalWon, 48_330);
  assert.equal(july.estimatedTotalWon, 59_980);

  const september = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 9, usageWh: 350_000 });
  assert.equal(september.seasonId, 'other');
  assert.equal(september.subtotalWon, 57_790);
  assert.equal(september.estimatedTotalWon, 70_640);
});

test('summer first band boundary and one Wh beyond it select different base fees', () => {
  const at = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2025, closeMonth: 8, usageWh: 300_000 });
  assert.equal(at.baseFeeWon, 910);
  assert.equal(at.subtotalWon, 36_910);

  const beyond = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2025, closeMonth: 8, usageWh: 300_001 });
  assert.equal(beyond.baseFeeWon, 1_600);
  assert.equal(beyond.subtotalWon, 37_600);
  // 2025-08 is outside every announced fuel adjustment window.
  assert.ok(beyond.excludedComponents.includes('연료비조정요금'));
  assert.ok(!beyond.appliedComponents.some(component => component.componentId === 'fuelAdjustment'));
});

test('the Q3 fuel rate applies in July, August, and September only', () => {
  for (const month of [7, 8, 9]) {
    const cost = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: month, usageWh: 300_000 });
    const fuel = componentById(cost, 'fuelAdjustment');
    assert.ok(fuel, `2026-${month} should carry a fuel component`);
    assert.equal(fuel.rateTenthWonPerKwh, 50);
    assert.equal(fuel.won, 1_500);
  }
  // 2026-06 resolves to the announced Q2 window, not the Q3 window.
  const juneCoverage = tariffCoverageForCloseMonth(2026, 6);
  assert.equal(juneCoverage.fuelAdjustment.appliesFromCloseMonth, '2026-04');
  assert.equal(juneCoverage.fuelAdjustment.appliesToCloseMonth, '2026-06');
  const june = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 6, usageWh: 100_000 });
  assert.equal(componentById(june, 'fuelAdjustment').won, 500);
  // Before Q2 and after Q3 there is no announced rate, so the component is excluded.
  for (const [year, month] of [[2026, 3], [2026, 10], [2027, 1]]) {
    const coverage = tariffCoverageForCloseMonth(year, month);
    assert.equal(coverage.fuelAdjustment, null);
    assert.ok(coverage.uncoveredComponentLabels.includes('연료비조정요금'));
    const cost = calculateTariffCost(TARIFF_POLICIES, { closeYear: year, closeMonth: month, usageWh: 100_000 });
    assert.ok(cost.excludedComponents.includes('연료비조정요금'));
  }
});

test('the climate environment charge applies at the verified 9.0 won per kWh', () => {
  const cost = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2023, closeMonth: 12, usageWh: 350_000 });
  assert.equal(componentById(cost, 'climateEnvironment').won, 3_150);
  assert.equal(componentById(cost, 'climateEnvironment').rateTenthWonPerKwh, 90);
  assert.equal(componentById(cost, 'climateEnvironment').appliesFromCloseMonth, '2023-01');
  // 2026-10: no fuel window, so the climate charge still bills.
  const october = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 10, usageWh: 100_000 });
  assert.equal(componentById(october, 'climateEnvironment').won, 900);
});

test('VAT uses the electricity charge as its base and rounds half-up at the won boundary', () => {
  // 200.5kWh: charge 28515 = subtotal 25707 + climate 1805(half-up of 1804.5) + fuel 1003(half-up of 1002.5).
  const cost = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 9, usageWh: 200_500 });
  assert.equal(cost.electricityChargeWon, 28_515);
  // 28515 × 10% = 2851.5 → 4사5입 2852.
  assert.equal(componentById(cost, 'valueAddedTax').won, 2_852);
  assert.equal(componentById(cost, 'electricityIndustryFoundationFund').won, 760);
  assert.equal(cost.estimatedTotalWon, 32_120);
});

test('the fund rate follows its verified windows with ten-won truncation', () => {
  // 3.7% window: 60940 × 0.037 = 2254.78 → 2250.
  const dec2023 = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2023, closeMonth: 12, usageWh: 350_000 });
  assert.equal(componentById(dec2023, 'electricityIndustryFoundationFund').won, 2_250);
  // 3.2% window: 60940 × 0.032 = 1950.08 → 1950.
  const mar2025 = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2025, closeMonth: 3, usageWh: 350_000 });
  assert.equal(componentById(mar2025, 'electricityIndustryFoundationFund').won, 1_950);
  // 2.7% window: 27710 × 0.027 = 748.17 → 740.
  const sep2026 = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 9, usageWh: 200_000 });
  assert.equal(componentById(sep2026, 'electricityIndustryFoundationFund').won, 740);
});

test('energy cost rounds half-up once at the whole won boundary', () => {
  // 202500 Wh → 200000 Wh × 120.0원 + 2500 Wh × 214.6원 = 24536.5원 → 24537원.
  const halfUp = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 10, usageWh: 202_500 });
  assert.equal(halfUp.energyFeeWon, 24_537);
  assert.equal(halfUp.subtotalWon, 26_137);
  assert.equal(componentById(halfUp, 'climateEnvironment').won, 1_823);
  assert.equal(halfUp.estimatedTotalWon, 31_500);

  // 202499 Wh → 24536.2854원 → 24536원.
  const down = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 10, usageWh: 202_499 });
  assert.equal(down.energyFeeWon, 24_536);
  assert.equal(down.subtotalWon, 26_136);
  assert.equal(down.estimatedTotalWon, 31_500);
});

test('winter and summer superuser surcharge starts exactly above 1000kWh', () => {
  const winter = [999_000, 1_000_000, 1_001_000].map(usageWh =>
    calculateTariffCost(TARIFF_POLICIES, { closeYear: 2027, closeMonth: 1, usageWh }));
  assert.equal(winter[0].seasonId, 'winter');
  assert.equal(winter[0].energyFeeWon, 250_993);
  assert.equal(winter[1].energyFeeWon, 251_300);
  // 251300 + 736.2 → the first kWh above 1000 bills at the superuser rate.
  assert.equal(winter[2].energyFeeWon, 252_036);
  assert.equal(winter[2].baseFeeWon, 7_300);

  const summer = [1_000_000, 1_001_000].map(usageWh =>
    calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 8, usageWh }));
  assert.equal(summer[0].seasonId, 'summer');
  assert.equal(summer[0].energyFeeWon, 237_205);
  assert.equal(summer[1].energyFeeWon, 237_941);
});

test('months outside the summer and winter peak seasons have no superuser surcharge', () => {
  const cost = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 10, usageWh: 1_001_000 });
  assert.equal(cost.seasonId, 'other');
  // 200×120 + 200×214.6 + 601×307.3 = 251607.3 → the open top band stays 307.3원.
  assert.equal(cost.energyFeeWon, 251_607);
  assert.equal(cost.baseFeeWon, 7_300);
});

test('billed months before the verified policy window fail explicitly', () => {
  assert.throws(
    () => calculateTariffCost(TARIFF_POLICIES, { closeYear: 2023, closeMonth: 10, usageWh: 100_000 }),
    expectCode('NO_TARIFF_POLICY_VERSION'),
  );
  const resolved = resolveTariffPolicyForCloseMonth(TARIFF_POLICIES, 2023, 11);
  assert.equal(resolved.versionId, 'residential-low-2023-11-09');
});

test('invalid billed usage or month fails explicitly', () => {
  const september = { closeYear: 2026, closeMonth: 9 };
  assert.throws(() => calculateTariffCost(TARIFF_POLICIES, { ...september, usageWh: -1 }), expectCode('INVALID_TARIFF_USAGE'));
  assert.throws(() => calculateTariffCost(TARIFF_POLICIES, { ...september, usageWh: 100.5 }), expectCode('INVALID_TARIFF_USAGE'));
  assert.throws(() => calculateTariffCost(TARIFF_POLICIES, { ...september, usageWh: 1_000_000_001_000 }), expectCode('INVALID_TARIFF_USAGE'));
  assert.throws(() => calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 13, usageWh: 100_000 }), expectCode('INVALID_TARIFF_USAGE'));
  assert.throws(() => calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 0, usageWh: 100_000 }), expectCode('INVALID_TARIFF_USAGE'));
});

test('component windows must not overlap and rounding must be verified', () => {
  const duplicateFuel = [
    ...TARIFF_PER_KWH_COMPONENTS,
    { ...TARIFF_PER_KWH_COMPONENTS[1], appliesFromCloseMonth: '2026-08', appliesToCloseMonth: '2026-11' },
  ];
  assert.throws(() => validateTariffPerKwhComponents(duplicateFuel), expectCode('INVALID_TARIFF_POLICY'));

  const unknownComponent = [{ ...TARIFF_PER_KWH_COMPONENTS[0], componentId: 'mystery' }];
  assert.throws(() => validateTariffPerKwhComponents(unknownComponent), expectCode('INVALID_TARIFF_POLICY'));

  const negativeFuelWindow = [{ ...TARIFF_PER_KWH_COMPONENTS[1], appliesFromCloseMonth: '2026-09', appliesToCloseMonth: '2026-07' }];
  assert.throws(() => validateTariffPerKwhComponents(negativeFuelWindow), expectCode('INVALID_TARIFF_POLICY'));

  const overlappingFund = [
    ...TARIFF_TAX_RATES,
    { ...TARIFF_TAX_RATES[3], appliesFromCloseMonth: '2026-01', appliesToCloseMonth: null },
  ];
  assert.throws(() => validateTariffTaxRates(overlappingFund), expectCode('INVALID_TARIFF_POLICY'));

  const unknownRounding = [{ ...TARIFF_TAX_RATES[0], rounding: 'round-whenever' }];
  assert.throws(() => validateTariffTaxRates(unknownRounding), expectCode('INVALID_TARIFF_POLICY'));

  const outOfRangeRate = [{ ...TARIFF_TAX_RATES[0], rateBasisPoints: 0 }];
  assert.throws(() => validateTariffTaxRates(outOfRangeRate), expectCode('INVALID_TARIFF_POLICY'));
});

const basePolicy = {
  versionId: 'test-a',
  label: 'test policy a',
  appliesFromCloseMonth: '2025-01',
  appliesToCloseMonth: null,
  confirmedOn: '2026-09-09',
  sources: ['https://example.com/tariff'],
  minimumElectricityChargeWon: null,
  excludedComponents: [],
};

const twoBands = [
  { upToKwh: 100, baseFeeWonPerHousehold: 400, energyTenthWonPerKwh: 1_000 },
  { upToKwh: null, baseFeeWonPerHousehold: 1_200, energyTenthWonPerKwh: 2_000 },
];

const everyMonth = Array.from({ length: 12 }, (_, index) => index + 1);

const coveringPolicy = {
  ...basePolicy,
  seasons: [{ seasonId: 'all', closeMonths: everyMonth, bands: twoBands }],
};

test('the covering version wins when a later revision exists', () => {
  const older = { ...coveringPolicy, versionId: 'test-old', appliesFromCloseMonth: '2024-01', appliesToCloseMonth: '2024-12' };
  const policies = [older, coveringPolicy];
  assert.equal(resolveTariffPolicyForCloseMonth(policies, 2024, 6).versionId, 'test-old');
  assert.equal(resolveTariffPolicyForCloseMonth(policies, 2025, 1).versionId, 'test-a');
  assert.throws(
    () => resolveTariffPolicyForCloseMonth(policies, 2023, 12),
    expectCode('NO_TARIFF_POLICY_VERSION'),
  );
});

test('overlapping policy windows are rejected', () => {
  const older = { ...coveringPolicy, versionId: 'test-old', appliesFromCloseMonth: '2024-01', appliesToCloseMonth: '2025-06' };
  assert.throws(() => validateTariffPolicies([older, coveringPolicy]), expectCode('INVALID_TARIFF_POLICY'));
});

test('invalid season or band definitions are rejected', () => {
  const duplicateMonths = {
    ...coveringPolicy,
    seasons: [
      { seasonId: 'a', closeMonths: [1, 2, 3, 4, 5, 6], bands: twoBands },
      { seasonId: 'b', closeMonths: [6, 7, 8, 9, 10, 11, 12], bands: twoBands },
    ],
  };
  assert.throws(() => validateTariffPolicies([duplicateMonths]), expectCode('INVALID_TARIFF_POLICY'));

  const uncoveredMonths = {
    ...coveringPolicy,
    seasons: [{ seasonId: 'a', closeMonths: [1, 2, 3], bands: twoBands }],
  };
  assert.throws(() => validateTariffPolicies([uncoveredMonths]), expectCode('INVALID_TARIFF_POLICY'));

  const descendingBands = {
    ...coveringPolicy,
    seasons: [{ seasonId: 'a', closeMonths: everyMonth, bands: [twoBands[1], twoBands[0]] }],
  };
  assert.throws(() => validateTariffPolicies([descendingBands]), expectCode('INVALID_TARIFF_POLICY'));

  const openMiddleBand = {
    ...coveringPolicy,
    seasons: [{ seasonId: 'a', closeMonths: everyMonth, bands: [{ upToKwh: null, baseFeeWonPerHousehold: 0, energyTenthWonPerKwh: 1 }, twoBands[1]] }],
  };
  assert.throws(() => validateTariffPolicies([openMiddleBand]), expectCode('INVALID_TARIFF_POLICY'));

  const noSeasons = { ...coveringPolicy, seasons: [] };
  assert.throws(() => validateTariffPolicies([noSeasons]), expectCode('INVALID_TARIFF_POLICY'));

  const reversedWindow = { ...coveringPolicy, appliesFromCloseMonth: '2025-06', appliesToCloseMonth: '2025-01' };
  assert.throws(() => validateTariffPolicies([reversedWindow]), expectCode('INVALID_TARIFF_POLICY'));

  const negativeMinimum = { ...coveringPolicy, minimumElectricityChargeWon: -1 };
  assert.throws(() => validateTariffPolicies([negativeMinimum]), expectCode('INVALID_TARIFF_POLICY'));
});
