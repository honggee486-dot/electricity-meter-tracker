import { api, ApiError, type AuthConfigResponse, type BillingClose, type MeterResource, type MeterSettingsInput, type ReadingResource } from './api';
import { getBillingCycleContext } from './domain/billingCycle';
import { splitUsageIntervalByLocalDate } from './domain/dailyUsage';
import { calculateUsageForecast, type UsageForecastSnapshot } from './domain/forecast';
import { parseCumulativeKwhToWh, type MeterReadingPoint } from './domain/usage';
import {
  calculateTariffCost,
  resolveTariffPolicyForCloseMonth,
  tariffCoverageForCloseMonth,
  TariffPolicyError,
  TARIFF_POLICIES,
  type TariffCostResult,
  type TariffPolicyVersion,
} from './domain/tariff';
import './style.css';
import './live.css';

interface GoogleCredentialResponse { credential: string; }
interface GoogleIdClient {
  initialize(options: { client_id: string; callback: (response: GoogleCredentialResponse) => void }): void;
  renderButton(parent: HTMLElement, options: { theme: string; size: string; text: string; shape: string; width: number }): void;
}
declare global {
  interface Window { google?: { accounts: { id: GoogleIdClient } }; }
}

type Screen = 'home' | 'records' | 'analysis' | 'settings';
type Phase = 'loading' | 'auth-unconfigured' | 'signed-out' | 'ready' | 'error';
type Notice = { kind: 'success' | 'error'; text: string } | null;

interface State {
  phase: Phase;
  authConfig: AuthConfigResponse | null;
  meters: MeterResource[];
  selectedMeterId: string | null;
  readings: ReadingResource[];
  notice: Notice;
  errorText: string;
  meterLoading: boolean;
  refreshFailed: boolean;
}

interface DailyAggregate {
  localDate: string;
  usageWh: number;
  interpolated: boolean;
}

const screens: { id: Screen; label: string; icon: string }[] = [
  { id: 'home', label: '홈', icon: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z"/>' },
  { id: 'records', label: '기록', icon: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>' },
  { id: 'analysis', label: '분석', icon: '<path d="M4 20V10m8 10V4m8 16v-7"/>' },
  { id: 'settings', label: '설정', icon: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>' },
];

const app = document.querySelector<HTMLDivElement>('#app')!;
const state: State = {
  phase: 'loading', authConfig: null, meters: [], selectedMeterId: null,
  readings: [], notice: null, errorText: '',
  meterLoading: false, refreshFailed: false,
};

// Requests may finish after another selection or another authenticated session.
let generation = 0;
let authGeneration = 0;
const pendingMutations = new Map<string, symbol>();
const readingDrafts = new Map<string, string>();
const settingsDrafts = new Map<string, MeterSettingsInput>();
let createDraft: MeterSettingsInput | null = null;

function settingsInput(form: HTMLFormElement): MeterSettingsInput {
  const data = new FormData(form);
  return {
    name: String(data.get('name') ?? ''),
    timezone: String(data.get('timezone') ?? ''),
    billingClose: parseCloseValue(String(data.get('billingClose') ?? '21')),
  };
}

function meterToolbar(meter: MeterResource): string {
  return `<section class="meter-toolbar" aria-label="현재 계량기"><label for="meter-select">계량기</label><select id="meter-select">${state.meters.map(item => `<option value="${escapeHtml(item.meterId)}"${item.meterId === meter.meterId ? ' selected' : ''}>${escapeHtml(item.name)} · ${item.role}</option>`).join('')}</select>${meter.role === 'owner' ? '' : '<span class="role-badge viewer">viewer · 조회 전용</span>'}</section>`;
}

const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
})[char]!);
const selectedMeter = (): MeterResource | null => state.meters.find(meter => meter.meterId === state.selectedMeterId) ?? null;
const closeSetting = (meter: MeterResource): BillingClose => meter.billingClose;
const points = (): MeterReadingPoint[] => [...state.readings]
  .sort((a, b) => a.measuredAtMs - b.measuredAtMs)
  .map(reading => ({ measuredAtMs: reading.measuredAtMs, cumulativeWh: reading.cumulativeMilliUnit }));
const formatCumulativeKwh = (wh: number): string => {
  const whole = Math.floor(wh / 1000);
  const fraction = wh % 1000;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(3, '0').replace(/0+$/, '')}`;
};
const formatKwh = (wh: number | null, digits = 1): string => wh === null ? '자료 부족' : `${(wh / 1000).toFixed(digits)} kWh`;
const formatPower = (watts: number | null): string => watts === null ? '자료 부족' : `${Math.round(watts).toLocaleString('ko-KR')} W`;
const formatHours = (ms: number): string => {
  const hours = ms / 3_600_000;
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)}시간`;
  return `${(hours / 24).toFixed(1)}일`;
};
const closeLabel = (close: BillingClose): string => close.kind === 'month-end' ? '매월 월말' : `매월 ${close.day}일`;
const parseCloseValue = (value: string): BillingClose => value === 'month-end'
  ? { kind: 'month-end' }
  : { kind: 'day', day: Number(value) };
const closeSelectOptions = (selected: BillingClose = { kind: 'day', day: 21 }): string => [
  `<option value="month-end"${selected.kind === 'month-end' ? ' selected' : ''}>월말</option>`,
  ...Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    return `<option value="${day}"${selected.kind === 'day' && selected.day === day ? ' selected' : ''}>${day}일</option>`;
  }),
].join('');
const friendlyError = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.status === 409) return '같은 시각의 기록이 있거나 누적값 순서와 맞지 않습니다.';
    if (error.status === 403) return '이 작업은 계량기 소유자만 할 수 있습니다.';
    if (error.status === 401) {
      if (error.code === 'INVALID_GOOGLE_CREDENTIAL') {
        return 'Google 로그인 정보를 확인하지 못했습니다. 다시 시도해 주세요.';
      }
      return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
    }
    if (error.status === 503) return '이 환경의 인증 또는 데이터 연결이 아직 준비되지 않았습니다.';
    return `요청을 처리하지 못했습니다. (${error.code})`;
  }
  return '네트워크 또는 앱 오류로 요청을 처리하지 못했습니다.';
};

function buildDailyAggregates(readingPoints: readonly MeterReadingPoint[], timeZone: string): DailyAggregate[] {
  const aggregates = new Map<string, DailyAggregate>();
  for (let index = 1; index < readingPoints.length; index += 1) {
    const split = splitUsageIntervalByLocalDate(readingPoints[index - 1], readingPoints[index], timeZone);
    for (const day of split.days) {
      const current = aggregates.get(day.localDate);
      if (current) {
        current.usageWh += day.usageWh;
        current.interpolated ||= day.provenance === 'interpolated';
      } else {
        aggregates.set(day.localDate, {
          localDate: day.localDate,
          usageWh: day.usageWh,
          interpolated: day.provenance === 'interpolated',
        });
      }
    }
  }
  return [...aggregates.values()].sort((a, b) => b.localDate.localeCompare(a.localDate)).slice(0, 7);
}

function forecastFor(meter: MeterResource): UsageForecastSnapshot | null {
  const readingPoints = points();
  return readingPoints.length === 0 ? null : calculateUsageForecast(readingPoints, closeSetting(meter), meter.timezone, 7);
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

function tariffDisplay(closeYear: number, closeMonth: number, projectedUsageWh: number | null): { amount: string; note: string } | null {
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

function shell(content: string, includeNav = false): string {
  return `<div class="shell">
    <header class="masthead"><a href="#home" class="brand" aria-label="전기 기록 홈"><span class="brand-mark" aria-hidden="true">↗</span> 전기 기록</a>${state.phase === 'ready' ? '<button id="logout-button" class="text-button" type="button">로그아웃</button>' : ''}</header>
    <main id="main">${content}</main>
    ${includeNav ? `<nav class="bottom-nav" aria-label="주 메뉴">${screens.map(screen => `<a href="#${screen.id}" data-screen="${screen.id}" ${screen.id === 'home' ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${screen.icon}</svg><span>${screen.label}</span></a>`).join('')}</nav>` : ''}
  </div>`;
}

function renderAuthState(title: string, body: string): void {
  app.innerHTML = shell(`<section class="state-panel" aria-labelledby="state-title"><p class="eyebrow">전기 계량기 기록</p><h1 id="state-title">${escapeHtml(title)}</h1>${body}</section>`);
}

function render(): void {
  if (state.phase === 'loading') {
    renderAuthState('불러오는 중', '<p class="state-copy">로그인과 계량기 정보를 확인하고 있습니다.</p>');
    return;
  }
  if (state.phase === 'auth-unconfigured') {
    renderAuthState('아직 연결 준비 중입니다', '<p class="state-copy">이 preview 환경에는 Google 로그인 또는 데이터 저장소 설정이 아직 연결되지 않았습니다.</p>');
    return;
  }
  if (state.phase === 'signed-out') {
    renderAuthState('Google로 로그인', `<p class="state-copy">로그인하면 본인 계량기와 공유받은 계량기만 불러옵니다.</p>${noticeHtml()}<div id="google-button" class="google-login" aria-label="Google 로그인"></div>`);
    configureGoogleButton();
    return;
  }
  if (state.phase === 'error') {
    renderAuthState('불러오지 못했습니다', `<p class="state-copy error-text">${escapeHtml(state.errorText)}</p><button id="retry-button" class="primary" type="button">다시 시도</button>`);
    document.querySelector<HTMLButtonElement>('#retry-button')?.addEventListener('click', () => void bootstrap());
    return;
  }

  if (state.meters.length === 0) {
    app.innerHTML = shell(`<section class="state-panel" aria-labelledby="create-title"><p class="eyebrow">첫 계량기</p><h1 id="create-title">계량기를 추가하세요</h1><p class="state-copy">이름, 시간대, 검침 마감 기준만 정하면 바로 기록을 시작할 수 있습니다.</p>
      ${noticeHtml()}
      <form id="meter-create-form" class="stack-form">
        <label>계량기 이름<input name="name" required maxlength="80" value="우리집 전기"></label>
        <label>시간대<input name="timezone" required value="Asia/Seoul"></label>
        <label>검침 마감<select name="billingClose">${closeSelectOptions()}</select></label><p class="field-help">29~31일이 없는 달은 그 달 월말로 자동 보정됩니다. 월말을 고르면 매달 실제 마지막 날을 사용합니다.</p>
        <button class="primary" type="submit">계량기 만들기</button>
      </form></section>`);
    bindLogout();
    const form = document.querySelector<HTMLFormElement>('#meter-create-form')!;
    const pending = pendingMutations.has('create');
    restoreSettingsForm(form, createDraft, pending);
    const saveDraft = (): void => { if (!pending) createDraft = settingsInput(form); };
    form.addEventListener('input', saveDraft);
    form.addEventListener('change', saveDraft);
    form.addEventListener('submit', event => void createMeter(event));
    return;
  }

  const meter = selectedMeter() ?? state.meters[0];
  state.selectedMeterId = meter.meterId;
  if (state.meterLoading) {
    app.innerHTML = shell(`${meterToolbar(meter)}<p class="state-copy" role="status">${escapeHtml(meter.name)} 기록을 불러오는 중입니다.</p>`);
    bindLogout();
    bindMeterSelection();
    return;
  }
  let forecast: UsageForecastSnapshot | null = null;
  let daily: DailyAggregate[] = [];
  try {
    forecast = forecastFor(meter);
    daily = buildDailyAggregates(points(), meter.timezone);
  } catch (error) {
    state.phase = 'error';
    state.errorText = friendlyError(error);
    render();
    return;
  }
  const latest = forecast?.latestReading ?? null;
  const latestInterval = forecast?.latestInterval ?? null;
  const liveContext = getBillingCycleContext(Date.now(), closeSetting(meter), meter.timezone);
  const liveCycle = liveContext.current;
  const forecastCycle = forecast?.currentCycle ?? null;
  const currentCycle = forecastCycle
    && forecastCycle.cycle.startMs === liveCycle.startMs
    && forecastCycle.cycle.endMs === liveCycle.endMs
    ? forecastCycle
    : null;
  const cycle = liveCycle;
  const isOwner = meter.role === 'owner';
  const readingRows = [...state.readings].sort((a, b) => b.measuredAtMs - a.measuredAtMs);
  const dateTime = new Intl.DateTimeFormat('ko-KR', {
    timeZone: meter.timezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const comparison = currentCycle ? forecast?.comparison : null;
  const confidence = currentCycle ? forecast?.confidence : null;
  const tariff = tariffDisplay(liveCycle.closeYear, liveCycle.closeMonth, currentCycle?.projectedCloseUsageWh ?? null);

  app.innerHTML = shell(`
    ${meterToolbar(meter)}
    ${noticeHtml()}
    <section id="home" class="screen" aria-labelledby="home-title">
      <div class="page-heading"><p class="eyebrow">빠른 기록</p><h1 id="home-title" tabindex="-1">${escapeHtml(meter.name)}</h1><p>현재 검침기간 <strong>${cycle.displayStartLocalDate} ~ ${cycle.displayEndLocalDate}</strong></p></div>
      <form id="reading-form" class="reading-form">
        <label for="meter-reading">현재 계량기</label>
        <div class="reading-input"><input id="meter-reading" name="reading" type="text" inputmode="decimal" maxlength="15" autocomplete="off" spellcheck="false" placeholder="${latest ? escapeHtml(formatCumulativeKwh(latest.cumulativeWh)) : '누적 kWh'}" ${isOwner ? '' : 'disabled'} aria-describedby="reading-hint" required><span>kWh</span></div>
        <p id="reading-hint">${isOwner ? '기록 시각은 자동 · 소수 3자리(1 Wh)까지' : 'viewer는 기록을 추가할 수 없습니다.'}</p>
        <button id="record-button" class="primary" type="submit" disabled>${isOwner ? '기록하기' : '조회 전용'}</button>
      </form>
      <section class="interval" aria-labelledby="interval-title"><div class="section-heading"><h2 id="interval-title">직전 기록 이후</h2><span class="subtle">실제 기록 기준</span></div><p class="hero-number">${latestInterval ? `${latestInterval.usageKwh.toFixed(1)} <small>kWh</small>` : '자료 부족'}</p><dl class="interval-details"><div><dt>경과시간</dt><dd>${latestInterval ? formatHours(latestInterval.elapsedMs) : '자료 부족'}</dd></div><div><dt>평균 소비전력</dt><dd>${formatPower(latestInterval?.averagePowerW ?? null)}</dd></div></dl></section>
      <section class="cycle-summary" aria-labelledby="cycle-title"><div class="section-heading"><h2 id="cycle-title">이번 검침주기</h2><span class="deadline">마감까지 약 ${Math.max(0, Math.ceil(liveContext.remainingMs / 86_400_000))}일</span></div><dl class="summary-list"><div><dt>최신 기록까지</dt><dd>${formatKwh(currentCycle?.usageToDateWh ?? null)}</dd></div><div><dt>최근 완전 일평균 · 최대 7일</dt><dd>${forecast?.recentDailyAverage ? `${forecast.recentDailyAverage.usageKwhPerDay.toFixed(1)} kWh/일` : '자료 부족'}</dd></div><div><dt>마감 예상 사용량</dt><dd>${formatKwh(currentCycle?.projectedCloseUsageWh ?? null)}</dd></div><div><dt>예상 전기요금</dt><dd>${tariff ? escapeHtml(tariff.amount) : '요금 정책 연결 전'}</dd></div></dl><p class="note">${tariff ? escapeHtml(tariff.note) : '요금은 아직 계산하지 않습니다. 사용량과 예측은 저장된 원본 기록에서 다시 계산합니다.'}</p></section>
    </section>
    <section id="records" class="screen" aria-labelledby="records-title" hidden><div class="page-heading"><p class="eyebrow">원본 기록</p><h1 id="records-title" tabindex="-1">기록</h1><p>${escapeHtml(meter.timezone)}</p></div>${readingRows.length ? `<ul class="reading-list">${readingRows.map(reading => `<li><span><time datetime="${new Date(reading.measuredAtMs).toISOString()}">${dateTime.format(reading.measuredAtMs)}</time><small>실제 측정</small></span><strong>${escapeHtml(formatCumulativeKwh(reading.cumulativeMilliUnit))}<small> kWh</small></strong></li>`).join('')}</ul>` : '<p class="empty-state">아직 기록이 없습니다.</p>'}</section>
    <section id="analysis" class="screen" aria-labelledby="analysis-title" hidden><div class="page-heading"><p class="eyebrow">저장된 기록으로 계산</p><h1 id="analysis-title" tabindex="-1">분석</h1></div><dl class="analysis-list"><div><dt>현재 검침주기 평균</dt><dd>${currentCycle?.averageDailyUsageKwh !== null && currentCycle?.averageDailyUsageKwh !== undefined ? `${currentCycle.averageDailyUsageKwh.toFixed(1)} kWh/일` : '자료 부족'}</dd></div><div class="forecast"><dt>검침 마감 예상</dt><dd>${formatKwh(currentCycle?.projectedCloseUsageWh ?? null)}</dd></div><div class="normalized"><dt>30일 환산</dt><dd>${formatKwh(currentCycle?.normalized30DayUsageWh ?? null)}</dd></div><div><dt>이전 주기 대비</dt><dd>${comparison ? `${comparison.projectedVsPreviousDeltaKwh >= 0 ? '+' : ''}${comparison.projectedVsPreviousDeltaKwh.toFixed(1)} kWh${comparison.projectedVsPreviousPercent === null ? '' : ` · ${comparison.projectedVsPreviousPercent.toFixed(1)}%`}` : '자료 부족'}</dd></div></dl>${confidence ? `<p class="note">관측 범위 ${(confidence.observationCoverageRatio * 100).toFixed(0)}% · 최근 완전 일자 ${confidence.recentFullDaysUsed}/${confidence.requestedRecentDays}일 · 시작 경계 ${confidence.startBoundaryProvenance ?? '자료 부족'}</p>` : '<p class="note">예측 신뢰도를 판단할 기록이 아직 부족합니다.</p>'}<section class="daily"><h2>일별 사용량</h2><p class="note">기록 사이 관측 구간의 합계로, 하루 전체 사용량과 다를 수 있습니다.</p>${daily.length ? `<ul class="daily-list">${daily.map(day => `<li><span>${day.localDate.slice(5).replace('-', '/')}</span><strong>${(day.usageWh / 1000).toFixed(1)}<small> kWh</small></strong><span class="basis">${day.interpolated ? '추정·보간' : '실측 구간'}</span></li>`).join('')}</ul>` : '<p class="empty-state">일별 사용량을 계산할 구간이 없습니다.</p>'}</section></section>
    <section id="settings" class="screen" aria-labelledby="settings-title" hidden><div class="page-heading"><p class="eyebrow">계량기 기준</p><h1 id="settings-title" tabindex="-1">설정</h1><p>${isOwner ? '소유자만 변경할 수 있습니다.' : '공유받은 계량기는 조회만 가능합니다.'}</p></div>${isOwner ? `<form id="meter-settings-form" class="stack-form"><label>계량기 이름<input name="name" required maxlength="80" value="${escapeHtml(meter.name)}"></label><label>시간대<input name="timezone" required value="${escapeHtml(meter.timezone)}"></label><label>검침 마감<select name="billingClose">${closeSelectOptions(meter.billingClose)}</select></label><p class="field-help">29~31일이 없는 달은 그 달 월말로 자동 보정됩니다. 월말은 매달 실제 마지막 날입니다.</p><button class="primary" type="submit">설정 저장</button></form>` : `<dl class="settings-list"><div><dt>계량기 이름</dt><dd>${escapeHtml(meter.name)}</dd></div><div><dt>검침 마감</dt><dd>${closeLabel(meter.billingClose)}</dd></div><div><dt>시간대</dt><dd>${escapeHtml(meter.timezone)}</dd></div></dl><p class="note">29~31일 고정 마감은 해당 날짜가 없는 달에 그 달 월말로 자동 보정됩니다. 월말 설정은 매달 실제 마지막 날입니다. viewer 권한은 계량기 설정과 원본 기록을 변경할 수 없습니다.</p>`}</section>
  `, true);

  bindReadyEvents(meter);
  navigate(false);
}

function noticeHtml(): string {
  return state.notice ? `<p class="action-notice ${state.notice.kind}" role="status">${escapeHtml(state.notice.text)}</p>${state.refreshFailed ? '<button id="refresh-button" class="text-button" type="button">최신 정보 다시 불러오기</button>' : ''}` : '';
}

function configureGoogleButton(): void {
  const config = state.authConfig;
  const host = document.querySelector<HTMLElement>('#google-button');
  if (!config || !host) return;
  const csrfToken = crypto.randomUUID();
  document.cookie = `g_csrf_token=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Strict`;

  const renderButton = (): void => {
    const googleId = window.google?.accounts.id;
    if (!googleId || !document.body.contains(host)) return;
    googleId.initialize({
      client_id: config.googleClientId,
      callback: response => void completeGoogleLogin(response.credential, csrfToken),
    });
    googleId.renderButton(host, {
      theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', width: 280,
    });
  };

  if (window.google?.accounts.id) {
    renderButton();
    return;
  }
  const existing = document.querySelector<HTMLScriptElement>('script[data-google-gis]');
  if (existing) {
    existing.addEventListener('load', renderButton, { once: true });
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.dataset.googleGis = '1';
  script.addEventListener('load', renderButton, { once: true });
  script.addEventListener('error', () => {
    state.notice = { kind: 'error', text: 'Google 로그인 화면을 불러오지 못했습니다.' };
    render();
  }, { once: true });
  document.head.append(script);
}

async function completeGoogleLogin(credential: string, csrfToken: string): Promise<void> {
  try {
    await api.googleLogin(credential, csrfToken);
    document.cookie = 'g_csrf_token=; Max-Age=0; Path=/; SameSite=Strict';
    state.notice = null;
    await bootstrap();
  } catch (error) {
    state.notice = { kind: 'error', text: friendlyError(error) };
    render();
  }
}

async function signedOut(notice: Notice = null): Promise<void> {
  const request = ++generation;
  ++authGeneration;
  pendingMutations.clear();
  readingDrafts.clear();
  settingsDrafts.clear();
  createDraft = null;
  state.meters = [];
  state.selectedMeterId = null;
  state.readings = [];
  state.meterLoading = false;
  state.refreshFailed = false;
  state.notice = notice;
  state.phase = 'loading';
  render();
  try {
    const config = await api.authConfig();
    if (request !== generation) return;
    state.authConfig = config;
    state.phase = 'signed-out';
    render();
  } catch (error) {
    if (request !== generation) return;
    if (error instanceof ApiError && error.status === 503) {
      state.phase = 'auth-unconfigured';
      render();
    } else fail(error);
  }
}

async function bootstrap(): Promise<void> {
  const request = ++generation;
  ++authGeneration;
  pendingMutations.clear();
  state.phase = 'loading';
  state.meterLoading = false;
  state.refreshFailed = false;
  state.notice = null;
  render();
  try {
    await api.session();
    if (request !== generation) return;
    await refreshMeters(undefined, request);
  } catch (error) {
    if (request !== generation) return;
    if (error instanceof ApiError && error.status === 401) {
      await signedOut();
    } else if (error instanceof ApiError && error.status === 503) {
      state.phase = 'auth-unconfigured';
      render();
    } else fail(error);
  }
}

function fail(error: unknown): void {
  state.phase = 'error';
  state.errorText = friendlyError(error);
  render();
}

async function refreshMeters(preferredMeterId?: string, request = generation): Promise<void> {
  // The runtime currently only presents electricity meters; the gas UI opens
  // together with its domain support and never mixes utilities in one view.
  const meters = (await api.meters()).filter(meter => meter.utilityKind === 'electricity');
  if (request !== generation) return;
  const preferred = preferredMeterId ?? state.selectedMeterId;
  const meterId = meters.some(meter => meter.meterId === preferred) ? preferred : meters[0]?.meterId ?? null;
  const readings = meterId ? await api.readings(meterId) : [];
  if (request !== generation) return;
  state.meters = meters;
  state.selectedMeterId = meterId;
  state.readings = readings;
  state.phase = 'ready';
  state.meterLoading = false;
  state.refreshFailed = false;
  render();
}

async function refreshAfterSave(meterId: string, request: number, savedText: string): Promise<void> {
  try {
    await refreshMeters(meterId, request);
  } catch (error) {
    if (request !== generation) return;
    const notice: Notice = { kind: 'error', text: `${savedText} 최신 정보를 불러오지 못했습니다. ${friendlyError(error)}` };
    if (error instanceof ApiError && error.status === 401) {
      await signedOut(notice);
      return;
    }
    state.notice = notice;
    state.meterLoading = false;
    state.refreshFailed = true;
    render();
  }
}

async function mutationError(error: unknown, request: number): Promise<void> {
  if (request !== generation) return;
  if (error instanceof ApiError && error.status === 401) {
    await signedOut({ kind: 'error', text: friendlyError(error) });
    return;
  }
  state.notice = { kind: 'error', text: friendlyError(error) };
  render();
}

function finishMutation(key: string, token: symbol): void {
  if (pendingMutations.get(key) !== token) return;
  pendingMutations.delete(key);
  if (state.phase === 'ready' && (key === 'create' || key === state.selectedMeterId)) render();
}

async function createMeter(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const key = 'create';
  if (!form.isConnected || state.phase !== 'ready' || state.meters.length || pendingMutations.has(key)) return;
  const input = settingsInput(form);
  createDraft = input;
  const token = Symbol();
  const request = generation;
  const session = authGeneration;
  pendingMutations.set(key, token);
  state.notice = null;
  render();
  try {
    const meter = await api.createMeter({ ...input, utilityKind: 'electricity' });
    if (session !== authGeneration) return;
    createDraft = null;
    if (request !== generation) return;
    state.meters = [meter];
    state.selectedMeterId = meter.meterId;
    state.readings = [];
    const savedText = '계량기를 만들었습니다.';
    state.notice = { kind: 'success', text: savedText };
    await refreshAfterSave(meter.meterId, request, savedText);
  } catch (error) {
    await mutationError(error, request);
  } finally {
    finishMutation(key, token);
  }
}

function canSubmit(form: HTMLFormElement, meter: MeterResource, request: number): boolean {
  return form.isConnected && state.phase === 'ready' && !state.meterLoading
    && request === generation && state.selectedMeterId === meter.meterId
    && meter.role === 'owner' && !pendingMutations.has(meter.meterId);
}

async function saveMeterSettings(event: SubmitEvent, meter: MeterResource, request: number): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  if (!canSubmit(form, meter, request)) return;
  const input = settingsInput(form);
  settingsDrafts.set(meter.meterId, input);
  const token = Symbol();
  const session = authGeneration;
  pendingMutations.set(meter.meterId, token);
  state.notice = null;
  state.refreshFailed = false;
  render();
  try {
    const updated = await api.updateMeter(meter.meterId, input);
    if (session !== authGeneration) return;
    settingsDrafts.delete(meter.meterId);
    if (state.phase !== 'ready' || state.selectedMeterId !== meter.meterId) return;
    const refreshRequest = ++generation;
    state.meters = state.meters.map(item => item.meterId === updated.meterId ? updated : item);
    const savedText = '계량기 설정을 저장했습니다.';
    state.notice = { kind: 'success', text: savedText };
    await refreshAfterSave(meter.meterId, refreshRequest, savedText);
  } catch (error) {
    await mutationError(error, request);
  } finally {
    finishMutation(meter.meterId, token);
  }
}

async function createReading(event: SubmitEvent, meter: MeterResource, request: number): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const input = form.querySelector<HTMLInputElement>('#meter-reading');
  if (!canSubmit(form, meter, request) || !input || !validReading(input.value)) return;
  const value = input.value;
  readingDrafts.set(meter.meterId, value);
  const token = Symbol();
  const session = authGeneration;
  pendingMutations.set(meter.meterId, token);
  state.notice = null;
  state.refreshFailed = false;
  render();
  try {
    const reading = await api.createReading(meter.meterId, { measuredAtMs: Date.now(), cumulativeValue: value });
    if (session !== authGeneration) return;
    readingDrafts.delete(meter.meterId);
    if (state.phase !== 'ready' || state.selectedMeterId !== meter.meterId) return;
    const refreshRequest = ++generation;
    state.readings = [...state.readings.filter(item => item.readingId !== reading.readingId), reading];
    const savedText = `${value} kWh 기록을 저장했습니다.`;
    state.notice = { kind: 'success', text: savedText };
    await refreshAfterSave(meter.meterId, refreshRequest, savedText);
  } catch (error) {
    await mutationError(error, request);
  } finally {
    finishMutation(meter.meterId, token);
  }
}

function validReading(value: string): boolean {
  if (value.length === 0 || value.length > 15 || !/^\d+(?:\.\d{1,3})?$/.test(value)) return false;
  try {
    parseCumulativeKwhToWh(value);
    return true;
  } catch {
    return false;
  }
}

function bindLogout(): void {
  document.querySelector<HTMLButtonElement>('#logout-button')?.addEventListener('click', async () => {
    const request = ++generation;
    ++authGeneration;
    pendingMutations.clear();
    readingDrafts.clear();
    settingsDrafts.clear();
    createDraft = null;
    state.phase = 'loading';
    render();
    try {
      await api.logout();
      if (request === generation) await bootstrap();
    } catch (error) {
      if (request === generation) fail(error);
    }
  });
}

function bindMeterSelection(): void {
  document.querySelector<HTMLSelectElement>('#meter-select')?.addEventListener('change', async event => {
    const meterId = (event.currentTarget as HTMLSelectElement).value;
    const request = ++generation;
    state.notice = null;
    state.refreshFailed = false;
    state.selectedMeterId = meterId;
    state.readings = [];
    state.meterLoading = true;
    render();
    try {
      const readings = await api.readings(meterId);
      if (request !== generation) return;
      state.readings = readings;
      state.meterLoading = false;
      render();
    } catch (error) {
      if (request !== generation) return;
      if (error instanceof ApiError && error.status === 401) {
        await signedOut({ kind: 'error', text: friendlyError(error) });
      } else fail(error);
    }
  });
}

function restoreSettingsForm(form: HTMLFormElement, draft: MeterSettingsInput | null, pending: boolean): void {
  if (draft) {
    (form.elements.namedItem('name') as HTMLInputElement).value = draft.name;
    (form.elements.namedItem('timezone') as HTMLInputElement).value = draft.timezone;
    (form.elements.namedItem('billingClose') as HTMLSelectElement).value = draft.billingClose.kind === 'month-end'
      ? 'month-end' : String(draft.billingClose.day);
  }
  form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button')
    .forEach(control => { control.disabled = pending; });
}

function bindReadyEvents(meter: MeterResource): void {
  bindLogout();
  bindMeterSelection();
  const request = generation;
  const pending = pendingMutations.has(meter.meterId);
  const input = document.querySelector<HTMLInputElement>('#meter-reading');
  const button = document.querySelector<HTMLButtonElement>('#record-button');
  if (input && button && meter.role === 'owner') {
    input.value = readingDrafts.get(meter.meterId) ?? '';
    input.disabled = pending;
    const updateInput = (): void => {
      readingDrafts.set(meter.meterId, input.value);
      input.classList.toggle('long-value', input.value.length > 9);
      button.disabled = pending || !validReading(input.value);
    };
    updateInput();
    input.addEventListener('input', updateInput);
  }
  document.querySelector<HTMLFormElement>('#reading-form')?.addEventListener('submit', event => void createReading(event, meter, request));
  const settings = document.querySelector<HTMLFormElement>('#meter-settings-form');
  if (settings) {
    restoreSettingsForm(settings, settingsDrafts.get(meter.meterId) ?? null, pending);
    const saveDraft = (): void => { if (!pending) settingsDrafts.set(meter.meterId, settingsInput(settings)); };
    settings.addEventListener('input', saveDraft);
    settings.addEventListener('change', saveDraft);
    settings.addEventListener('submit', event => void saveMeterSettings(event, meter, request));
  }
  document.querySelector<HTMLButtonElement>('#refresh-button')?.addEventListener('click', () => {
    const savedText = state.notice?.text.split(' 최신 정보를')[0] ?? '';
    const refreshRequest = ++generation;
    state.meterLoading = true;
    state.refreshFailed = false;
    state.notice = { kind: 'success', text: savedText };
    render();
    void refreshAfterSave(meter.meterId, refreshRequest, savedText);
  });
}

function navigate(moveFocus: boolean): void {
  if (state.phase !== 'ready' || state.meterLoading || state.meters.length === 0) return;
  const target = location.hash.slice(1);
  const selected = screens.find(screen => screen.id === target) ?? screens[0];
  for (const screen of screens) document.getElementById(screen.id)!.hidden = screen.id !== selected.id;
  document.querySelectorAll<HTMLAnchorElement>('[data-screen]').forEach(link => {
    if (link.dataset.screen === selected.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (moveFocus) document.getElementById(`${selected.id}-title`)!.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => navigate(true));
void bootstrap();
