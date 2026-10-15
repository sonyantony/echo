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

const backend = process.env.ECHO_BACKEND_URL ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The golden sample flows live in ../samples.
    fs: { allow: ['..'] },
    proxy: {
      '/api': backend,
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
