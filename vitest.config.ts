import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://weave:weave@localhost:5432/weave_test',
      RESEARCH_PROVIDER: 'fixture',
      NODE_ENV: 'test', ALLOW_DB_RESET: '1', RESEARCH_BUDGET_SECONDS: '2', RUN_WORKER: '0',
    },
  },
});
