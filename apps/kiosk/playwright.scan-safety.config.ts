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
  testMatch: /kiosk-scan-safety\.spec\.ts$/,
  outputDir: '../../test-results/kiosk-scan-safety',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4191',
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
      name: 'kiosk-scan-safety-1080x1920',
      grep: /@scan-safety/,
      use: { viewport: { width: 1080, height: 1920 } },
    },
  ],
  webServer: {
    command:
      // VITE_USE_TRTC_CALL=true 是 kiosk 生产构建的硬门禁（verify:prod-build-config），
      // 与 playwright.privacy.config.ts 保持一致，否则 vite build 直接拒绝。
      'VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_TERMINAL_ID=KSK-001 pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4191 --strictPort',
    url: 'http://127.0.0.1:4191',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
