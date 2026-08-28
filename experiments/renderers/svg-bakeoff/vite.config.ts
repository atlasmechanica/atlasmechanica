import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@svgdotjs/svg.js')) return 'vendor-svgjs';
          if (id.includes('jsxgraph')) return 'vendor-jsxgraph';
          return undefined;
        },
      },
    },
  },
});
