import { expect, test } from '@playwright/test';

test('immediate entry, valid syntax, feedback and reload-only lifetime', async ({ page }) => {
  await page.goto('/');
  const input = page.getByLabel('현재 계량기', { exact: true });
  const submit = page.getByRole('button', { name: '기록하기' });
  await expect(input).toBeInViewport({ ratio: 1 });
  await expect(submit).toBeInViewport({ ratio: 1 });
  await expect(input).toHaveAttribute('inputmode', 'decimal');
  await expect(submit).toBeDisabled();
  for (const value of [' ', 'abc', '-1', '1e3', '12..3', '.', '12.']) {
    await input.fill(value);
    await expect(submit).toBeDisabled();
  }
  await input.fill('7133.5');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole('status')).toContainText('7133.5 kWh 체험 기록 완료');
  await expect(submit).toBeDisabled();
  await expect(input).toHaveValue('');
  await expect(page.locator('.hero-number')).toContainText('5.0');
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.locator('#reading-list li')).toHaveCount(4);
  await expect(page.locator('#reading-list li').first()).toContainText('7133.5');
  await expect(page.locator('#reading-list li').first()).toContainText('체험 입력 · 임시');
  await page.reload();
  await expect(page.locator('#reading-list li')).toHaveCount(3);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
});

test('navigation, fixed demo meaning, no overflow or bottom overlap', async ({ page }, testInfo) => {
  await page.goto('/');
  for (const [name, id] of [['홈', 'home'], ['기록', 'records'], ['분석', 'analysis'], ['설정', 'settings']]) {
    const link = page.getByRole('link', { name, exact: true });
    await link.click();
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.locator(`#${id}`)).toBeVisible();
    await expect(page.locator('.screen:visible')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const touch = await link.boundingBox();
    expect(touch!.height).toBeGreaterThanOrEqual(44);
    expect(touch!.width).toBeGreaterThanOrEqual(44);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const content = await page.locator(`#${id}`).boundingBox();
    const nav = await page.getByRole('navigation').boundingBox();
    expect(content!.y + content!.height).toBeLessThanOrEqual(nav!.y);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`${id}.png`), fullPage: true });
  }
  await expect(page.getByRole('button', { name: '사용자 초대 · 준비 중' })).toBeDisabled();
  await page.getByRole('link', { name: '분석', exact: true }).click();
  await expect(page.locator('.forecast')).toContainText('548');
  await expect(page.locator('.normalized')).toContainText('522');
  await expect(page.locator('.daily-list')).toContainText('추정·보간');
  await expect(page.locator('.daily-list')).toContainText('경계 측정');
  await page.goBack();
  await expect(page.locator('#settings')).toBeVisible();
});

test('long number fits input and record list, including narrow viewport', async ({ page }, testInfo) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const input = page.getByLabel('현재 계량기', { exact: true });
    await input.fill('999999999999.99');
    await expect(page.getByRole('button', { name: '기록하기' })).toBeEnabled();
    expect(await input.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`long-input-${width}.png`) });
    await page.getByRole('button', { name: '기록하기' }).click();
    await page.getByRole('link', { name: '기록', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const value = page.locator('#reading-list li').first().locator('strong');
    expect(await value.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
});

test('local assets only, no runtime errors, keyboard focus and timezone rendering', async ({ page, browserName }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4173') external.push(request.url());
  });
  await page.goto('/');
  await page.keyboard.press('Tab');
  // WebKit's default Tab navigation skips links; Chromium includes them.
  if (browserName !== 'webkit') {
    await expect(page.getByRole('link', { name: '우리집 전기 홈' })).toBeFocused();
    expect(await page.locator(':focus').evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Tab');
  }
  await expect(page.getByLabel('현재 계량기', { exact: true })).toBeFocused();
  expect(await page.locator(':focus').evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.locator('#records-title')).toBeFocused();
  await expect(page.locator('#reading-list li').first()).toContainText('18:30');
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
