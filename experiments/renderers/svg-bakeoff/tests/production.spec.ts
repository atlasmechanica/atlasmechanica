import { expect, test } from '@playwright/test';

test('production renderer consumes shared state without rebuilding keyed nodes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#production-host svg')).toHaveCount(1);
  await page.evaluate(() => {
    (window as any).__atlasStableCrank = document.querySelector('#production-host [data-primitive="fourbar-crank"]');
  });
  await page.locator('#angle').fill('90');
  await expect(page.locator('#production-host')).toHaveAttribute('data-angle', '90');
  const stable = await page.evaluate(() => (window as any).__atlasStableCrank === document.querySelector('#production-host [data-primitive="fourbar-crank"]'));
  expect(stable).toBe(true);
});

test('production renderer exposes keyboard selection and input nudging', async ({ page }) => {
  await page.goto('/');
  const crank = page.locator('#production-host [data-primitive="fourbar-crank"]');
  await crank.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#selection')).toHaveText('Selected: crank');

  await page.locator('#production-host').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#angle-output')).toHaveText('2°');
  await expect(page.locator('#production-host')).toHaveAttribute('data-angle', '2');
});

test('production SVG has deterministic defs, layer order, hit targets and export', async ({ page }) => {
  await page.goto('/');
  const first = await page.evaluate(() => window.__atlasProductionRenderer.exportSvg());
  const second = await page.evaluate(() => window.__atlasProductionRenderer.exportSvg());
  expect(first).toBe(second);
  expect(first).toContain('id="renderer-v0-regression-arrow"');

  const layers = await page.locator('#production-host .atlas-layer[data-layer]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-layer')));
  expect(layers).toEqual(['background', 'trace', 'mechanism', 'annotation', 'interaction', 'feedback']);

  const crankHitWidth = Number(await page.locator('#production-host [data-primitive="fourbar-crank"] .atlas-hit').getAttribute('stroke-width'));
  expect(crankHitWidth).toBeGreaterThanOrEqual(20);
  const handleRadius = Number(await page.locator('#production-host [data-primitive="fourbar-input-handle"] .atlas-hit-fill').getAttribute('r'));
  expect(handleRadius).toBeGreaterThanOrEqual(16);
});

test('production invalid parameter drag keeps the last valid crossed-belt state', async ({ page }) => {
  await page.goto('/');
  await page.locator('#mechanism').selectOption('belt-crossed');
  await expect(page.locator('#distance-output')).toHaveText('180 mm');

  const beforePath = await page.locator('#production-host [data-primitive="belt-path"] .atlas-visible').getAttribute('points');
  const handle = await page.locator('#production-host [data-primitive="belt-distance-handle"] .atlas-hit-fill').boundingBox();
  if (!handle) throw new Error('Missing production parameter handle');

  // The production renderer preserves aspect ratio and may letterbox inside its
  // CSS box. Aim at 80 mm in world space using the same viewport/viewBox mapping
  // that the renderer reverses during pointer interaction.
  const target = await page.locator('#production-host svg').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewBoxWidth = 640;
    const viewBoxHeight = 400;
    const scale = Math.min(rect.width / viewBoxWidth, rect.height / viewBoxHeight);
    const renderedWidth = viewBoxWidth * scale;
    const renderedHeight = viewBoxHeight * scale;
    const offsetX = (rect.width - renderedWidth) / 2;
    const offsetY = (rect.height - renderedHeight) / 2;
    const tx = (0.08 - (-0.06)) / (0.285 - (-0.06));
    const ty = (0.13 - 0) / (0.13 - (-0.13));
    return {
      x: rect.left + offsetX + tx * renderedWidth,
      y: rect.top + offsetY + ty * renderedHeight,
    };
  });

  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await page.mouse.up();

  await expect(page.locator('#status')).toContainText('Invalid geometry');
  await expect(page.locator('#production-host [data-primitive="belt-invalid-handle"]')).toHaveCount(1);
  const output = await page.locator('#distance-output').textContent();
  const lastValidDistance = Number(output?.replace(/[^0-9.-]/g, ''));
  expect(lastValidDistance).toBeGreaterThanOrEqual(90);
  expect(lastValidDistance).toBeLessThan(180);
  const afterPath = await page.locator('#production-host [data-primitive="belt-path"] .atlas-visible').getAttribute('points');
  expect(afterPath).not.toBe(beforePath);

  const committedPath = await page.evaluate(() => window.__atlasProductionRenderer.exportSvg());
  expect(committedPath).toContain('belt-invalid-handle');
});
