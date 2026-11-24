import { defineConfig } from '@playwright/test';

// Paketli uygulamanın testi: önce `npm run dist -- --no-install`.
export default defineConfig({
  testDir: 'e2e-dist',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
});
