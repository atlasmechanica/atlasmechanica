import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = new URL('../dist/', import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), 'utf8');
}

const home = await read('index.html');
const open = await read('mechanisms/open-belt-drive/index.html');
const crossed = await read('mechanisms/crossed-belt-drive/index.html');
const cname = await read('CNAME');

const checks = [
  [home.includes('/mechanisms/open-belt-drive/'), 'home links to the first canonical mechanism'],
  [open.includes('/mechanisms/crossed-belt-drive/'), 'open belt page links forward to crossed belt'],
  [crossed.includes('/mechanisms/open-belt-drive/'), 'crossed belt page links back to the baseline'],
  [open.includes('https://atlasmechanica.com/mechanisms/open-belt-drive/'), 'open belt canonical URL is absolute'],
  [crossed.includes('https://atlasmechanica.com/mechanisms/crossed-belt-drive/'), 'crossed belt canonical URL is absolute'],
  [cname.trim() === 'atlasmechanica.com', 'Pages CNAME survives the Astro build'],
];

const failures = checks.filter(([passes]) => !passes).map(([, description]) => description);
if (failures.length > 0) {
  throw new Error(`Static web contract failed:\n- ${failures.join('\n- ')}`);
}

console.log(`Static web contract passed (${checks.length} checks).`);
