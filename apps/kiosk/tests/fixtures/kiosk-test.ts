import { test as base } from '@playwright/test'
import { ApiRouter } from './api-router'

const LOCAL_TERMINAL_IDENTITY_URL = 'http://127.0.0.1:9527/local/terminal-identity'
// #833 起 Kiosk 在 http 模式必须持有终端安全会话（sessionStorage 里的会话令牌 + /terminals/session-token/refresh）
// 才会渲染打印确认等受保护页面。E2E 夹具默认给每个页面一枚假令牌并应答刷新端点，
// 让既有用例把关注点留在各自的业务断言上；要测「会话失效」的用例可以自行覆盖该路由。
const TERMINAL_SESSION_STORAGE_KEY = 'terminal_session_token_v1'
const E2E_TERMINAL_SESSION_TOKEN = 'e2e-terminal-session-fixture'

export const test = base.extend<{ api: ApiRouter; localTerminalIdentity: void; terminalSession: void }>({
  terminalSession: [
    async ({ page }, use) => {
      await page.addInitScript(
        ({ key, token }) => {
          try { window.sessionStorage.setItem(key, token) } catch { /* storage unavailable in this context */ }
        },
        { key: TERMINAL_SESSION_STORAGE_KEY, token: E2E_TERMINAL_SESSION_TOKEN },
      )
      await use(undefined)
    },
    { auto: true },
  ],
  localTerminalIdentity: [
    async ({ page }, use) => {
      await page.route(LOCAL_TERMINAL_IDENTITY_URL, async (route) => {
        if (route.request().method() !== 'GET') {
          await route.abort('blockedbyclient')
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({
            success: true,
            data: { terminalId: 'KSK-001', terminalCode: 'KSK-001' },
          }),
        })
      })
      await use(undefined)
    },
    { auto: true },
  ],
  api: async ({ page }, use) => {
    const api = new ApiRouter(page)
    await api.install()
    api.respond('POST', '/api/v1/terminals/session-token/refresh', {
      status: 200,
      json: { sessionToken: E2E_TERMINAL_SESSION_TOKEN },
    })
    await use(api)
    api.assertNoUnhandledRequests()
  },
})

export { expect } from '@playwright/test'
