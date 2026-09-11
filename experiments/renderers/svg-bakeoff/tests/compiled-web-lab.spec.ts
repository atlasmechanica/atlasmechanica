import { test, expect, type Page, type Locator } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const url = 'http://127.0.0.1:4174/__tests__/compiled-labs/';
const hostile = 'Test data: "quoted" & </script><img src=x onerror=window.__atlasInjected=true> 日本語';
const cases = [
  { id: 'test:web-open', ratio: '0.750', output: '28.1 rpm', angle: '12.5', speed: '37.5' },
  { id: 'test:web-crossed', ratio: '0.375', output: '11.2 rpm', angle: '0', speed: '30' },
  { id: 'test:web-guided', ratio: '0.818', output: '24.5 rpm', angle: '0', speed: '30' },
];
function lab(page: Page, id: string) { return page.locator(`[data-case="${id}"] [data-mechanism-lab]`); }
async function ready(root: Locator) {
  await expect(root.locator('[data-renderer] svg')).toHaveCount(1);
  await expect(root).not.toHaveAttribute('aria-busy', 'true');
  await expect(root.locator('[data-status]')).not.toContainText('could not be initialized');
}
async function setControl(root: Locator, id: string, value: number) {
  await root.locator(`[data-control-id="${id}"]`).evaluate((input: HTMLInputElement, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function arclength(root: Locator) {
  const value = await root.locator('[data-renderer-three]').getAttribute('data-material-arclength');
  expect(value).not.toBeNull();
  return Number(value);
}

test('test fixture is excluded from the production output', async () => {
  expect(existsSync(resolve('../../../apps/web/dist/index.html'))).toBe(true);
  expect(existsSync(resolve('../../../apps/web/dist/__tests__'))).toBe(false);
});

test('SSR retains JSON presets, fractional values and escaped literal text without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(url);
    for (const item of cases) {
      const root = lab(page, item.id);
      await expect(root.locator('[data-control-id="driver-angle"]')).toHaveValue(item.angle);
      await expect(root.locator('[data-control-id="driver-speed"]')).toHaveValue(item.speed);
      await expect(root.locator('[data-readout-id="speed-ratio"]')).toHaveText(item.ratio);
      await expect(root.locator('[data-readout-id="output-speed"]')).toHaveText(item.output);
      const payload = JSON.parse((await root.getAttribute('data-lab-presentation'))!);
      expect(Object.keys(payload).sort()).toEqual(['definition', 'templateLabId']);
      expect(payload.definition.id).toBe(item.id);
    }
    const open = lab(page, 'test:web-open');
    await expect(open.locator('[data-control-output-id="driver-angle"]')).toHaveText('12.5°');
    await expect(open.locator('[data-control-output-id="driver-speed"]')).toHaveText('37.5 rpm');
    await expect(open.locator('.lab-toolbar__identity span')).toHaveText(hostile);
    await expect(page.locator('img[src="x"], [onerror]')).toHaveCount(0);
    await expect(page.locator('[data-renderer] svg')).toHaveCount(0);
  } finally { await context.close(); }
});

test('hydrates every compiled lab with the same values and keeps legacy/default state separate', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  for (const item of cases) {
    const root = lab(page, item.id);
    await ready(root);
    await expect(root.locator('[data-control-id="driver-angle"]')).toHaveValue(item.angle);
    await expect(root.locator('[data-control-id="driver-speed"]')).toHaveValue(item.speed);
    await expect(root.locator('[data-readout-id="speed-ratio"]')).toHaveText(item.ratio);
    await expect(root.locator('[data-readout-id="output-speed"]')).toHaveText(item.output);
  }
  const legacy = lab(page, 'legacy');
  await ready(legacy);
  expect(await legacy.getAttribute('data-lab-presentation')).toBeNull();
  await expect(legacy.locator('[data-readout-id="speed-ratio"]')).toHaveText('1.000');
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(lab(page, 'test:web-crossed').locator('[data-view-3d]')).toHaveCount(0);
  await expect(lab(page, 'test:web-open').locator('.lab-toolbar__identity span')).toHaveText(hostile);
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__atlasInjected)).toBeUndefined();
  await setControl(lab(page, 'test:web-open'), 'driver-speed', 50);
  await expect(lab(page, 'test:web-open').locator('[data-readout-id="output-speed"]')).toHaveText('37.5 rpm');
  await expect(legacy.locator('[data-control-id="driver-speed"]')).toHaveValue('30');
  await expect(lab(page, 'test:web-crossed').locator('[data-control-id="driver-speed"]')).toHaveValue('30');
  await page.screenshot({ path: `renderer-bakeoff-web-labs-${info.project.name}.png`, fullPage: true });
  expect(errors).toEqual([]);
});

for (const id of ['test:web-open', 'test:web-guided']) {
  test(`${id} preserves the configured state through 2D/3D, speed edits and reset`, async ({ page }, info) => {
    await page.goto(url);
    const root = lab(page, id);
    await ready(root);
    const item = cases.find((entry) => entry.id === id)!;
    await setControl(root, 'driver-angle', 90);
    const before = await root.locator('[data-readout-id]').allTextContents();
    await root.locator('[data-view-3d]').click();
    await expect(root).toHaveAttribute('data-view-mode', '3d');
    await expect(root.locator('canvas')).toBeVisible();
    expect(await root.locator('[data-readout-id]').allTextContents()).toEqual(before);
    const builds = await root.locator('[data-renderer-three]').getAttribute('data-geometry-build-count');
    await setControl(root, 'driver-angle', 180);
    await setControl(root, 'driver-speed', 60);
    await expect(root.locator('[data-renderer-three]')).toHaveAttribute('data-geometry-build-count', builds!);
    await root.locator('[data-view-2d]').click();
    await expect(root).toHaveAttribute('data-view-mode', '2d');
    await expect(root.locator('[data-control-id="driver-angle"]')).toHaveValue('180');
    await expect(root.locator('[data-control-id="driver-speed"]')).toHaveValue('60');
    await root.locator('[data-reset]').click();
    await expect(root.locator('[data-control-id="driver-angle"]')).toHaveValue(item.angle);
    await expect(root.locator('[data-control-id="driver-speed"]')).toHaveValue(item.speed);
    await expect(root.locator('[data-readout-id="output-speed"]')).toHaveText(item.output);
    await root.locator('[data-view-3d]').click();
    await expect(root).toHaveAttribute('data-view-mode', '3d');
    await root.screenshot({ path: `renderer-bakeoff-web-${id.endsWith('open') ? 'open' : 'guided'}-three-${info.project.name}.png` });
  });
}

test('spatial compiled lab keeps material phase through display wraps, pause, speed edits and hidden 3D', async ({ page }) => {
  test.setTimeout(60_000);
  await page.clock.install({ time: new Date('2026-01-01T08:00:00Z') });
  await page.goto(url);
  const root = lab(page, 'test:web-guided');
  await ready(root);
  await root.locator('[data-view-3d]').click();
  await expect(root).toHaveAttribute('data-view-mode', '3d');
  await page.clock.pauseAt(new Date('2026-01-01T10:00:00Z'));
  await setControl(root, 'driver-angle', 359);
  await setControl(root, 'driver-speed', 120);
  const initial = await arclength(root);
  const builds = await root.locator('[data-renderer-three]').getAttribute('data-geometry-build-count');
  await root.locator('[data-play]').dispatchEvent('click');
  await page.clock.runFor(32);
  await root.locator('[data-play]').dispatchEvent('click');
  const afterWrap = await arclength(root);
  expect(afterWrap).toBeGreaterThan(initial);
  expect(afterWrap - initial).toBeLessThan(0.04);
  expect(Number(await root.locator('[data-control-id="driver-angle"]').inputValue())).toBeLessThan(90);
  await page.clock.runFor(500);
  expect(await arclength(root)).toBe(afterWrap);
  await root.locator('[data-play]').dispatchEvent('click');
  await page.clock.runFor(512);
  await root.locator('[data-play]').dispatchEvent('click');
  const secondTurn = await arclength(root);
  expect(secondTurn).toBeGreaterThan(afterWrap);
  await setControl(root, 'driver-speed', 60);
  expect(await arclength(root)).toBe(secondTurn);
  await root.locator('[data-view-2d]').dispatchEvent('click');
  await root.locator('[data-play]').dispatchEvent('click');
  await page.clock.runFor(512);
  await root.locator('[data-play]').dispatchEvent('click');
  await root.locator('[data-view-3d]').dispatchEvent('click');
  await expect(root).toHaveAttribute('data-view-mode', '3d');
  expect(await arclength(root)).toBeGreaterThan(secondTurn);
  expect(await arclength(root)).toBeGreaterThan(2 * Math.PI * 0.045 * 2);
  await expect(root.locator('[data-renderer-three]')).toHaveAttribute('data-geometry-build-count', builds!);
  await root.locator('[data-reset]').dispatchEvent('click');
  expect(await arclength(root)).toBe(0);
  await expect(root.locator('[data-control-id="driver-speed"]')).toHaveValue('30');
});

for (const payload of ['{', 'null', '']) {
  test(`rejects malformed payload ${JSON.stringify(payload)} without breaking other labs or using defaults`, async ({ page }) => {
    await page.route(url, async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      const changed = html.replace(/(data-lab-id="test:web-open"\s+data-lab-presentation=)"[^"]*"/, `$1"${payload}"`);
      expect(changed).not.toBe(html);
      await route.fulfill({ response, body: changed });
    });
    await page.goto(url);
    const root = lab(page, 'test:web-open');
    await expect(root.locator('[data-status]')).toContainText('could not be initialized');
    await expect(root).not.toHaveAttribute('aria-busy', 'true');
    await expect(root.locator('[data-renderer] svg')).toHaveCount(0);
    await ready(lab(page, 'test:web-guided'));
    await ready(lab(page, 'legacy'));
  });
}
