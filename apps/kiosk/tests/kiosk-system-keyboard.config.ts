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

/** 系统键盘共享层：在正式构建的真实反馈页上，用假的 navigator.virtualKeyboard 模拟键盘弹出。 */
export default defineConfig({
  testDir: './visual',
  testMatch: /kiosk-system-keyboard\.spec\.ts$/,
  outputDir: '../../../test-results/kiosk-system-keyboard',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4198',
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
    command: 'VITE_API_MODE=http VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN=playwright-terminal-session-fixture VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_ALLOW_TEXT_ONLY_ASSISTANT=false VITE_TERMINAL_ID=KSK-001 pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4198 --strictPort',
    cwd: '..',
    url: 'http://127.0.0.1:4198',
    // 本机构建偏慢，可先自己起好 4198 端口的预览再跑；CI 一律现构建。
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
