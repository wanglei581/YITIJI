import { expect, test } from '@playwright/test'
import { openAnonymous, openAuthed, settleAdminPage } from './helpers/open'
import { readAdminRoutes } from './helpers/routes'
import { assertNoRuntimeFailures, assertNoTechLeak, collectUnhandledRejections, waitForAdminHeading } from './helpers/guards'

const routes = readAdminRoutes()

test.describe('Admin route sweep（mock 口径）', () => {
  test('路由表覆盖全部注册路径', () => {
    expect(routes.map((route) => route.path)).toContain('/login')
    expect(routes.map((route) => route.path)).toContain('/')
    // routes/index.tsx 当前 36 条（含 /login、/ 与 3 条历史重定向）；sweep 随源码增减。
    expect(routes.length).toBeGreaterThanOrEqual(36)
  })

  for (const route of routes) {
    test(`${route.path} 渲染出内容且无运行时错误`, async ({ page }) => {
      if (route.path === '/login') {
        const guards = await openAnonymous(page, '/login')
        await expect(page).toHaveURL(/\/login/)
        await waitForAdminHeading(page)
        await expect(page.getByRole('button', { name: '登 录' })).toBeVisible()
        await collectUnhandledRejections(page, guards)
        assertNoRuntimeFailures(guards)
        await assertNoTechLeak(page)
        return
      }

      const guards = await openAuthed(page, route.path)
      if (route.redirectTo) {
        const target = new URL(route.redirectTo, 'http://127.0.0.1')
        await expect(page).toHaveURL((url) => {
          if (url.pathname !== target.pathname) return false
          if (!target.search) return true
          return url.search === target.search
        })
      } else {
        await expect(page).not.toHaveURL(/\/login/)
      }
      await settleAdminPage(page, guards)
      const bodyText = await page.locator('body').innerText()
      expect(bodyText.length).toBeGreaterThan(20)
    })
  }
})
