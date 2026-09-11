import { defineConfig } from 'astro/config';
import base from './astro.config.mjs';

// Only this explicit test build contains the fixture route. Production build,
// deployment and the catalog never import or publish it.
export default defineConfig({
  ...base,
  outDir: './.test-output/dist/',
  cacheDir: './.test-output/cache/',
  integrations: [{
    name: 'atlas-compiled-lab-browser-fixture',
    hooks: {
      'astro:config:setup': ({ injectRoute }) => {
        injectRoute({
          pattern: '/__tests__/compiled-labs',
          entrypoint: new URL('./tests/fixtures/compiled-labs.astro', import.meta.url),
        });
      },
    },
  }],
});
