import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1600, height: 960 },
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: [
    { command: 'npm run build && npm run preview -- --host 127.0.0.1', url: 'http://127.0.0.1:4173', reuseExistingServer: true, timeout: 240_000 },
    // the same app built with a (fake) lab server address, so sending feedback can be tested against a mocked server
    { command: 'VITE_WORKSHOP_API_URL=http://localhost:8799 npx vite build --outDir dist-fb --emptyOutDir && npx vite preview --outDir dist-fb --port 4174 --host 127.0.0.1', url: 'http://127.0.0.1:4174', reuseExistingServer: true, timeout: 240_000 },
  ],
});
