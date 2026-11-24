import { defineConfig, devices } from '@playwright/test';

// Smoke tests of the production web build. `npm run test:e2e` builds, serves dist/ with `vite preview` on
// port 5192 and runs e2e/ in headless Chromium. Set E2E_SKIP_BUILD=1 to serve an existing dist/ (CI builds first).
const PORT = 5192;
const preview = `npx vite preview --port ${PORT} --strictPort`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    // Each test starts from the network, never from a service-worker cache left by another page.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 1280, height: 800 },
      // SwiftShader gives headless Chromium (and GPU-less CI runners) a working software WebGL context.
      launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }
    }
  }],
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? preview : `npm run build && ${preview}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe'
  }
});
