import { defineConfig } from '@playwright/test';

const PORT = 8799;
const DB = process.env.E2E_DATABASE_URL ?? 'postgres://weave:weave@localhost:5432/weave_test';

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1440, height: 900 } },
  webServer: {
    command: `node dist/server/migrate.js --reset && node dist/server/seed.js && node dist/server/main.js`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT), DATABASE_URL: DB, RESEARCH_PROVIDER: 'fixture', NODE_ENV: 'production',
      SESSION_SECRET: 'e2e-secret', ALLOW_DB_RESET: '1', COOKIE_SECURE: '0', JOB_POLL_MS: '300',
    },
  },
});
