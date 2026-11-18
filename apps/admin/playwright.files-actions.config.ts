import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// 文件管理的失败原因要看真实 fetch 的响应体。沿用告警自动刷新那套 HTTP 构建 + 页面拦截。
export default defineConfig({
  ...base,
  testMatch: /files\.actions\.spec\.ts$/,
  testIgnore: [],
  outputDir: '../../test-results/admin-files-actions-e2e',
  workers: 1,
  webServer: {
    command: 'VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 node_modules/.bin/vite build --mode development && node_modules/.bin/vite preview --host 127.0.0.1 --port 4187 --strictPort',
    url: 'http://127.0.0.1:4187',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  use: { ...base.use, baseURL: 'http://127.0.0.1:4187' },
})
