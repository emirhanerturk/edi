import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  // Each test launches its own Electron process; running them in sequence is fast enough and less flaky.
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
});
