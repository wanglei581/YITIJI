import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// 告警自动刷新要数到真实 fetch，并让第二次失败。沿用用户注销那套 HTTP 构建 + 页面拦截，不访问真实后台。
export default defineConfig({
  ...base,
  testMatch: /alerts\.auto-refresh\.spec\.ts$/,
  testIgnore: [],
  outputDir: '../../test-results/admin-alerts-refresh-e2e',
  workers: 1,
  webServer: {
    command: 'VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 node_modules/.bin/vite build --mode development && node_modules/.bin/vite preview --host 127.0.0.1 --port 4186 --strictPort',
    url: 'http://127.0.0.1:4186',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  use: { ...base.use, baseURL: 'http://127.0.0.1:4186' },
})
