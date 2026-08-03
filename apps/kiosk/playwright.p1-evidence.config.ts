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
  testMatch: /kiosk-p1-visual-evidence\.spec\.ts$/,
  outputDir: '../../test-results/kiosk-p1-visual-evidence-run',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 2_700_000,
  reporter: [['list'], ['json', { outputFile: '../../test-results/kiosk-p1-visual-evidence-run/results.json' }]],
  use: {
    // Current local Kiosk preview under review (user-provided :58245).
    baseURL: process.env.P1_KIOSK_ORIGIN ?? 'http://127.0.0.1:58245',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    { name: 'p1-evidence', use: { viewport: { width: 1080, height: 1920 } } },
  ],
  webServer: [
    {
      // Prefer the already-running local Kiosk; fall back to production preview only when absent.
      command: 'VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_ALLOW_TEXT_ONLY_ASSISTANT=false VITE_TERMINAL_ID=KSK-001 pnpm exec vite preview --host 127.0.0.1 --port 58245 --strictPort',
      url: 'http://127.0.0.1:58245',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'python3 -m http.server 8399 --bind 127.0.0.1 --directory ../../docs/design',
      url: 'http://127.0.0.1:8399/kiosk-proto-2026-07-fusion/index.html',
      reuseExistingServer: true,
      timeout: 30_000,
      cwd: '.',
    },
  ],
})
