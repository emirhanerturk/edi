import { defineConfig } from '@playwright/test';

// Tests the packaged app: run `npm run dist -- --no-install` first.
export default defineConfig({
  testDir: 'e2e-dist',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
});
