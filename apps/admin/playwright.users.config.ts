import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// 用户注销用例需要 HTTP 适配器，沿用现有认证夹具及页面拦截，不访问真实用户。
// 设备能力防误登记同样要拦真实 /api/v1 请求并可控延迟，只能跟这份 HTTP 构建跑，不能进 mock 包。
export default defineConfig({
  ...base,
  testMatch: [/users\.closure\.spec\.ts$/, /print-scan\.capability-target\.spec\.ts$/],
  testIgnore: [],
  outputDir: '../../test-results/admin-users-e2e',
  workers: 1,
  webServer: {
    command: 'VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 node_modules/.bin/vite build --mode development && node_modules/.bin/vite preview --host 127.0.0.1 --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178', reuseExistingServer: false, timeout: 180_000,
  },
  use: { ...base.use, baseURL: 'http://127.0.0.1:4178' },
})
