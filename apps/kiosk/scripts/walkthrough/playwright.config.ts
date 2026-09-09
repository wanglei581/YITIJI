import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

/**
 * 一体机走查取证专用配置。
 *
 * webServer 与 `playwright.w6.config.ts` 同一套 env：`VITE_API_MODE=http` 等，
 * 直接 `pnpm build` 会被生产构建守卫拒绝。端口独立，避免和 W6 抢 4186。
 *
 * 不进 CI。无断言。产出是 Markdown 表 + 截图。
 */
const here = dirname(fileURLToPath(import.meta.url))
const kioskRoot = resolve(here, '../..')

const proxyBypass = new Set(
  [process.env.NO_PROXY, process.env.no_proxy, '127.0.0.1', 'localhost']
    .flatMap((value) => value?.split(',') ?? [])
    .map((value) => value.trim())
    .filter(Boolean),
)
const mergedProxyBypass = [...proxyBypass].join(',')
process.env.NO_PROXY = mergedProxyBypass
process.env.no_proxy = mergedProxyBypass

const origin = process.env.WALKTHROUGH_ORIGIN ?? 'http://127.0.0.1:4196'
const port = new URL(origin).port || '4196'

export default defineConfig({
  testDir: here,
  testMatch: /inventory\.ts$/,
  outputDir: resolve(kioskRoot, '../../test-results/kiosk-walkthrough'),
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  timeout: 40 * 60 * 1000,
  reporter: 'list',
  use: {
    baseURL: origin,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    viewport: { width: 1080, height: 1920 },
  },
  webServer: {
    command:
      'VITE_API_MODE=http VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN=playwright-terminal-session-fixture VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_ALLOW_TEXT_ONLY_ASSISTANT=false VITE_TERMINAL_ID=KSK-001 pnpm build && pnpm exec vite preview --host 127.0.0.1 --port '
      + port
      + ' --strictPort',
    url: origin,
    cwd: kioskRoot,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
