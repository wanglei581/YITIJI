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

const previewPort = 4629

export default defineConfig({
  testDir: './tests',
  testMatch: /kiosk-privacy-clear-copy\.spec\.ts$/,
  outputDir: '../../test-results/kiosk-privacy-clear',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${previewPort}`,
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
      name: 'kiosk-privacy-clear-1080x1920',
      use: { viewport: { width: 1080, height: 1920 } },
    },
  ],
  webServer: {
    command: [
      'VITE_API_MODE=http',
      'VITE_API_BASE_URL=/api/v1',
      'VITE_USE_TRTC_CALL=true',
      'VITE_TERMINAL_ID=KSK-001',
      'VITE_TERMINAL_AGENT_BRIDGE_TOKEN=ci-only-local-bridge-token-0123456789abcdef',
      'VITE_KIOSK_LOGOUT_IDLE_SEC=180',
      'VITE_KIOSK_RESULT_IDLE_SEC=90',
      'VITE_KIOSK_SESSION_WARNING_SEC=30',
      'VITE_KIOSK_PRIVACY_IDLE_SEC=300',
      'pnpm build',
      '&&',
      `pnpm exec vite preview --host 127.0.0.1 --port ${previewPort} --strictPort`,
    ].join(' '),
    url: `http://127.0.0.1:${previewPort}`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
})
