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
  testMatch: /w16-ai-declaration\.spec\.ts$/,
  outputDir: '../../test-results/kiosk-w16-declaration',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:47231',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'kiosk-1080x1920', grep: /@w3-kiosk/, use: { viewport: { width: 1080, height: 1920 } } }],
  webServer: {
    command: 'VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_TERMINAL_ID=KSK-001 VITE_TERMINAL_AGENT_BRIDGE_TOKEN=ci-only-local-bridge-token-0123456789abcdef pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 47231 --strictPort',
    url: 'http://127.0.0.1:47231',
    reuseExistingServer: false,
    timeout: 240_000,
  },
})
