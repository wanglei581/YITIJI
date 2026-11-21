import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// 订单开票的标已开 / 退回要看真实 fetch。沿用文件管理那套 HTTP 构建 + 页面拦截。
export default defineConfig({
  ...base,
  testMatch: /orders\.invoice\.spec\.ts$/,
  testIgnore: [],
  outputDir: '../../test-results/admin-invoice-e2e',
  workers: 1,
  webServer: {
    command: 'VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 node_modules/.bin/vite build --mode development && node_modules/.bin/vite preview --host 127.0.0.1 --port 4209 --strictPort',
    url: 'http://127.0.0.1:4209',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  use: { ...base.use, baseURL: 'http://127.0.0.1:4209' },
})
