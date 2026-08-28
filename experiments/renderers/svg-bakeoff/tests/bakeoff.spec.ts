import { expect, test } from '@playwright/test';

test('all three candidates consume the same external state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.renderer-host svg')).toHaveCount(3);
  await page.locator('#angle').fill('90');
  await expect(page.locator('#angle-output')).toHaveText('90°');
  for (const id of ['native-host','svgjs-host','jsxgraph-host']) await expect(page.locator(`#${id}`)).toHaveAttribute('data-angle','90');
});

test('renderer keyboard interaction nudges the shared input coordinate', async ({ page }) => {
  await page.goto('/');
  await page.locator('#native-host').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#angle-output')).toHaveText('2°');
  await page.locator('#svgjs-host').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#angle-output')).toHaveText('4°');
  await page.locator('#jsxgraph-host').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#angle-output')).toHaveText('2°');
});

test('selecting a rendered body is reflected across the shared controller', async ({ page }) => {
  await page.goto('/');
  await page.locator('#native-host [data-primitive="fourbar-crank"] .scene-visible').click();
  await expect(page.locator('#selection')).toHaveText('Selected: crank');
  await expect(page.locator('#svgjs-host [data-select-id="crank"]')).toHaveCount(1);
});

test('invalid crossed-belt parameter drag keeps the last geometrically valid mechanism state', async ({ page }) => {
  await page.goto('/');
  await page.locator('#mechanism').selectOption('belt-crossed');
  await expect(page.locator('#distance-output')).toHaveText('180 mm');
  const host = await page.locator('#native-host').boundingBox();
  const handle = await page.locator('#native-host .interaction-handle[data-handle="parameter"]').boundingBox();
  if (!host || !handle) throw new Error('Missing native parameter handle');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  const targetX = host.x + ((0.08 - (-0.06)) / (0.285 - (-0.06))) * host.width;
  const targetY = host.y + host.height / 2;
  await page.mouse.move(targetX, targetY, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#status')).toContainText('Invalid geometry');
  const output = await page.locator('#distance-output').textContent();
  const lastValidDistanceMm = Number(output?.replace(/[^0-9.-]/g, ''));
  expect(lastValidDistanceMm).toBeGreaterThanOrEqual(90);
  expect(lastValidDistanceMm).toBeLessThan(180);
  await expect(page.locator('#native-host [data-handle="invalid"]')).toHaveCount(1);
});

test('reduced motion keeps play paused while direct manipulation remains available', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#status')).toContainText('Reduced-motion');
  await page.locator('#angle').fill('35');
  await expect(page.locator('#angle-output')).toHaveText('35°');
});

test('candidate surfaces expose focusable/selectable controls and exportable SVG', async ({ page }) => {
  await page.goto('/');
  const snapshot = await page.evaluate(() => window.__atlasBakeoff.snapshot());
  expect(snapshot.exports.native).toBeGreaterThan(500);
  expect(snapshot.exports.svgjs).toBeGreaterThan(500);
  expect(snapshot.exports.jsxgraph).toBeGreaterThan(500);

  await expect(page.locator('#native-host')).toHaveAttribute('role','group');
  await expect(page.locator('#svgjs-host')).toHaveAttribute('role','group');
  // JSXGraph intentionally replaces the container semantics with a region.
  await expect(page.locator('#jsxgraph-host')).toHaveAttribute('role','region');

  for (const id of ['native-host','svgjs-host','jsxgraph-host']) {
    const label = await page.locator(`#${id}`).getAttribute('aria-label');
    expect(label?.trim().length ?? 0).toBeGreaterThan(0);
    expect(await page.locator(`#${id} [role="button"], #${id} [role="slider"]`).count()).toBeGreaterThan(0);
  }
});
