import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  // Her test kendi Electron sürecini açar; sırayla koşmak yeterince hızlı ve daha az kırılgan.
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
});
