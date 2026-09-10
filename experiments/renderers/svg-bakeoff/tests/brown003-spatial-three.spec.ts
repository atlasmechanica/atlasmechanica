import { expect, test } from '@playwright/test';

const HOST = '#brown003-spatial-three-host';

test('Brown 003 Three.js harness renders true spatial geometry and caches it across motion', async ({ page }) => {
  await page.goto('/');
  const host = page.locator(HOST);

  await expect(host).toHaveAttribute('data-renderer', 'three-brown003-spatial');
  await expect(host).toHaveAttribute('data-missing-runtime-rejected', 'true');
  await expect(host.locator('canvas')).toHaveCount(1);
  await expect(host).toHaveAttribute('data-spatial-pulley-count', '4');
  await expect(host).toHaveAttribute('data-spatial-route-point-count', '385');

  const depth = Number(await host.getAttribute('data-spatial-depth'));
  expect(depth).toBeGreaterThan(0.05);

  const initialBuilds = Number(await host.getAttribute('data-geometry-build-count'));
  const initialPoseUpdates = Number(await host.getAttribute('data-pose-update-count'));
  const initialMaterialArclength = Number(await host.getAttribute('data-material-arclength'));
  expect(initialBuilds).toBe(1);
  expect(initialPoseUpdates).toBeGreaterThanOrEqual(1);

  await page.locator('#angle').fill('90');
  await expect(host).toHaveAttribute('data-angle', '90');
  await expect.poll(async () => Number(await host.getAttribute('data-pose-update-count')))
    .toBeGreaterThan(initialPoseUpdates);

  expect(Number(await host.getAttribute('data-geometry-build-count'))).toBe(initialBuilds);
  expect(Number(await host.getAttribute('data-material-arclength'))).not.toBeCloseTo(
    initialMaterialArclength,
    6,
  );
});

test('Brown 003 Three.js harness supports orbit and fit without losing spatial state', async ({ page }) => {
  await page.goto('/');
  const host = page.locator(HOST);
  await expect(host).toHaveAttribute('data-renderer', 'three-brown003-spatial');
  const canvas = host.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('Missing Brown 003 WebGL canvas bounds');

  const start = {
    x: box.x + box.width * 0.55,
    y: box.y + box.height * 0.50,
  };
  const end = {
    x: box.x + box.width * 0.72,
    y: box.y + box.height * 0.62,
  };
  const hitTag = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
    start,
  );
  expect(hitTag).toBe('CANVAS');

  const initialCamera = await host.getAttribute('data-camera-position');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();

  await expect.poll(() => host.getAttribute('data-camera-position')).not.toBe(initialCamera);
  await page.evaluate(() => window.__atlasBrown003Spatial.fitView());
  await expect(host).toHaveAttribute('data-spatial-pulley-count', '4');
  await expect(host).toHaveAttribute('data-spatial-route-point-count', '385');
});
