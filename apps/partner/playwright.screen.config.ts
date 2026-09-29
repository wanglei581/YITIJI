import { defineConfig } from '@playwright/test'

/**
 * 数据大屏专用 E2E。
 *
 * 与既有 `playwright.config.ts` 分开，有两个不能合并的理由：
 *
 * 1. **构建模式相反**。既有用例跑 `VITE_API_MODE=mock` 的演示包；大屏在 mock 下
 *    刻意一个请求都不发、一个数字都不显示，测不到任何真实状态。所以这里用
 *    `VITE_API_MODE=http` 构建，让应用真的发请求，再由 `page.route` 用快照
 *    夹具供数 —— 夹具只存在于 tests/，不进产物。
 * 2. **webServer 会被一次 run 全部启动**。塞进主 config 会让既有那轮 E2E 每次
 *    多跑一次完整 vite build，而 kiosk-browser-smoke 已经贴着 70 分钟上限。
 *
 * 两个 project 对应两种观看距离：领导展示的 1920×1080 舞台，和常规后台桌面。
 */

const proxyBypass = new Set(
  [process.env.NO_PROXY, process.env.no_proxy, '127.0.0.1', 'localhost']
    .flatMap((value) => value?.split(',') ?? [])
    .map((value) => value.trim())
    .filter(Boolean),
)
const mergedProxyBypass = [...proxyBypass].join(',')
process.env.NO_PROXY = mergedProxyBypass
process.env.no_proxy = mergedProxyBypass

const PORT = 4177
const HOST = '127.0.0.1'

export default defineConfig({
  testDir: './tests/e2e/screen',
  testMatch: /.*\.spec\.ts$/,
  outputDir: '../../test-results/partner-screen-e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: '../../test-results/partner-screen-e2e-report', open: 'never' }]]
    : 'list',
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'screen-wall-1920x1080', use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'screen-desk-1440x900', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    // 与既有用例相反：这里必须是 http 模式，应用才会真的发请求给 page.route 拦。
    // `--mode development` 只为跳过 vite.config 的生产 mock 闸门，与 API_MODE 无关。
    command: `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 node_modules/.bin/vite build --mode development && node_modules/.bin/vite preview --host ${HOST} --port ${PORT} --strictPort`,
    url: `http://${HOST}:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
