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

export default defineConfig({
  testDir: './tests',
  testMatch: /fusion-w4\.spec\.ts$/,
  outputDir: '../../test-results/kiosk-fusion-w4',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: '../../test-results/kiosk-fusion-w4-report', open: 'never' }]]
    : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4184',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    viewport: { width: 1080, height: 1920 },
  },
  webServer: {
    command: 'VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_ALLOW_TEXT_ONLY_ASSISTANT=false VITE_TERMINAL_ID=KSK-001 pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4184 --strictPort',
    url: 'http://127.0.0.1:4184',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
