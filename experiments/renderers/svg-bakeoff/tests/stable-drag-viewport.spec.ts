import { expect, test, type Page } from '@playwright/test';

async function dragDistanceUpward(page: Page, steps: number): Promise<number> {
  await page.goto('/');
  await page.locator('#mechanism').selectOption('belt-open');
  await expect(page.locator('#distance-output')).toHaveText('180 mm');

  const productionHost = page.locator('#production-host');
  await productionHost.scrollIntoViewIfNeeded();

  const handle = await productionHost
    .locator('[data-primitive="belt-distance-handle"] .atlas-hit-fill')
    .boundingBox();
  const svg = await productionHost.locator('svg').boundingBox();
  if (handle === null || svg === null) throw new Error('Missing Brown distance handle or SVG');

  const x = handle.x + handle.width / 2;
  const startY = handle.y + handle.height / 2;
  // Move far enough to force the scene beyond its 180 mm reference state while
  // keeping the endpoint comfortably inside the SVG. The exact value depends on
  // the production host's rendered size; the invariant under test is that the
  // result cannot depend on how many pointermove events occur along the path.
  const targetY = Math.max(svg.y + 24, startY - 80);
  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, targetY, { steps });
  await page.mouse.up();

  await expect(productionHost).toHaveAttribute('data-parameter-drag-count', /[1-9][0-9]*/);
  const text = await page.locator('#distance-output').textContent();
  const value = Number(text?.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(value)) throw new Error(`Invalid distance output: ${text ?? 'missing'}`);
  return value;
}

test('dynamic Brown framing does not change pointer mapping mid-drag', async ({ page }) => {
  const direct = await dragDistanceUpward(page, 1);
  const stepped = await dragDistanceUpward(page, 8);

  // The same pointer endpoint must produce the same world coordinate regardless
  // of how many pointermove events the browser emitted on the way there.
  expect(stepped).toBe(direct);
  expect(direct).toBeGreaterThan(180);
  expect(direct).toBeLessThan(260);
});
