import { chromium, webkit } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const baseURL = process.env.BAKEOFF_URL ?? 'http://127.0.0.1:4173';
const webURL = process.env.ATLAS_WEB_URL ?? 'http://127.0.0.1:4321';
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const productStrokeReferenceWidth = 1180;

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

async function productRenderer(page, route, fixture) {
  await page.goto(`${webURL}${route}`);
  const renderer = page.locator('[data-belt-drive-lab] .lab-renderer');
  await renderer.locator('svg').waitFor({ state: 'visible' });
  const box = await renderer.boundingBox();
  if (box === null) throw new Error(`Missing website renderer for ${fixture}`);
  if (Math.abs(box.width / box.height - 8 / 5) > 0.01) {
    throw new Error(`Website renderer for ${fixture} is ${box.width}×${box.height}; expected an 8:5 surface.`);
  }
  return { renderer, box };
}

async function assertResponsiveRopeStroke(page, fixture) {
  await page.waitForFunction(
    ({ referenceWidth }) => {
      const host = document.querySelector('[data-belt-drive-lab] .lab-renderer');
      const rope = host?.querySelector('[data-primitive="belt-band-underlay"] .atlas-visible');
      if (!(host instanceof HTMLElement) || !(rope instanceof SVGElement)) return false;
      const nominal = Number(rope.getAttribute('data-nominal-stroke-width'));
      const actual = Number(rope.getAttribute('stroke-width'));
      if (!Number.isFinite(nominal) || !Number.isFinite(actual)) return false;
      const expected = nominal * Math.min(1, host.getBoundingClientRect().width / referenceWidth);
      return Math.abs(actual - expected) < 0.05;
    },
    { referenceWidth: productStrokeReferenceWidth },
  );

  const result = await page.locator('[data-belt-drive-lab] .lab-renderer').evaluate((host, referenceWidth) => {
    const rope = host.querySelector('[data-primitive="belt-band-underlay"] .atlas-visible');
    if (!(rope instanceof SVGElement)) throw new Error('Missing visible rope underlay');
    const nominal = Number(rope.getAttribute('data-nominal-stroke-width'));
    const actual = Number(rope.getAttribute('stroke-width'));
    const width = host.getBoundingClientRect().width;
    return {
      width,
      nominal,
      actual,
      expected: nominal * Math.min(1, width / referenceWidth),
    };
  }, productStrokeReferenceWidth);

  if (Math.abs(result.actual - result.expected) >= 0.05) {
    throw new Error(`${fixture} rope stroke ${result.actual}px did not match responsive expectation ${result.expected}px.`);
  }
  return result;
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

    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    await page.goto(baseURL);
    await page.waitForFunction(() => Boolean(window.__atlasBakeoff));
    const metrics = await page.evaluate(() => window.__atlasBakeoff.benchmark());
    const screenshot = `renderer-bakeoff-${name}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });

    // Desktop product evidence remains calibrated to Atlas's 1180px max-width
    // shell. At this width the new responsive stroke option intentionally leaves
    // the already-approved nominal line weights unchanged.
    const sitePage = await browser.newPage({ viewport: { width: 1220, height: 1100 } });
    const goldenScreenshots = {};
    const desktopStrokeChecks = {};
    for (const [fixture, route] of [
      ['open-belt', '/mechanisms/open-belt-drive/'],
      ['crossed-belt', '/mechanisms/crossed-belt-drive/'],
    ]) {
      const { renderer } = await productRenderer(sitePage, route, fixture);
      desktopStrokeChecks[fixture] = await assertResponsiveRopeStroke(sitePage, fixture);
      const path = `renderer-bakeoff-${fixture}-${name}.png`;
      await renderer.screenshot({ path });
      goldenScreenshots[fixture] = path;
    }

    // Mobile is a separate visual gate. This is where non-scaling strokes used
    // to stay at 7px while the wheel geometry shrank, making the rope appear to
    // eat into the pulley rim. The renderer must now reduce visible stroke widths
    // in direct proportion to the real mobile product surface.
    const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const mobileGoldenScreenshots = {};
    const mobileStrokeChecks = {};
    for (const [fixture, route] of [
      ['open-belt', '/mechanisms/open-belt-drive/'],
      ['crossed-belt', '/mechanisms/crossed-belt-drive/'],
    ]) {
      const { renderer } = await productRenderer(mobilePage, route, `${fixture} mobile`);
      mobileStrokeChecks[fixture] = await assertResponsiveRopeStroke(mobilePage, `${fixture} mobile`);
      const path = `renderer-bakeoff-${fixture}-mobile-${name}.png`;
      await renderer.screenshot({ path });
      mobileGoldenScreenshots[fixture] = path;
    }

    results[name] = {
      metrics,
      screenshot,
      goldenScreenshots,
      mobileGoldenScreenshots,
      responsiveStrokeChecks: {
        desktop: desktopStrokeChecks,
        mobile: mobileStrokeChecks,
      },
    };
    await browser.close();
  }
} finally {
  await stopProcessGroup(webPreview);
}

fs.writeFileSync('renderer-browser-report.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
