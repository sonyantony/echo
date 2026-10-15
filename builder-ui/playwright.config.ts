import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The backend jar is built by "mvn package" in ../builder-backend. Its data (H2, Git working
// copy) goes to a fresh temp folder so every run starts empty.
const backendJar = process.env.ECHO_BACKEND_JAR ?? '../builder-backend/target/echo-builder-backend-0.1.0-SNAPSHOT.jar';
const dataDir = process.env.ECHO_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'echo-e2e-'));
// A local bare repository plays the buyer's Git server; tests read it to check commits.
export const e2eGitRepo = process.env.ECHO_E2E_GIT_REPO ?? join(dataDir, 'flows.git');
if (!process.env.ECHO_E2E_GIT_REPO) execFileSync('git', ['init', '--bare', '-q', '-b', 'main', e2eGitRepo]);
process.env.ECHO_E2E_GIT_REPO = e2eGitRepo; // shared with the test workers
// ECHO_E2E_BUNDLED=1: the jar already serves the built UI (mvn -Pwith-ui), so test it on :8080
// without the Vite dev server. CI does this; locally the default uses Vite for quick iteration.
const bundled = !!process.env.ECHO_E2E_BUNDLED;
const backend = {
  command: `java -jar ${backendJar} --server.port=8080 --echo.data-dir=${dataDir} --echo.git.url=file://${e2eGitRepo}`,
  url: 'http://localhost:8080/actuator/health',
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
};
const vite = {
  command: 'pnpm exec vite --port 5173 --strictPort',
  url: 'http://localhost:5173',
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
};

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: bundled ? 'http://localhost:8080' : 'http://localhost:5173',
    trace: 'retain-on-failure',
    viewport: { width: 1400, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } }],
  webServer: bundled ? [backend] : [backend, vite],
});
