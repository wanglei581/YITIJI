import { defineConfig } from '@playwright/test'

const proxyBypass = new Set(
  [process.env.NO_PROXY, process.env.no_proxy, '127.0.0.1', 'localhost']
    .flatMap((value) => value?.split(',') ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
)
const mergedProxyBypass = [...proxyBypass].join(',')
process.env.NO_PROXY = mergedProxyBypass
process.env.no_proxy = mergedProxyBypass

export default defineConfig({
  testDir: './tests',
  testMatch: /kiosk-session-warning\.spec\.ts$/,
  outputDir: '../../test-results/kiosk-session-warning',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4188',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1080, height: 1920 },
  },
  webServer: {
    command:
      'VITE_USE_TRTC_CALL=true VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_TERMINAL_ID=KSK-001 VITE_KIOSK_LOGOUT_IDLE_SEC=4 VITE_KIOSK_SESSION_WARNING_SEC=2 VITE_KIOSK_PRIVACY_IDLE_SEC=20 pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4188 --strictPort',
    url: 'http://127.0.0.1:4188',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
