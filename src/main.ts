import { api, ApiError, type AuthConfigResponse, type BillingClose, type MeterResource, type MeterSettingsInput, type ReadingResource, type UtilityKind } from './api';
import { parseCumulativeCounter } from './domain/counter';
import {
  formatCounterValue,
  formatFlow,
  presentationFor,
  UTILITY_ORDER,
  utilityView,
  type UtilityView,
} from './presentation';
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

const UTILITY_STORAGE_KEY = 'em-utility';

function readStoredUtility(): UtilityKind | null {
  try {
    const stored = localStorage.getItem(UTILITY_STORAGE_KEY);
    return stored === 'gas' || stored === 'electricity' ? stored : null;
  } catch {
    return null;
  }
}

// The tab choice is a best-effort UI preference only; the first visit without a
// stored choice lands on a utility that actually has meters.
let storedUtilityPreference: UtilityKind | null = readStoredUtility();

function rememberUtility(utility: UtilityKind): void {
  storedUtilityPreference = utility;
  try {
    localStorage.setItem(UTILITY_STORAGE_KEY, utility);
  } catch {
    // Preference persistence is optional.
  }
}

interface State {
  phase: Phase;
  authConfig: AuthConfigResponse | null;
  utility: UtilityKind;
  meters: MeterResource[];
  selectedMeterId: string | null;
  readings: ReadingResource[];
  notice: Notice;
  errorText: string;
  meterLoading: boolean;
  refreshFailed: boolean;
}

const screens: { id: Screen; label: string; icon: string }[] = [
  { id: 'home', label: '홈', icon: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z"/>' },
  { id: 'records', label: '기록', icon: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>' },
  { id: 'analysis', label: '분석', icon: '<path d="M4 20V10m8 10V4m8 16v-7"/>' },
  { id: 'settings', label: '설정', icon: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>' },
];

const app = document.querySelector<HTMLDivElement>('#app')!;
const state: State = {
  phase: 'loading', authConfig: null, utility: storedUtilityPreference ?? 'electricity', meters: [], selectedMeterId: null,
  readings: [], notice: null, errorText: '',
  meterLoading: false, refreshFailed: false,
};

// Requests may finish after another selection or another authenticated session.
let generation = 0;
let authGeneration = 0;
const pendingMutations = new Map<string, symbol>();
const readingDrafts = new Map<string, string>();
const settingsDrafts = new Map<string, MeterSettingsInput>();
const createDrafts = new Map<UtilityKind, MeterSettingsInput>();
const lastMeterIdByUtility: Partial<Record<UtilityKind, string>> = {};

function settingsInput(form: HTMLFormElement): MeterSettingsInput {
  const data = new FormData(form);
  return {
    name: String(data.get('name') ?? ''),
    timezone: String(data.get('timezone') ?? ''),
    billingClose: parseCloseValue(String(data.get('billingClose') ?? '21')),
  };
}

const metersFor = (utility: UtilityKind): MeterResource[] => state.meters.filter(meter => meter.utilityKind === utility);
const selectedMeter = (): MeterResource | null => metersFor(state.utility).find(meter => meter.meterId === state.selectedMeterId) ?? null;

const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
})[char]!);
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

const utilitySwitchHtml = (): string => `<div class="utility-switch" role="group" aria-label="계량기 종류">${UTILITY_ORDER.map(kind => {
  const item = presentationFor(kind);
  return `<button type="button" data-utility="${kind}" aria-pressed="${state.utility === kind}">${escapeHtml(item.label)}</button>`;
}).join('')}</div>`;

function bindUtilitySwitch(): void {
  document.querySelectorAll<HTMLButtonElement>('.utility-switch [data-utility]').forEach(button => {
    button.addEventListener('click', () => {
      const kind = button.dataset.utility;
      if ((kind === 'electricity' || kind === 'gas') && kind !== state.utility) {
        void switchUtility(kind);
      }
    });
  });
}

function meterToolbar(meter: MeterResource): string {
  const utilityMeters = metersFor(meter.utilityKind);
  return `<section class="meter-toolbar" aria-label="현재 계량기"><label for="meter-select">계량기</label><select id="meter-select">${utilityMeters.map(item => `<option value="${escapeHtml(item.meterId)}"${item.meterId === meter.meterId ? ' selected' : ''}>${escapeHtml(item.name)} · ${item.role}</option>`).join('')}</select>${meter.role === 'owner' ? '' : '<span class="role-badge viewer">viewer · 조회 전용</span>'}</section>`;
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

  const presentation = presentationFor(state.utility);
  if (metersFor(state.utility).length === 0) {
    app.innerHTML = shell(`<section class="state-panel" aria-labelledby="create-title">${utilitySwitchHtml()}<p class="eyebrow">계량기 추가</p><h1 id="create-title">${escapeHtml(presentation.label)} 계량기를 추가하세요</h1><p class="state-copy">이름, 시간대, 검침 마감 기준만 정하면 바로 기록을 시작할 수 있습니다.</p>
      ${noticeHtml()}
      <form id="meter-create-form" class="stack-form">
        <label>계량기 이름<input name="name" required maxlength="80" value="${escapeHtml(presentation.defaultMeterName)}"></label>
        <label>시간대<input name="timezone" required value="Asia/Seoul"></label>
        <label>검침 마감<select name="billingClose">${closeSelectOptions()}</select></label><p class="field-help">29~31일이 없는 달은 그 달 월말로 자동 보정됩니다. 월말을 고르면 매달 실제 마지막 날을 사용합니다.</p>
        <button class="primary" type="submit">${escapeHtml(presentation.label)} 계량기 만들기</button>
      </form></section>`);
    bindLogout();
    bindUtilitySwitch();
    const form = document.querySelector<HTMLFormElement>('#meter-create-form')!;
    const pending = pendingMutations.has('create');
    restoreSettingsForm(form, createDrafts.get(state.utility) ?? null, pending);
    const saveDraft = (): void => { if (!pending) createDrafts.set(state.utility, settingsInput(form)); };
    form.addEventListener('input', saveDraft);
    form.addEventListener('change', saveDraft);
    form.addEventListener('submit', event => void createMeter(event));
    return;
  }

  const meter = selectedMeter();
  if (meter === null) {
    void refreshMeters();
    return;
  }
  if (state.meterLoading) {
    app.innerHTML = shell(`${utilitySwitchHtml()}${meterToolbar(meter)}<p class="state-copy" role="status">${escapeHtml(meter.name)} 기록을 불러오는 중입니다.</p>`);
    bindLogout();
    bindUtilitySwitch();
    bindMeterSelection();
    return;
  }
  let view: UtilityView;
  try {
    view = utilityView(meter, state.readings, Date.now());
  } catch (error) {
    state.phase = 'error';
    state.errorText = friendlyError(error);
    render();
    return;
  }
  const isOwner = meter.role === 'owner';
  const readingRows = [...state.readings].sort((a, b) => b.measuredAtMs - a.measuredAtMs);
  const dateTime = new Intl.DateTimeFormat('ko-KR', {
    timeZone: meter.timezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const cycleCell = (value: number | null | undefined): string => value === null || value === undefined
    ? '자료 부족'
    : `${value.toFixed(1)} ${escapeHtml(presentation.counterUnit)}`;

  app.innerHTML = shell(`
    ${utilitySwitchHtml()}
    ${meterToolbar(meter)}
    ${noticeHtml()}
    <section id="home" class="screen" aria-labelledby="home-title">
      <div class="page-heading"><p class="eyebrow">빠른 기록</p><h1 id="home-title" tabindex="-1">${escapeHtml(meter.name)}</h1><p>현재 검침기간 <strong>${view.liveCycle.displayStartLocalDate} ~ ${view.liveCycle.displayEndLocalDate}</strong></p></div>
      <form id="reading-form" class="reading-form">
        <label for="meter-reading">현재 계량기</label>
        <div class="reading-input"><input id="meter-reading" name="reading" type="text" inputmode="decimal" maxlength="15" autocomplete="off" spellcheck="false" placeholder="${view.latestReadingCounter !== null ? escapeHtml(formatCounterValue(view.latestReadingCounter)) : `누적 ${escapeHtml(presentation.counterUnit)}`}" ${isOwner ? '' : 'disabled'} aria-describedby="reading-hint" required><span>${escapeHtml(presentation.counterUnit)}</span></div>
        <p id="reading-hint">${isOwner ? escapeHtml(presentation.readingPrecisionNote) : 'viewer는 기록을 추가할 수 없습니다.'}</p>
        <button id="record-button" class="primary" type="submit" disabled>${isOwner ? '기록하기' : '조회 전용'}</button>
      </form>
      <section class="interval" aria-labelledby="interval-title"><div class="section-heading"><h2 id="interval-title">직전 기록 이후</h2><span class="subtle">실제 기록 기준</span></div><p class="hero-number">${view.latestIntervalUsage !== null ? `${view.latestIntervalUsage.toFixed(1)} <small>${escapeHtml(presentation.counterUnit)}</small>` : '자료 부족'}</p><dl class="interval-details"><div><dt>경과시간</dt><dd>${view.latestIntervalElapsedMs !== null ? formatHours(view.latestIntervalElapsedMs) : '자료 부족'}</dd></div><div><dt>${escapeHtml(presentation.flowTitle)}</dt><dd>${view.latestIntervalFlow !== null ? escapeHtml(formatFlow(view.latestIntervalFlow, presentation)) : '자료 부족'}</dd></div></dl></section>
      <section class="cycle-summary" aria-labelledby="cycle-title"><div class="section-heading"><h2 id="cycle-title">이번 검침주기</h2><span class="deadline">마감까지 약 ${Math.max(0, Math.ceil(view.liveCycle.remainingMs / 86_400_000))}일</span></div><dl class="summary-list"><div><dt>최신 기록까지</dt><dd>${cycleCell(view.currentCycle?.usageToDate)}</dd></div><div><dt>최근 완전 일평균 · 최대 7일</dt><dd>${view.recentDailyAverage !== null ? `${view.recentDailyAverage.toFixed(1)} ${escapeHtml(presentation.dailyUnit)}` : '자료 부족'}</dd></div><div><dt>마감 예상 사용량</dt><dd>${cycleCell(view.currentCycle?.projectedClose)}</dd></div><div><dt>${escapeHtml(presentation.tariffTitle)}</dt><dd>${view.tariff ? escapeHtml(view.tariff.amount) : '요금 정책 연결 전'}</dd></div></dl><p class="note">${escapeHtml(view.tariff ? view.tariff.note : presentation.tariffFallbackNote)}</p></section>
    </section>
    <section id="records" class="screen" aria-labelledby="records-title" hidden><div class="page-heading"><p class="eyebrow">원본 기록</p><h1 id="records-title" tabindex="-1">기록</h1><p>${escapeHtml(meter.timezone)}</p></div>${readingRows.length ? `<ul class="reading-list">${readingRows.map(reading => `<li><span><time datetime="${new Date(reading.measuredAtMs).toISOString()}">${dateTime.format(reading.measuredAtMs)}</time><small>실제 측정</small></span><strong>${escapeHtml(formatCounterValue(reading.cumulativeMilliUnit))}<small> ${escapeHtml(presentation.counterUnit)}</small></strong></li>`).join('')}</ul>` : '<p class="empty-state">아직 기록이 없습니다.</p>'}</section>
    <section id="analysis" class="screen" aria-labelledby="analysis-title" hidden><div class="page-heading"><p class="eyebrow">저장된 기록으로 계산</p><h1 id="analysis-title" tabindex="-1">분석</h1></div><dl class="analysis-list"><div><dt>현재 검침주기 평균</dt><dd>${view.currentCycle?.averageDailyUsage !== null && view.currentCycle?.averageDailyUsage !== undefined ? `${view.currentCycle.averageDailyUsage.toFixed(1)} ${escapeHtml(presentation.dailyUnit)}` : '자료 부족'}</dd></div><div class="forecast"><dt>검침 마감 예상</dt><dd>${cycleCell(view.currentCycle?.projectedClose)}</dd></div><div class="normalized"><dt>30일 환산</dt><dd>${cycleCell(view.currentCycle?.normalized30Day)}</dd></div><div><dt>이전 주기 대비</dt><dd>${view.comparison ? `${view.comparison.delta >= 0 ? '+' : ''}${view.comparison.delta.toFixed(1)} ${escapeHtml(presentation.counterUnit)}${view.comparison.percent === null ? '' : ` · ${view.comparison.percent.toFixed(1)}%`}` : '자료 부족'}</dd></div></dl>${view.confidence ? `<p class="note">관측 범위 ${(view.confidence.observationCoverageRatio * 100).toFixed(0)}% · 최근 완전 일자 ${view.confidence.recentFullDaysUsed}/${view.confidence.requestedRecentDays}일 · 시작 경계 ${view.confidence.startBoundaryProvenance ?? '자료 부족'}</p>` : '<p class="note">예측 신뢰도를 판단할 기록이 아직 부족합니다.</p>'}<section class="daily"><h2>일별 사용량</h2><p class="note">기록 사이 관측 구간의 합계로, 하루 전체 사용량과 다를 수 있습니다.</p>${view.daily.length ? `<ul class="daily-list">${view.daily.map(day => `<li><span>${day.localDate.slice(5).replace('-', '/')}</span><strong>${day.usage.toFixed(1)}<small> ${escapeHtml(presentation.counterUnit)}</small></strong><span class="basis">${day.interpolated ? '추정·보간' : '실측 구간'}</span></li>`).join('')}</ul>` : '<p class="empty-state">일별 사용량을 계산할 구간이 없습니다.</p>'}</section></section>
    <section id="settings" class="screen" aria-labelledby="settings-title" hidden><div class="page-heading"><p class="eyebrow">계량기 기준</p><h1 id="settings-title" tabindex="-1">설정</h1><p>${isOwner ? '소유자만 변경할 수 있습니다.' : '공유받은 계량기는 조회만 가능합니다.'}</p></div>${isOwner ? `<form id="meter-settings-form" class="stack-form"><p class="meter-kind">계량기 종류 ${escapeHtml(presentation.label)} · 생성 후 변경할 수 없습니다</p><label>계량기 이름<input name="name" required maxlength="80" value="${escapeHtml(meter.name)}"></label><label>시간대<input name="timezone" required value="${escapeHtml(meter.timezone)}"></label><label>검침 마감<select name="billingClose">${closeSelectOptions(meter.billingClose)}</select></label><p class="field-help">29~31일이 없는 달은 그 달 월말로 자동 보정됩니다. 월말은 매달 실제 마지막 날입니다.</p><button class="primary" type="submit">설정 저장</button></form>` : `<dl class="settings-list"><div><dt>계량기 종류</dt><dd>${escapeHtml(presentation.label)}</dd></div><div><dt>계량기 이름</dt><dd>${escapeHtml(meter.name)}</dd></div><div><dt>검침 마감</dt><dd>${closeLabel(meter.billingClose)}</dd></div><div><dt>시간대</dt><dd>${escapeHtml(meter.timezone)}</dd></div></dl><p class="note">29~31일 고정 마감은 해당 날짜가 없는 달에 그 달 월말로 자동 보정됩니다. 월말 설정은 매달 실제 마지막 날입니다. viewer 권한은 계량기 설정과 원본 기록을 변경할 수 없습니다.</p>`}</section>
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
  createDrafts.clear();
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
  const meters = await api.meters();
  if (request !== generation) return;
  if (storedUtilityPreference === null) {
    const utilityWithMeters = UTILITY_ORDER.find(kind => meters.some(meter => meter.utilityKind === kind));
    if (utilityWithMeters !== undefined) state.utility = utilityWithMeters;
  }
  const utilityMeters = meters.filter(meter => meter.utilityKind === state.utility);
  const preferred = preferredMeterId ?? lastMeterIdByUtility[state.utility] ?? state.selectedMeterId;
  const meterId = utilityMeters.some(meter => meter.meterId === preferred)
    ? preferred as string
    : utilityMeters[0]?.meterId ?? null;
  if (meterId !== null) lastMeterIdByUtility[state.utility] = meterId;
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

async function switchUtility(utility: UtilityKind): Promise<void> {
  state.utility = utility;
  rememberUtility(utility);
  const utilityMeters = metersFor(utility);
  const remembered = lastMeterIdByUtility[utility];
  const meterId = remembered !== undefined && utilityMeters.some(meter => meter.meterId === remembered)
    ? remembered
    : utilityMeters[0]?.meterId ?? null;
  state.selectedMeterId = meterId;
  state.readings = [];
  state.notice = null;
  state.refreshFailed = false;
  if (meterId === null) {
    state.meterLoading = false;
    render();
    return;
  }
  lastMeterIdByUtility[utility] = meterId;
  await selectMeter(meterId);
}

async function selectMeter(meterId: string): Promise<void> {
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
}

async function createMeter(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const key = 'create';
  if (!form.isConnected || state.phase !== 'ready' || metersFor(state.utility).length || pendingMutations.has(key)) return;
  const input = settingsInput(form);
  createDrafts.set(state.utility, input);
  const token = Symbol();
  const request = generation;
  const session = authGeneration;
  pendingMutations.set(key, token);
  state.notice = null;
  render();
  try {
    const meter = await api.createMeter({ ...input, utilityKind: state.utility });
    if (session !== authGeneration) return;
    createDrafts.delete(state.utility);
    if (request !== generation) return;
    state.meters = [...state.meters, meter];
    lastMeterIdByUtility[meter.utilityKind] = meter.meterId;
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
    const savedText = `${value} ${presentationFor(meter.utilityKind).counterUnit} 기록을 저장했습니다.`;
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
    parseCumulativeCounter(value, 0);
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
    createDrafts.clear();
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
  document.querySelector<HTMLSelectElement>('#meter-select')?.addEventListener('change', event => {
    void selectMeter((event.currentTarget as HTMLSelectElement).value);
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
  bindUtilitySwitch();
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
  if (state.phase !== 'ready' || state.meterLoading || metersFor(state.utility).length === 0) return;
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
