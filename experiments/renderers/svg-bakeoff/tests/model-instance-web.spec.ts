import { test, expect, type Locator } from '@playwright/test';

const url = 'http://127.0.0.1:4174/__tests__/compiled-labs/';
const selector = '[data-case="test:web-four-bar-instance"] [data-mechanism-lab]';
const modelId = 'test:four-bar:wide-ground';
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

test('SSR retains the independently identified physical instance and its JSON defaults', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(url);
    const root = page.locator(selector);
    await expect(root).toHaveAttribute('data-model-id', modelId);
    await expect(root.locator('[data-control-id="ground-length"]')).toHaveValue('105');
    await expect(root.locator('[data-control-id="driver-angle"]')).toHaveValue('25');
    await expect(root.locator('[data-control-id="driver-speed"]')).toHaveValue('45');
    const wire = JSON.parse((await root.getAttribute('data-lab-presentation'))!);
    expect(wire.modelInstance.id).toBe(modelId);
    expect(wire.modelInstance.model.id).toBe(modelId);
    expect(wire.modelInstance.templateModelId).toBe('foundation:four-bar:crank-rocker');
    expect(wire.definition.modelId).toBe(modelId);
    expect(wire.definition.parameterOverrides['ground-length']).toEqual({ value: 0.105, unit: 'm' });
    await expect(root.locator('[data-readout-id]')).toHaveCount(3);
    expect((await root.locator('[data-readout-id]').allTextContents()).every((text) => text !== '—')).toBe(true);
    await expect(root.locator('[data-view-3d]')).toHaveCount(0);
  } finally { await context.close(); }
});

test('hydrates, edits and resets a model absent from the family model array', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  const root = page.locator(selector);
  await ready(root);
  await expect(root).toHaveAttribute('data-model-id', modelId);
  const initial = await root.locator('[data-readout-id]').allTextContents();
  await setControl(root, 'ground-length', 110);
  expect(await root.locator('[data-readout-id]').allTextContents()).not.toEqual(initial);
  await setControl(root, 'driver-angle', 90);
  await setControl(root, 'driver-speed', 60);
  await root.locator('[data-reset]').click();
  await expect(root.locator('[data-control-id="ground-length"]')).toHaveValue('105');
  await expect(root.locator('[data-control-id="driver-angle"]')).toHaveValue('25');
  await expect(root.locator('[data-control-id="driver-speed"]')).toHaveValue('45');
  expect(await root.locator('[data-readout-id]').allTextContents()).toEqual(initial);
  await expect(page.locator('[data-case="legacy"] [data-readout-id="speed-ratio"]')).toHaveText('1.000');
  await expect(root.locator('[data-view-3d]')).toHaveCount(0);
  await root.screenshot({ path: `renderer-bakeoff-web-model-instance-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test('animates the instantiated model across wrap and returns to its own defaults', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T08:00:00Z') });
  await page.goto(url);
  const root = page.locator(selector);
  await ready(root);
  await page.clock.pauseAt(new Date('2026-01-01T10:00:00Z'));
  await setControl(root, 'driver-angle', 359);
  const before = await root.locator('[data-readout-id]').allTextContents();
  await root.locator('[data-play]').dispatchEvent('click');
  await page.clock.runFor(200);
  await root.locator('[data-play]').dispatchEvent('click');
  const wrapped = Number(await root.locator('[data-control-id="driver-angle"]').inputValue());
  expect(wrapped).toBeGreaterThan(0);
  expect(wrapped).toBeLessThan(100);
  expect(await root.locator('[data-readout-id]').allTextContents()).not.toEqual(before);
  await expect(root.locator('[data-status]')).not.toContainText('stopped');
  await root.locator('[data-reset]').dispatchEvent('click');
  await expect(root.locator('[data-control-id="driver-angle"]')).toHaveValue('25');
  await expect(root.locator('[data-control-id="ground-length"]')).toHaveValue('105');
});

test('rejects altered same-ID topology in serialized HTML without breaking other labs', async ({ page }) => {
  await page.route(url, async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    const changed = html.replace(/(data-lab-id="test:web-four-bar-instance"\s+data-lab-presentation=)"([^"]*)"/,
      (_all, prefix: string, payload: string) => {
        const corrupted = payload.replace('&quot;referenceBody&quot;:&quot;ground&quot;', '&quot;referenceBody&quot;:&quot;unknown&quot;');
        expect(corrupted).not.toBe(payload);
        return `${prefix}"${corrupted}"`;
      });
    expect(changed).not.toBe(html);
    await route.fulfill({ response, body: changed });
  });
  await page.goto(url);
  const root = page.locator(selector);
  await expect(root.locator('[data-status]')).toContainText('incompatible with loaded template');
  await expect(root.locator('[data-renderer] svg')).toHaveCount(0);
  await expect(root).not.toHaveAttribute('aria-busy', 'true');
  await ready(page.locator('[data-case="legacy"] [data-mechanism-lab]'));
  await ready(page.locator('[data-case="test:web-guided"] [data-mechanism-lab]'));
});
