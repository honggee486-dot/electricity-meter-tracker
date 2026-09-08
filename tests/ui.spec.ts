import { expect, test } from '@playwright/test';

const NOW_MS = Date.parse('2026-09-09T09:00:00+09:00');
const CLIENT_ID = 'client-123.apps.googleusercontent.com';

const ownerMeter = {
  meterId: 'meter-1',
  name: '우리집 전기',
  timezone: 'Asia/Seoul',
  billingClose: { kind: 'day', day: 21 },
  role: 'owner',
  createdAtMs: 1,
  updatedAtMs: 1,
};

const baseReadings = [
  ['reading-0', '2026-08-21T00:00:00+09:00', 6800000],
  ['reading-1', '2026-08-23T00:00:00+09:00', 6820000],
  ['reading-2', '2026-09-07T20:15:00+09:00', 7118000],
  ['reading-3', '2026-09-08T12:00:00+09:00', 7127000],
  ['reading-4', '2026-09-08T18:30:00+09:00', 7132000],
].map(([readingId, at, cumulativeWh]) => ({
  readingId,
  meterId: 'meter-1',
  measuredAtMs: Date.parse(at),
  cumulativeWh,
  createdAtMs: Date.parse(at),
}));

async function installApiMock(page, options = {}) {
  await page.unroute('**/api/**').catch(() => undefined);
  await page.unroute('https://accounts.google.com/gsi/client').catch(() => undefined);
  const control = {
    authenticated: options.auth !== 'signed-out',
    unconfigured: options.auth === 'unconfigured',
    failMeters: options.failMeters === true,
    loginErrorDetail: options.loginErrorDetail ?? null,
    meters: structuredClone(options.meters ?? [ownerMeter]),
    readings: structuredClone(options.readings ?? baseReadings),
    lastReadingPost: null,
    lastMeterPut: null,
    loginCredential: null,
    loginCsrfToken: null,
  };

  await page.addInitScript(now => { Date.now = () => now; }, NOW_MS);
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `window.google={accounts:{id:{initialize(o){window.__googleInit=o},renderButton(el){const b=document.createElement('button');b.type='button';b.textContent='Google 테스트 로그인';b.onclick=()=>window.__googleInit.callback({credential:'credential-1'});el.appendChild(b)}}}};`,
  }));

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/session' && method === 'GET') {
      if (control.unconfigured) return json(503, { error: { code: 'AUTH_NOT_CONFIGURED', message: 'not configured' } });
      if (!control.authenticated) return json(401, { error: { code: 'UNAUTHENTICATED', message: 'login' } });
      return json(200, { authenticated: true, userId: 'owner-1' });
    }
    if (path === '/api/auth/config' && method === 'GET') {
      if (control.unconfigured) return json(503, { error: { code: 'AUTH_NOT_CONFIGURED', message: 'not configured' } });
      return json(200, { googleClientId: CLIENT_ID });
    }
    if (path === '/api/auth/google' && method === 'POST') {
      const form = new URLSearchParams(request.postData() ?? '');
      control.loginCredential = form.get('credential');
      control.loginCsrfToken = form.get('g_csrf_token');
      if (control.loginErrorDetail) {
        return json(401, {
          error: { code: 'INVALID_GOOGLE_CREDENTIAL', message: control.loginErrorDetail },
        });
      }
      control.authenticated = true;
      return json(200, { authenticated: true, userId: 'owner-1' });
    }
    if (path === '/api/auth/logout' && method === 'POST') {
      control.authenticated = false;
      return json(200, { authenticated: false });
    }
    if (path === '/api/meters' && method === 'GET') {
      if (control.failMeters) return json(500, { error: { code: 'PERSISTENCE_ERROR', message: 'failed' } });
      return json(200, { meters: control.meters });
    }
    if (path === '/api/meters' && method === 'POST') {
      const input = request.postDataJSON();
      const meter = {
        meterId: 'meter-created', name: input.name, timezone: input.timezone,
        billingClose: input.billingClose, role: 'owner', createdAtMs: NOW_MS, updatedAtMs: NOW_MS,
      };
      control.meters.push(meter);
      control.readings = [];
      return json(201, { meter });
    }
    const meterMatch = /^\/api\/meters\/([^/]+)$/.exec(path);
    if (meterMatch && method === 'PUT') {
      const input = request.postDataJSON();
      control.lastMeterPut = input;
      const meter = control.meters.find(item => item.meterId === meterMatch[1]);
      Object.assign(meter, input, { updatedAtMs: NOW_MS });
      return json(200, { meter });
    }
    const readingsMatch = /^\/api\/meters\/([^/]+)\/readings$/.exec(path);
    if (readingsMatch && method === 'GET') return json(200, { readings: control.readings });
    if (readingsMatch && method === 'POST') {
      const input = request.postDataJSON();
      control.lastReadingPost = input;
      const reading = {
        readingId: `reading-${control.readings.length + 1}`,
        meterId: readingsMatch[1],
        measuredAtMs: input.measuredAtMs,
        cumulativeWh: Math.round(Number(input.cumulativeKwh) * 1000),
        createdAtMs: NOW_MS,
      };
      control.readings.push(reading);
      return json(201, { reading });
    }
    return json(404, { error: { code: 'NOT_FOUND', message: 'not found' } });
  });
  return control;
}

const csrfCookieValue = page => page.evaluate(() => document.cookie
  .split('; ')
  .find(cookie => cookie.startsWith('g_csrf_token='))
  ?.slice('g_csrf_token='.length) ?? '');

test('auth configuration states stay distinct and Google callback completes the existing CSRF-protected login API', async ({ page }) => {
  await installApiMock(page, { auth: 'unconfigured' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '아직 연결 준비 중입니다' })).toBeVisible();
  await expect(page.locator('script[data-google-gis]')).toHaveCount(0);

  const signedOut = await installApiMock(page, { auth: 'signed-out' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Google로 로그인' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Google 테스트 로그인' })).toBeVisible();
  const browserCsrfBeforeLogin = await csrfCookieValue(page);
  expect(browserCsrfBeforeLogin.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Google 테스트 로그인' }).click();
  await expect(page.getByRole('heading', { name: '우리집 전기' })).toBeVisible();
  expect(signedOut.loginCredential).toBe('credential-1');
  expect(typeof signedOut.loginCsrfToken).toBe('string');
  expect(signedOut.loginCsrfToken.length).toBeGreaterThan(0);
  expect(decodeURIComponent(browserCsrfBeforeLogin)).toBe(signedOut.loginCsrfToken);
  expect(await csrfCookieValue(page)).toBe('');
});

test('Google login failure UI does not expose server-side credential diagnostics', async ({ page }) => {
  const diagnosticDetail = 'provider-detail-must-not-reach-ui';
  await installApiMock(page, { auth: 'signed-out', loginErrorDetail: diagnosticDetail });
  await page.goto('/');
  await page.getByRole('button', { name: 'Google 테스트 로그인' }).click();
  await expect(page.getByRole('status')).toHaveText('Google 로그인 정보를 확인하지 못했습니다. 다시 시도해 주세요.');
  await expect(page.getByText(diagnosticDetail)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Google로 로그인' })).toBeVisible();
});

test('owner quick entry persists through API, reloads raw readings, and recalculates live metrics', async ({ page }) => {
  const control = await installApiMock(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '우리집 전기' })).toBeVisible();
  await expect(page.locator('.hero-number')).toContainText('5.0');

  const input = page.getByRole('textbox', { name: '현재 계량기' });
  const submit = page.getByRole('button', { name: '기록하기' });
  await expect(submit).toBeDisabled();
  for (const value of [' ', 'abc', '-1', '1e3', '12..3', '.', '12.', '12.1234']) {
    await input.fill(value);
    await expect(submit).toBeDisabled();
  }
  await input.fill('7133.5');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole('status')).toContainText('7133.5 kWh 기록을 저장했습니다');
  expect(control.lastReadingPost).toEqual({ measuredAtMs: NOW_MS, cumulativeKwh: '7133.5' });
  await expect(page.locator('.hero-number')).toContainText('1.5');
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.locator('.reading-list li')).toHaveCount(baseReadings.length + 1);
  await expect(page.locator('.reading-list li').first()).toContainText('7133.5');
});

test('owner can save day or month-end billing close while viewer remains read-only', async ({ page }) => {
  const control = await installApiMock(page);
  await page.goto('/#settings');
  await expect(page.locator('#settings')).toBeVisible();
  await page.getByLabel('검침 마감').selectOption('month-end');
  await page.getByRole('button', { name: '설정 저장' }).click();
  expect(control.lastMeterPut.billingClose).toEqual({ kind: 'month-end' });
  await expect(page.getByLabel('검침 마감')).toHaveValue('month-end');

  const viewer = { ...ownerMeter, role: 'viewer', name: '공유 계량기' };
  await installApiMock(page, { meters: [viewer] });
  await page.reload();
  await expect(page.locator('.role-badge')).toContainText('조회 전용');
  await page.getByRole('link', { name: '홈', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '현재 계량기' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '조회 전용' })).toBeDisabled();
  await page.getByRole('link', { name: '설정', exact: true }).click();
  await expect(page.locator('#meter-settings-form')).toHaveCount(0);
  await expect(page.locator('#settings')).toContainText('매월 21일');
});

test('first login with no meters can create one without client-controlled owner or resource ids', async ({ page }) => {
  const control = await installApiMock(page, { meters: [], readings: [] });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '계량기를 추가하세요' })).toBeVisible();
  await page.getByLabel('계량기 이름').fill('작업실');
  await page.getByLabel('검침 마감').selectOption('30');
  await expect(page.getByText('29~31일이 없는 달은 그 달 월말로 자동 보정됩니다.')).toBeVisible();
  await page.getByRole('button', { name: '계량기 만들기' }).click();
  await expect(page.getByRole('heading', { name: '작업실' })).toBeVisible();
  expect(control.meters[0].billingClose).toEqual({ kind: 'day', day: 30 });
  expect(Object.hasOwn(control.meters[0], 'ownerUserId')).toBe(false);
});

test('API failures are visible and do not fall back to sample data', async ({ page }) => {
  await installApiMock(page, { failMeters: true });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '불러오지 못했습니다' })).toBeVisible();
  await expect(page.getByText('요청을 처리하지 못했습니다. (PERSISTENCE_ERROR)')).toBeVisible();
  await expect(page.getByText('SAMPLE / DEMO')).toHaveCount(0);
});

test('live UI keeps navigation, keyboard focus, timezone rendering, and narrow viewport containment', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await installApiMock(page);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const input = page.getByRole('textbox', { name: '현재 계량기' });
    await input.fill('999999999999.99');
    await expect(page.getByRole('button', { name: '기록하기' })).toBeEnabled();
    expect(await input.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '우리집 전기' })).toBeVisible();
  const brand = page.getByRole('link', { name: '전기 기록 홈' });
  await brand.focus();
  await expect(brand).toBeFocused();
  const input = page.getByRole('textbox', { name: '현재 계량기' });
  for (let attempts = 0; attempts < 10 && !(await input.evaluate(el => el === document.activeElement)); attempts += 1) {
    await page.keyboard.press('Tab');
  }
  await expect(input).toBeFocused();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.locator('#records-title')).toBeFocused();
  await expect(page.locator('.reading-list li').first()).toContainText('18:30');
  await page.getByRole('link', { name: '분석', exact: true }).click();
  await expect(page.locator('.daily-list')).toContainText('추정·보간');
  expect(pageErrors).toEqual([]);
});