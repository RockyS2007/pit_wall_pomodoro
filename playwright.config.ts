import { defineConfig } from '@playwright/test';

// Interface tests. They run the two windows as two browser tabs, with the
// weather and city-search services replaced by canned answers.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:1420', locale: 'en-CA' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
  },
});
