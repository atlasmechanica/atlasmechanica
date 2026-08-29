import { chromium, webkit } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const baseURL = process.env.BAKEOFF_URL ?? 'http://127.0.0.1:4173';
const webURL = process.env.ATLAS_WEB_URL ?? 'http://127.0.0.1:4321';
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

async function waitForUrl(url, child, log) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Atlas web preview exited before becoming ready.\n${log()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Preview has not bound the port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Atlas web preview at ${url}.\n${log()}`);
}

async function stopProcessGroup(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  // GitHub's renderer job runs on Linux. `npm run preview` launches Astro as a
  // child process, so killing only npm can leave Astro holding stdout/stderr open
  // and keep this report alive forever. Start a detached process group and stop
  // the whole group when capture is complete.
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  child.stdout.destroy();
  child.stderr.destroy();
  child.unref();
}

let webLog = '';
const webPreview = spawn(
  'npm',
  ['run', 'preview', '--workspace', '@atlasmechanica/web', '--', '--host', '127.0.0.1', '--port', '4321'],
  { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
);
webPreview.stdout.on('data', (chunk) => { webLog += chunk.toString(); });
webPreview.stderr.on('data', (chunk) => { webLog += chunk.toString(); });

const results = {};
try {
  await waitForUrl(`${webURL}/mechanisms/open-belt-drive/`, webPreview, () => webLog);

  for (const [name, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await browserType.launch();

    // Keep renderer benchmarking on the existing large harness viewport.
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    await page.goto(baseURL);
    await page.waitForFunction(() => Boolean(window.__atlasBakeoff));
    const metrics = await page.evaluate(() => window.__atlasBakeoff.benchmark());
    const screenshot = `renderer-bakeoff-${name}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });

    // Visual approval must exercise the actual Astro product surface. A 1220px
    // viewport yields Atlas's real 1180px max-width site shell (40px gutters), so
    // the reviewed mechanism has the same layout and stroke/geometry scale as the
    // deployed desktop page rather than the 1468px-wide bake-off harness.
    const sitePage = await browser.newPage({ viewport: { width: 1220, height: 1100 } });
    const goldenScreenshots = {};
    for (const [fixture, route] of [
      ['open-belt', '/mechanisms/open-belt-drive/'],
      ['crossed-belt', '/mechanisms/crossed-belt-drive/'],
    ]) {
      await sitePage.goto(`${webURL}${route}`);
      const renderer = sitePage.locator('[data-belt-drive-lab] .lab-renderer');
      await renderer.locator('svg').waitFor({ state: 'visible' });
      const box = await renderer.boundingBox();
      if (box === null) throw new Error(`Missing website renderer for ${fixture}`);
      if (Math.abs(box.width / box.height - 8 / 5) > 0.01) {
        throw new Error(`Website renderer for ${fixture} is ${box.width}×${box.height}; expected an 8:5 surface.`);
      }
      const path = `renderer-bakeoff-${fixture}-${name}.png`;
      await renderer.screenshot({ path });
      goldenScreenshots[fixture] = path;
    }

    results[name] = { metrics, screenshot, goldenScreenshots };
    await browser.close();
  }
} finally {
  await stopProcessGroup(webPreview);
}

fs.writeFileSync('renderer-browser-report.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
