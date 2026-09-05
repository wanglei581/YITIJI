import { defineConfig } from '@playwright/test'

const proxyBypass = new Set(
  [process.env.NO_PROXY, process.env.no_proxy, '127.0.0.1', 'localhost']
    .flatMap((value) => value?.split(',') ?? [])
    .map((value) => value.trim())
    .filter(Boolean),
)
const mergedProxyBypass = [...proxyBypass].join(',')
process.env.NO_PROXY = mergedProxyBypass
process.env.no_proxy = mergedProxyBypass

const PORT = 4174
const HOST = '127.0.0.1'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  outputDir: '../../test-results/admin-e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: '../../test-results/admin-e2e-report', open: 'never' }]]
    : 'list',
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    viewport: { width: 1280, height: 800 },
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'admin-1280x800' }],
  webServer: {
    // 生产构建会拒绝 mock；E2E 明确走演示适配器，用 development mode 跳过该门禁。
    command: `VITE_API_MODE=mock node_modules/.bin/vite build --mode development && node_modules/.bin/vite preview --host ${HOST} --port ${PORT} --strictPort`,
    url: `http://${HOST}:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
