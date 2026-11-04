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
  // kiosk-end-use：统一清场正式构建走查（W-75 / W-43 / W-64），要 30 秒以上的本页时钟，
  // 不能放进把隐私硬截止压到 3 秒的 playwright.privacy.config.ts。
  // home-continue-handover：首页「继续办理」在交接判据（空档 >30 秒）之后收起、不再读 /me，同样要 30 秒以上的本页时钟。
  // home-fill-when-empty：首页「继续办理」收起（要 30 秒以上的本页时钟）或没有东西可摆时，版面照样填满。
  // kiosk-license-gate：授权闸门（收尾中 / 暂停 / 恢复）与贴牌上屏走查，要没有 mock 会话票的正式构建（页面自己换票、续期、每 5 分钟复查）
  // 和 5 分钟以上的本页时钟，同样不能放进把隐私硬截止压到 3 秒的 playwright.privacy.config.ts。
  // kiosk-license-wind-down：收尾中的运行时根拦截、旧结果只读、到期时刻为空的兜底，与 kiosk-license-gate 共用同一套构建与假服务端。
  // kiosk-license-screens：收尾拦截屏与暂停服务屏在 1080×1920 下的版面（排满一屏、插画不变形、文字不被裁、底栏不压内容）。
  testMatch: /(kiosk-privacy-clear-copy|kiosk-end-use|home-continue-handover|home-fill-when-empty|kiosk-license-gate|kiosk-license-wind-down|kiosk-license-screens)\.spec\.ts$/,
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
