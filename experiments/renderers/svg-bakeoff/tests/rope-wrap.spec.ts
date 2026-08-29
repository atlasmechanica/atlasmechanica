import { expect, test } from '@playwright/test';

test('production rope paints over the pulley rim at contact', async ({ page }) => {
  await page.goto('/');
  await page.locator('#mechanism').selectOption('belt-open');

  const ropePaintsAfterPulley = await page.evaluate(() => {
    const pulley = document.querySelector(
      '#production-host [data-primitive="belt-driver"]',
    );
    const rope = document.querySelector(
      '#production-host [data-primitive="belt-band-underlay"]',
    );
    if (pulley === null || rope === null) return false;
    return Boolean(
      pulley.compareDocumentPosition(rope) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  expect(ropePaintsAfterPulley).toBe(true);
});
