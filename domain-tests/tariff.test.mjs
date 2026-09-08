import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TariffPolicyError,
  TARIFF_POLICIES,
  calculateTariffCost,
  resolveTariffPolicyForCloseMonth,
  validateTariffPolicies,
} from '../.domain-test/domain/tariff.js';

const expectCode = code => error => error instanceof TariffPolicyError && error.code === code;

test('bundled policy registry is valid', () => {
  assert.doesNotThrow(() => validateTariffPolicies(TARIFF_POLICIES));
  assert.equal(TARIFF_POLICIES.length, 1);
  assert.equal(TARIFF_POLICIES[0].versionId, 'residential-low-2023-11-09');
  assert.equal(TARIFF_POLICIES[0].confirmedOn, '2026-09-09');
  assert.ok(TARIFF_POLICIES[0].sources.length >= 2);
  assert.ok(TARIFF_POLICIES[0].excludedComponents.includes('부가가치세'));
});

test('zero usage still carries the first band base fee', () => {
  const cost = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 9, usageWh: 0 });
  assert.equal(cost.seasonId, 'other');
  assert.equal(cost.baseFeeWon, 910);
  assert.equal(cost.energyFeeWon, 0);
  assert.equal(cost.subtotalWon, 910);
  assert.equal(cost.usageKwh, 0);
});

test('exact first band boundary stays in the first band during the other season', () => {
  const cost = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 9, usageWh: 200_000 });
  assert.equal(cost.baseFeeWon, 910);
  assert.equal(cost.energyFeeWon, 24_000);
  assert.equal(cost.subtotalWon, 24_910);
});

test('one Wh above the first band boundary switches the base fee to the second band', () => {
  const cost = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 9, usageWh: 200_001 });
  assert.equal(cost.baseFeeWon, 1_600);
  assert.equal(cost.energyFeeWon, 24_000);
  assert.equal(cost.subtotalWon, 25_600);
});

test('second band boundary itself is billed with second band base fee', () => {
  const cost = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 9, usageWh: 400_000 });
  assert.equal(cost.baseFeeWon, 1_600);
  assert.equal(cost.energyFeeWon, 66_920);
  assert.equal(cost.subtotalWon, 68_520);
});

test('a September estimate for 561593 Wh sums three other-season bands with half-up rounding', () => {
  const cost = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 9, usageWh: 561_593 });
  assert.equal(cost.seasonId, 'other');
  assert.equal(cost.baseFeeWon, 7_300);
  assert.equal(cost.energyFeeWon, 116_578);
  assert.equal(cost.subtotalWon, 123_878);
  assert.equal(cost.closeYearMonth, '2026-09');
  assert.equal(cost.policyVersionId, 'residential-low-2023-11-09');
  assert.deepEqual(cost.excludedComponents, TARIFF_POLICIES[0].excludedComponents);
});

test('summer close months use widened 300/450 band boundaries', () => {
  const july = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 7, usageWh: 350_000 });
  assert.equal(july.seasonId, 'summer');
  assert.equal(july.baseFeeWon, 1_600);
  assert.equal(july.energyFeeWon, 46_730);
  assert.equal(july.subtotalWon, 48_330);

  const september = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 9, usageWh: 350_000 });
  assert.equal(september.seasonId, 'other');
  assert.equal(september.baseFeeWon, 1_600);
  assert.equal(september.energyFeeWon, 56_190);
  assert.equal(september.subtotalWon, 57_790);
});

test('summer first band boundary and one Wh beyond it select different base fees', () => {
  const at = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2025, closeMonth: 8, usageWh: 300_000 });
  assert.equal(at.baseFeeWon, 910);
  assert.equal(at.subtotalWon, 36_910);

  const beyond = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2025, closeMonth: 8, usageWh: 300_001 });
  assert.equal(beyond.baseFeeWon, 1_600);
  assert.equal(beyond.subtotalWon, 37_600);
});

test('energy cost rounds half-up once at the whole won boundary', () => {
  // 202500 Wh → 200000 Wh × 120.0원 + 2500 Wh × 214.6원 = 24536.5원 → 24537원.
  const halfUp = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 10, usageWh: 202_500 });
  assert.equal(halfUp.energyFeeWon, 24_537);
  assert.equal(halfUp.subtotalWon, 26_137);

  // 202499 Wh → 24536.2854원 → 24536원.
  const down = calculateTariffCost(TARIFF_POLICIES, { closeYear: 2026, closeMonth: 10, usageWh: 202_499 });
  assert.equal(down.energyFeeWon, 24_536);
  assert.equal(down.subtotalWon, 26_136);
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

const basePolicy = {
  versionId: 'test-a',
  label: 'test policy a',
  appliesFromCloseMonth: '2025-01',
  appliesToCloseMonth: null,
  confirmedOn: '2026-09-09',
  sources: ['https://example.com/tariff'],
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
});
