/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineConfig } from 'vite';

const nodeModules = fileURLToPath(new URL('./node_modules/', import.meta.url));

/** Kaoto's SCSS uses webpack-style "~package/..." imports; resolve them from node_modules. */
const tildeImporter = {
  findFileUrl(url: string) {
    return url.startsWith('~') ? pathToFileURL(nodeModules + url.slice(1)) : null;
  },
};

// Kaoto's editor router lazy-loads its About tab from '../pages/About'; show ECHO's instead.
const kaotoAboutImport = /^\.\.\/pages\/About$/;
const echoAboutPage = fileURLToPath(new URL('./src/editor/EchoAboutPage.tsx', import.meta.url));

const backend = process.env.ECHO_BACKEND_URL ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: kaotoAboutImport, replacement: echoAboutPage }],
  },
  // Kaoto is pre-bundled in dev, where resolve.alias does not apply.
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: 'echo-about-page',
          setup(build) {
            build.onResolve({ filter: kaotoAboutImport }, () => ({ path: echoAboutPage }));
          },
        },
      ],
    },
  },
  server: {
    port: 5173,
    // The golden sample flows live in ../samples.
    fs: { allow: ['..'] },
    proxy: {
      // '/api/', not '/api': the prefix would also catch /apicurio-editor.
      '/api/': backend,
      '/actuator': backend,
      '/branding': backend,
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 20000,
  },
  css: {
    preprocessorOptions: {
      scss: { importers: [tildeImporter], quietDeps: true, silenceDeprecations: ['import', 'global-builtin', 'legacy-js-api'] },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
