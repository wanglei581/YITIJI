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
  testMatch: /kiosk-privacy-timeout\.spec\.ts$/,
  outputDir: '../../test-results/kiosk-privacy-timeout',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4187',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'kiosk-privacy-1080x1920',
      grep: /@privacy-kiosk/,
      use: { viewport: { width: 1080, height: 1920 } },
    },
    {
      name: 'mobile-privacy-390x844',
      grep: /@privacy-mobile/,
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_TERMINAL_ID=KSK-001 VITE_KIOSK_LOGOUT_IDLE_SEC=180 VITE_KIOSK_PRIVACY_IDLE_SEC=3 VITE_KIOSK_PRIVACY_BUSY_DEFER_SEC=2 pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4187 --strictPort',
    url: 'http://127.0.0.1:4187',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
