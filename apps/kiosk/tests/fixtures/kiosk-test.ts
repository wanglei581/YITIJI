import { test as base } from '@playwright/test'
import { ApiRouter } from './api-router'

export const test = base.extend<{ api: ApiRouter }>({
  api: async ({ page }, use) => {
    const api = new ApiRouter(page)
    await api.install()
    await use(api)
    api.assertNoUnhandledRequests()
  },
})

export { expect } from '@playwright/test'
