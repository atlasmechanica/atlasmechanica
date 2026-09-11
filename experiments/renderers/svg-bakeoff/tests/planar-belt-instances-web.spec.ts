import { test, expect, type Locator, type Page } from '@playwright/test';

const url = 'http://127.0.0.1:4174/__tests__/compiled-labs/';
const cases = [
  { routing: 'open', ratio: '0.667', output: '30.0 rpm', direction: 'Same', center: '210', speed: '45' },
  { routing: 'crossed', ratio: '0.636', output: '19.1 rpm', direction: 'Reversed', center: '200', speed: '30' },
];
function lab(page: Page, routing: string): Locator {
  return page.locator(`[data-case="test:planar-${routing}-lab"] [data-mechanism-lab]`);
}
async function ready(root: Locator) {
  await expect(root.locator('[data-renderer] svg')).toHaveCount(1);
  await expect(root).not.toHaveAttribute('aria-busy', 'true');
  await expect(root.locator('[data-status]')).not.toContainText('could not be initialized');
}
async function setControl(root: Locator, id: string, value: number) {
  await root.locator(`[data-control-id="${id}"]`).evaluate((input: HTMLInputElement, next) => {
    input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('SSR preserves both JSON-defined belt identities and unequal-pulley parameters', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage(); await page.goto(url);
    for (const item of cases) {
      const root = lab(page, item.routing);
      await expect(root).toHaveAttribute('data-model-id', `test:planar:${item.routing}-unequal`);
      await expect(root.locator('[data-control-id="center-distance"]')).toHaveValue(item.center);
      await expect(root.locator('[data-readout-id="speed-ratio"]')).toHaveText(item.ratio);
      await expect(root.locator('[data-readout-id="output-speed"]')).toHaveText(item.output);
      await expect(root.locator('[data-readout-id="output-direction"]')).toHaveText(item.direction);
      const wire = JSON.parse((await root.getAttribute('data-lab-presentation'))!);
      expect(wire.modelInstance.templateModelId).toBe(`foundation:belt-drive:${item.routing}`);
      expect(wire.modelInstance.id).toBe(wire.definition.modelId);
      expect(wire.definition.views).toEqual(['2d', '3d']);
    }
  } finally { await context.close(); }
});

for (const item of cases) {
  test(`${item.routing} instance reuses SVG and WebGL with correct invalidation, edits and reset`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    const root = lab(page, item.routing); await ready(root);
    await expect(root.locator('[data-readout-id="speed-ratio"]')).toHaveText(item.ratio);
    const initial = await root.locator('[data-readout-id]').allTextContents();
    await root.screenshot({ path: `renderer-bakeoff-planar-instance-${item.routing}-svg-${info.project.name}.png` });
    await root.locator('[data-view-3d]').click();
    await expect(root).toHaveAttribute('data-view-mode', '3d');
    await expect(root.locator('canvas')).toBeVisible();
    const renderer = root.locator('[data-renderer-three]');
    const builds = Number(await renderer.getAttribute('data-geometry-build-count'));
    expect(builds).toBeGreaterThan(0);
    await setControl(root, 'driver-angle', 179); await setControl(root, 'driver-speed', 60);
    await expect(renderer).toHaveAttribute('data-geometry-build-count', String(builds));
    const before = await root.locator('[data-readout-id="belt-length"]').textContent();
    await setControl(root, 'center-distance', 220);
    await expect(renderer).toHaveAttribute('data-geometry-build-count', String(builds + 1));
    expect(await root.locator('[data-readout-id="belt-length"]').textContent()).not.toBe(before);
    await root.locator('[data-view-2d]').click();
    await expect(root).toHaveAttribute('data-view-mode', '2d');
    await expect(root.locator('[data-control-id="center-distance"]')).toHaveValue('220');
    await root.locator('[data-reset]').click();
    await expect(root.locator('[data-control-id="center-distance"]')).toHaveValue(item.center);
    await expect(root.locator('[data-control-id="driver-angle"]')).toHaveValue('25');
    await expect(root.locator('[data-control-id="driver-speed"]')).toHaveValue(item.speed);
    expect(await root.locator('[data-readout-id]').allTextContents()).toEqual(initial);
    await root.locator('[data-view-3d]').click();
    await expect(root).toHaveAttribute('data-view-mode', '3d');
    await root.screenshot({ path: `renderer-bakeoff-planar-instance-${item.routing}-three-${info.project.name}.png` });
    await expect(page.locator('[data-case="legacy"] [data-readout-id="speed-ratio"]')).toHaveText('1.000');
    expect(errors).toEqual([]);
  });
  test(`${item.routing} instance animates across display wrap without failing provenance or rebuilding geometry`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T08:00:00Z') });
    await page.goto(url);
    const root = lab(page, item.routing); await ready(root);
    await root.locator('[data-view-3d]').click();
    await expect(root).toHaveAttribute('data-view-mode', '3d');
    await page.clock.pauseAt(new Date('2026-01-01T10:00:00Z'));
    await setControl(root, 'driver-angle', 359);
    const renderer = root.locator('[data-renderer-three]');
    const builds = await renderer.getAttribute('data-geometry-build-count');
    const updates = Number(await renderer.getAttribute('data-pose-update-count'));
    await root.locator('[data-play]').dispatchEvent('click');
    await page.clock.runFor(128);
    await root.locator('[data-play]').dispatchEvent('click');
    const angle = Number(await root.locator('[data-control-id="driver-angle"]').inputValue());
    expect(angle).toBeGreaterThan(0); expect(angle).toBeLessThan(90);
    await expect(root.locator('[data-status]')).not.toContainText('stopped');
    await expect(renderer).toHaveAttribute('data-geometry-build-count', builds!);
    expect(Number(await renderer.getAttribute('data-pose-update-count'))).toBeGreaterThan(updates);
    await root.locator('[data-reset]').dispatchEvent('click');
    await expect(root.locator('[data-control-id="driver-angle"]')).toHaveValue('25');
  });
}
