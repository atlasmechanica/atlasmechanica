import { expect, test, type Page } from '@playwright/test';

async function dragDistanceToCanvasTop(page: Page, steps: number): Promise<number> {
  await page.goto('/');
  await page.locator('#mechanism').selectOption('belt-open');
  await expect(page.locator('#distance-output')).toHaveText('180 mm');

  const handle = await page
    .locator('#production-host [data-primitive="belt-distance-handle"] .atlas-hit-fill')
    .boundingBox();
  const svg = await page.locator('#production-host svg').boundingBox();
  if (handle === null || svg === null) throw new Error('Missing Brown distance handle or SVG');

  const x = handle.x + handle.width / 2;
  const y = svg.y + 20;
  await page.mouse.move(x, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps });
  await page.mouse.up();

  const text = await page.locator('#distance-output').textContent();
  const value = Number(text?.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(value)) throw new Error(`Invalid distance output: ${text ?? 'missing'}`);
  return value;
}

test('dynamic Brown framing does not change pointer mapping mid-drag', async ({ page }) => {
  const direct = await dragDistanceToCanvasTop(page, 1);
  const stepped = await dragDistanceToCanvasTop(page, 8);

  // The same pointer endpoint must produce the same world coordinate regardless
  // of how many pointermove events the browser emitted on the way there.
  expect(stepped).toBe(direct);
  expect(direct).toBeGreaterThan(210);
  expect(direct).toBeLessThan(250);
});
