import { test as base } from '@playwright/test'
import { ApiRouter } from './api-router'

const LOCAL_TERMINAL_IDENTITY_URL = 'http://127.0.0.1:9527/local/terminal-identity'

export const test = base.extend<{ api: ApiRouter; localTerminalIdentity: void }>({
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
    await use(api)
    api.assertNoUnhandledRequests()
  },
})

export { expect } from '@playwright/test'
