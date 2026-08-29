import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';

const baseURL = process.env.BAKEOFF_URL ?? 'http://127.0.0.1:4173';
const results = {};
for (const [name, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto(baseURL);
  await page.waitForFunction(() => Boolean(window.__atlasBakeoff));
  const metrics = await page.evaluate(() => window.__atlasBakeoff.benchmark());
  const screenshot = `renderer-bakeoff-${name}.png`;
  await page.screenshot({ path: screenshot, fullPage: true });

  const goldenScreenshots = {};
  for (const [fixture, value] of [
    ['open-belt', 'belt-open'],
    ['crossed-belt', 'belt-crossed'],
  ]) {
    await page.locator('#mechanism').selectOption(value);
    await page.locator('#production-host').waitFor({ state: 'visible' });
    const path = `renderer-bakeoff-${fixture}-${name}.png`;
    await page.locator('#production-host').screenshot({ path });
    goldenScreenshots[fixture] = path;
  }

  results[name] = { metrics, screenshot, goldenScreenshots };
  await browser.close();
}
fs.writeFileSync('renderer-browser-report.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
