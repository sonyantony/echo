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

// Kaoto's editor router lazy-loads its pages from '../pages/<name>'; ECHO shows its own About tab,
// its own Datamappers list in place of the DataMapper "how to" page, and its own page around one DataMapper.
const echoPage = (file: string) => fileURLToPath(new URL(`./src/editor/${file}`, import.meta.url));
const kaotoPages = [
  { find: /^\.\.\/pages\/About$/, replacement: echoPage('EchoAboutPage.tsx') },
  { find: /^\.\.\/pages\/DataMapperHowTo$/, replacement: echoPage('EchoDataMappersPage.tsx') },
  { find: /^\.\.\/pages\/DataMapper$/, replacement: echoPage('EchoDataMapperPage.tsx') },
];

const backend = process.env.ECHO_BACKEND_URL ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: kaotoPages,
  },
  // Kaoto is pre-bundled in dev, where resolve.alias does not apply.
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: 'echo-kaoto-pages',
          setup(build) {
            for (const { find, replacement } of kaotoPages) build.onResolve({ filter: find }, () => ({ path: replacement }));
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
