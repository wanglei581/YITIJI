import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// mock 登录固定不带手机号；HTTP 夹具只在测试内返回账号状态，不扩展生产 mock。
export default defineConfig({
  ...base,
  testDir: './tests',
  testMatch: 'phone-verify-guide.spec.ts',
  webServer: {
    ...base.webServer,
    command: 'VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 node_modules/.bin/vite build --mode development && node_modules/.bin/vite preview --host 127.0.0.1 --port 4175 --strictPort',
  },
})
