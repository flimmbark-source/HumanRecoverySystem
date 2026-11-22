// The device build (the page of the Android app) in a phone-sized Chromium. Run npm run build:device first.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4180;

export default defineConfig({
  testDir: 'tests/device',
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  use: { ...devices['Pixel 7'], baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npx vite preview -c vite.device.config.ts --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
