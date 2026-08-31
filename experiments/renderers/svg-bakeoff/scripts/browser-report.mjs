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
  const lab = page.locator('[data-belt-drive-lab]');
  const renderer = lab.locator('[data-renderer]');
  await renderer.locator('svg').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('[data-belt-drive-lab]')?.getAttribute('data-zoom') === '1.00');
  if ((page.viewportSize()?.width ?? 0) > 640) {
    await page.waitForFunction(() => Boolean(document.querySelector('[data-belt-drive-lab]')?.getAttribute('data-fit-viewport-height')));
  }
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
      const host = document.querySelector('[data-belt-drive-lab] [data-renderer]');
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

  const result = await page.locator('[data-belt-drive-lab] [data-renderer]').evaluate((host, referenceWidth) => {
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

async function assertDesktopLabAboveFold(page, fixture) {
  const result = await page.locator('[data-belt-drive-lab]').evaluate((lab) => {
    const viewport = lab.querySelector('.lab-viewport');
    const renderer = lab.querySelector('[data-renderer]');
    const driven = lab.querySelector('[data-primitive="belt-driven"] .atlas-visible');
    if (!(viewport instanceof HTMLElement) || !(renderer instanceof HTMLElement) || !(driven instanceof SVGElement)) {
      throw new Error('Missing fitted desktop viewport, renderer, or driven pulley');
    }
    const labBox = lab.getBoundingClientRect();
    const viewportBox = viewport.getBoundingClientRect();
    const rendererBox = renderer.getBoundingClientRect();
    const drivenBox = driven.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const visibleRendererHeight = Math.max(
      0,
      Math.min(rendererBox.bottom, viewportHeight) - Math.max(rendererBox.top, 0),
    );
    return {
      viewportHeight,
      labTop: labBox.top,
      viewportTop: viewportBox.top,
      viewportFrameHeight: viewportBox.height,
      rendererTop: rendererBox.top,
      rendererBottom: rendererBox.bottom,
      rendererHeight: rendererBox.height,
      drivenBottom: drivenBox.bottom,
      visibleRendererHeight,
      visibleRendererFraction: visibleRendererHeight / rendererBox.height,
      fitViewportHeight: Number(lab.getAttribute('data-fit-viewport-height')),
      fitCameraWidth: Number(lab.getAttribute('data-fit-camera-width')),
    };
  });

  if (result.labTop > 335) {
    throw new Error(`${fixture} lab starts at ${result.labTop.toFixed(1)}px; expected at or above 335px.`);
  }
  if (result.visibleRendererFraction < 0.995) {
    throw new Error(
      `${fixture} exposes only ${(result.visibleRendererFraction * 100).toFixed(1)}% of the mechanism canvas on load; expected the complete fitted view.`,
    );
  }
  if (result.rendererBottom > result.viewportHeight - 12) {
    throw new Error(
      `${fixture} renderer ends at ${result.rendererBottom.toFixed(1)}px in a ${result.viewportHeight}px viewport; expected it fully above the fold.`,
    );
  }
  if (result.drivenBottom > result.viewportHeight - 12) {
    throw new Error(`${fixture} lower pulley remains below the initial viewport at ${result.drivenBottom.toFixed(1)}px.`);
  }
  return result;
}

async function assertViewZoomControls(page, fixture) {
  const lab = page.locator('[data-belt-drive-lab]');
  const renderer = lab.locator('[data-renderer]');
  const zoomIn = lab.locator('[data-zoom-in]');
  const fit = lab.locator('[data-zoom-fit]');
  const initial = await renderer.boundingBox();
  if (initial === null) throw new Error(`Missing renderer before ${fixture} zoom check.`);

  await zoomIn.click();
  await page.waitForFunction(() => document.querySelector('[data-belt-drive-lab]')?.getAttribute('data-zoom') === '1.20');
  const zoomed = await renderer.boundingBox();
  if (zoomed === null) throw new Error(`Missing renderer after ${fixture} zoom-in.`);
  const widthRatio = zoomed.width / initial.width;
  const heightRatio = zoomed.height / initial.height;
  if (Math.abs(widthRatio - 1.2) > 0.02 || Math.abs(heightRatio - 1.2) > 0.02) {
    throw new Error(`${fixture} zoom-in scaled renderer by ${widthRatio.toFixed(3)}×${heightRatio.toFixed(3)}; expected 1.2×.`);
  }

  await fit.click();
  await page.waitForFunction(() => document.querySelector('[data-belt-drive-lab]')?.getAttribute('data-zoom') === '1.00');
  const fitted = await renderer.boundingBox();
  if (fitted === null) throw new Error(`Missing renderer after ${fixture} fit reset.`);
  if (Math.abs(fitted.width - initial.width) > 1 || Math.abs(fitted.height - initial.height) > 1) {
    throw new Error(`${fixture} fit reset did not restore the initial renderer size.`);
  }

  return {
    initialWidth: initial.width,
    initialHeight: initial.height,
    zoomedWidth: zoomed.width,
    zoomedHeight: zoomed.height,
    widthRatio,
    heightRatio,
  };
}

async function assertThreeView(page, fixture, screenshotPath) {
  const lab = page.locator('[data-belt-drive-lab]');
  await lab.locator('[data-view-3d]').click();
  await page.waitForFunction(() => document.querySelector('[data-belt-drive-lab]')?.getAttribute('data-view-mode') === '3d');
  const host = lab.locator('[data-renderer-three]');
  const canvas = host.locator('canvas');
  await canvas.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const host = document.querySelector('[data-renderer-three]');
    if (!(host instanceof HTMLElement)) return false;
    const values = host.dataset.cameraPosition?.split(',').map(Number) ?? [];
    return values.length === 3 && Number.isFinite(values[2]) && (values[2] ?? 0) > 0.5;
  });

  const initialCamera = await host.getAttribute('data-camera-position');
  const box = await canvas.boundingBox();
  if (initialCamera === null || box === null) throw new Error(`Missing ${fixture} 3D camera or canvas.`);

  // Use a readable three-quarter view for evidence: enough movement to prove
  // orbit controls and show physical depth without turning the mechanism almost
  // edge-on, which obscures the pulley/spoke construction we actually review.
  const startX = box.x + box.width * 0.52;
  const startY = box.y + box.height * 0.47;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + Math.min(82, box.width * 0.12), startY + Math.min(30, box.height * 0.06), { steps: 7 });
  await page.mouse.up();
  await page.waitForFunction((before) => {
    const host = document.querySelector('[data-renderer-three]');
    return host instanceof HTMLElement && host.dataset.cameraPosition !== before;
  }, initialCamera);

  const rotatedCamera = await host.getAttribute('data-camera-position');
  if (rotatedCamera === null || rotatedCamera === initialCamera) {
    throw new Error(`${fixture} OrbitControls drag did not move the 3D camera.`);
  }
  await canvas.screenshot({ path: screenshotPath });

  await lab.locator('[data-zoom-fit]').click();
  await page.waitForFunction((before) => {
    const host = document.querySelector('[data-renderer-three]');
    return host instanceof HTMLElement && host.dataset.cameraPosition !== before;
  }, rotatedCamera);
  const resetCamera = await host.getAttribute('data-camera-position');
  if (resetCamera !== initialCamera) {
    throw new Error(`${fixture} Front reset returned ${resetCamera}; expected initial camera ${initialCamera}.`);
  }

  await lab.locator('[data-view-2d]').click();
  await page.waitForFunction(() => document.querySelector('[data-belt-drive-lab]')?.getAttribute('data-view-mode') === '2d');
  return { initialCamera, rotatedCamera, resetCamera };
}

async function assertThreeSwitchCancellation(browser) {
  const page = await browser.newPage({ viewport: { width: 1220, height: 900 } });
  await productRenderer(page, '/mechanisms/open-belt-drive/', '3D cancellation');
  let delayedChunk = false;
  await page.route('**/_astro/*.js', async (route) => {
    delayedChunk = true;
    await new Promise((resolve) => setTimeout(resolve, 450));
    await route.continue();
  });

  const lab = page.locator('[data-belt-drive-lab]');
  await lab.locator('[data-view-3d]').click();
  await lab.locator('[data-view-2d]').click();
  await page.waitForTimeout(700);
  const result = await lab.evaluate((root) => {
    const host2d = root.querySelector('[data-renderer]');
    const host3d = root.querySelector('[data-renderer-three]');
    if (!(host2d instanceof HTMLElement) || !(host3d instanceof HTMLElement)) {
      throw new Error('Missing 2D or 3D host during cancellation check');
    }
    return {
      viewMode: root.getAttribute('data-view-mode'),
      busy: root.getAttribute('aria-busy'),
      twoDHidden: host2d.hidden,
      threeDHidden: host3d.hidden,
    };
  });
  await page.close();

  if (!delayedChunk) throw new Error('3D cancellation regression did not intercept the lazy Three.js chunk.');
  if (result.viewMode !== '2d' || result.twoDHidden || !result.threeDHidden || result.busy !== null) {
    throw new Error(`Pending 3D import stole the requested 2D view: ${JSON.stringify(result)}.`);
  }
  return result;
}

async function assertMobileStatusBelowRenderer(page, fixture) {
  const result = await page.locator('[data-belt-drive-lab]').evaluate((root) => {
    const stage = root.querySelector('.lab-stage');
    const renderer = root.querySelector('[data-renderer]');
    const status = root.querySelector('.lab-status');
    if (!(stage instanceof HTMLElement) || !(renderer instanceof HTMLElement) || !(status instanceof HTMLElement)) {
      throw new Error('Missing mobile lab stage, renderer, or status');
    }
    const stageBox = stage.getBoundingClientRect();
    const rendererBox = renderer.getBoundingClientRect();
    const statusBox = status.getBoundingClientRect();
    return {
      stageHeight: stageBox.height,
      rendererBottom: rendererBox.bottom,
      statusTop: statusBox.top,
      separation: statusBox.top - rendererBox.bottom,
      statusPosition: getComputedStyle(status).position,
      statusInsideStage:
        statusBox.left >= stageBox.left - 0.5 &&
        statusBox.right <= stageBox.right + 0.5 &&
        statusBox.bottom <= stageBox.bottom + 0.5,
    };
  });

  if (result.statusPosition !== 'static') {
    throw new Error(`${fixture} status is ${result.statusPosition}; expected static mobile flow.`);
  }
  if (result.separation < -0.5) {
    throw new Error(`${fixture} status overlaps the renderer by ${Math.abs(result.separation).toFixed(1)}px.`);
  }
  if (!result.statusInsideStage) {
    throw new Error(`${fixture} status overflows the mobile lab stage.`);
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

    const foldPage = await browser.newPage({ viewport: { width: 1220, height: 900 } });
    await productRenderer(foldPage, '/mechanisms/open-belt-drive/', 'open-belt desktop fold');
    const desktopFoldCheck = await assertDesktopLabAboveFold(foldPage, 'open-belt desktop fold');
    const desktopFoldScreenshot = `renderer-bakeoff-desktop-fold-${name}.png`;
    await foldPage.screenshot({ path: desktopFoldScreenshot, fullPage: false });

    const sitePage = await browser.newPage({ viewport: { width: 1220, height: 1100 } });
    const goldenScreenshots = {};
    const threeScreenshots = {};
    const threeViewChecks = {};
    const desktopStrokeChecks = {};
    const zoomChecks = {};
    for (const [fixture, route] of [
      ['open-belt', '/mechanisms/open-belt-drive/'],
      ['crossed-belt', '/mechanisms/crossed-belt-drive/'],
    ]) {
      const { renderer } = await productRenderer(sitePage, route, fixture);
      desktopStrokeChecks[fixture] = await assertResponsiveRopeStroke(sitePage, fixture);
      zoomChecks[fixture] = await assertViewZoomControls(sitePage, fixture);
      const path = `renderer-bakeoff-${fixture}-${name}.png`;
      await renderer.screenshot({ path });
      goldenScreenshots[fixture] = path;

      const threePath = `renderer-bakeoff-${fixture}-three-${name}.png`;
      threeViewChecks[fixture] = await assertThreeView(sitePage, fixture, threePath);
      threeScreenshots[fixture] = threePath;
    }

    const threeSwitchCancellation = await assertThreeSwitchCancellation(browser);

    const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const mobileGoldenScreenshots = {};
    const mobileStrokeChecks = {};
    const mobileLayoutChecks = {};
    for (const [fixture, route] of [
      ['open-belt', '/mechanisms/open-belt-drive/'],
      ['crossed-belt', '/mechanisms/crossed-belt-drive/'],
    ]) {
      await productRenderer(mobilePage, route, `${fixture} mobile`);
      mobileStrokeChecks[fixture] = await assertResponsiveRopeStroke(mobilePage, `${fixture} mobile`);
      mobileLayoutChecks[fixture] = await assertMobileStatusBelowRenderer(mobilePage, `${fixture} mobile`);
      const path = `renderer-bakeoff-${fixture}-mobile-${name}.png`;
      const stage = mobilePage.locator('[data-belt-drive-lab] .lab-stage');
      await stage.screenshot({ path });
      mobileGoldenScreenshots[fixture] = path;
    }

    results[name] = {
      metrics,
      screenshot,
      desktopFoldScreenshot,
      desktopFoldCheck,
      goldenScreenshots,
      threeScreenshots,
      threeViewChecks,
      threeSwitchCancellation,
      mobileGoldenScreenshots,
      zoomChecks,
      responsiveStrokeChecks: {
        desktop: desktopStrokeChecks,
        mobile: mobileStrokeChecks,
      },
      mobileLayoutChecks,
    };
    await browser.close();
  }
} finally {
  await stopProcessGroup(webPreview);
}

fs.writeFileSync('renderer-browser-report.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
