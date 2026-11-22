// The API tests again, with the server's database module swapped for the device one (PGlite in memory).
// This proves that the server code also runs on the database that the Android app carries.
import { defineConfig } from 'vitest/config';
import { substitute } from './vite.device.config';

export default defineConfig({
  plugins: [substitute({ 'src/server/db.ts': 'src/device/db.ts' })],
  test: {
    include: ['tests/api/**/*.test.ts'],
    setupFiles: ['tests/api/pglite.setup.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    env: { RESEARCH_PROVIDER: 'fixture', NODE_ENV: 'test', ALLOW_DB_RESET: '1', RESEARCH_BUDGET_SECONDS: '2', RUN_WORKER: '0' },
  },
});
