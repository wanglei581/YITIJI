import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/visual',
  testMatch: /contract-review-session\.spec\.ts$/,
  outputDir: '../../test-results/kiosk-contract-review-session',
  fullyParallel: false,
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
    { name: 'contract-kiosk', use: { viewport: { width: 1080, height: 1920 } } },
  ],
  webServer: {
    command: 'VITE_API_MODE=mock VITE_ENABLE_CONTRACT_REVIEW=true VITE_ENABLE_CONTRACT_REVIEW_REPORT_PRINT=true VITE_TERMINAL_ID=KSK-001 pnpm exec vite --host 127.0.0.1 --port 4191 --strictPort',
    url: 'http://127.0.0.1:4191',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
