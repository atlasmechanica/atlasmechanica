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

test('decorative pulley geometry cannot intercept selectable pulley hit targets', async ({ page }) => {
  await page.goto('/');
  await page.locator('#mechanism').selectOption('belt-open');

  const decorativeHit = page.locator('#production-host [data-primitive="belt-driver-rim-inner"] .atlas-hit-fill');
  const selectableHit = page.locator('#production-host [data-primitive="belt-driver"] .atlas-hit-fill');

  await expect(decorativeHit).toHaveCount(1);
  await expect(selectableHit).toHaveCount(1);
  expect(await decorativeHit.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('none');
  expect(await selectableHit.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('all');
});

test('production Brown belt reference uses equal vertically aligned pulleys and hidden handles', async ({ page }) => {
  await page.goto('/');
  await page.locator('#mechanism').selectOption('belt-open');

  const driver = page.locator('#production-host [data-primitive="belt-driver"] .atlas-visible');
  const driven = page.locator('#production-host [data-primitive="belt-driven"] .atlas-visible');
  const driverCx = Number(await driver.getAttribute('cx'));
  const drivenCx = Number(await driven.getAttribute('cx'));
  const driverRx = Number(await driver.getAttribute('rx'));
  const drivenRx = Number(await driven.getAttribute('rx'));
  expect(driverCx).toBeCloseTo(drivenCx, 6);
  expect(driverRx).toBeCloseTo(drivenRx, 6);

  const inputHandle = page.locator('#production-host [data-primitive="belt-input-handle"] .atlas-visible');
  const distanceHandle = page.locator('#production-host [data-primitive="belt-distance-handle"] .atlas-visible');
  await expect(inputHandle).toHaveClass(/atlas-style-cutout/);
  await expect(distanceHandle).toHaveClass(/atlas-style-cutout/);
});

test('vertical Brown distance handle nudges along world Y from the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.locator('#mechanism').selectOption('belt-open');
  await expect(page.locator('#distance-output')).toHaveText('180 mm');

  const distanceHandle = page.locator('#production-host [data-primitive="belt-distance-handle"]');
  await distanceHandle.focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#distance-output')).toHaveText('185 mm');
  expect(Number(await page.locator('#production-host').getAttribute('data-last-parameter-world-y'))).toBeCloseTo(0.185, 6);

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#distance-output')).toHaveText('180 mm');
});

test('production invalid parameter drag keeps the last valid crossed-belt state', async ({ page }) => {
  await page.goto('/');
  await page.locator('#mechanism').selectOption('belt-crossed');
  await expect(page.locator('#distance-output')).toHaveText('180 mm');

  const productionHost = page.locator('#production-host');
  await productionHost.scrollIntoViewIfNeeded();
  const beforePath = await page.locator('#production-host [data-primitive="belt-path"] .atlas-visible').getAttribute('points');
  const handle = await page.locator('#production-host [data-primitive="belt-distance-handle"] .atlas-hit-fill').boundingBox();
  if (!handle) throw new Error('Missing production parameter handle');

  // Aim at a world center distance of 50 mm without assuming a particular Brown
  // viewport. The driver/driven projected centers encode the current world-Y
  // mapping, so interpolate between their SVG positions and then transform that
  // SVG point into client coordinates. This remains stable as presentation
  // framing evolves while still exercising the real pointer path.
  const target = await page.locator('#production-host svg').evaluate((element) => {
    if (!(element instanceof SVGSVGElement)) throw new TypeError('Missing production SVG');
    const driver = element.querySelector('[data-primitive="belt-driver"] .atlas-visible');
    const driven = element.querySelector('[data-primitive="belt-driven"] .atlas-visible');
    if (!(driver instanceof SVGEllipseElement) || !(driven instanceof SVGEllipseElement)) {
      throw new TypeError('Missing projected pulley centers');
    }
    const driverCx = Number(driver.getAttribute('cx'));
    const driverCy = Number(driver.getAttribute('cy'));
    const drivenCy = Number(driven.getAttribute('cy'));
    const point = element.createSVGPoint();
    point.x = driverCx;
    point.y = driverCy + (drivenCy - driverCy) * (50 / 180);
    const matrix = element.getScreenCTM();
    if (matrix === null) throw new TypeError('Missing SVG screen transform');
    const client = point.matrixTransform(matrix);
    return { x: client.x, y: client.y };
  });

  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();

  await expect(productionHost).toHaveAttribute('data-parameter-drag-count', /[1-9][0-9]*/);
  await expect(productionHost).toHaveAttribute('data-last-parameter-validity', 'invalid');
  const candidate = Number(await productionHost.getAttribute('data-last-parameter-candidate-mm'));
  expect(Math.abs(candidate - 50)).toBeLessThan(1);
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
