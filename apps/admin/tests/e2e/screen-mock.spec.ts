import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

/**
 * 数据大屏在演示包（VITE_API_MODE=mock）里的口径：一个请求都不发、一个数都不画，
 * 页面说清「演示模式不展示大屏数值」。四个页签、桌面档与展示档都一样；旧地址照样改写。
 *
 * 真实取数的状态矩阵在 tests/e2e/screen/**（http 构建，由 playwright.screen.config.ts 单独跑）。
 */

const CASES: ReadonlyArray<{ path: string; expectPath: string; title: string; display: boolean }> = [
  { path: '/screen', expectPath: '/screen/gov', title: '职易达 · 就业服务终端运行态势', display: false },
  { path: '/screen?profile=ops', expectPath: '/screen/ops', title: '终端运营看板', display: false },
  { path: '/screen/usage', expectPath: '/screen/usage', title: '职易达 · 系统使用与服务调用态势', display: false },
  { path: '/screen/terminal', expectPath: '/screen/terminal', title: '终端数字孪生', display: false },
  { path: '/screen/gov?display=1', expectPath: '/screen/gov', title: '职易达 · 就业服务终端运行态势', display: true },
  { path: '/screen/usage?display=1', expectPath: '/screen/usage', title: '职易达 · 系统使用与服务调用态势', display: true },
  { path: '/screen/ops?display=1', expectPath: '/screen/ops', title: '终端运营看板', display: true },
  { path: '/screen/terminal?display=1', expectPath: '/screen/terminal', title: '终端数字孪生', display: true },
]

test.describe('数据大屏（mock 口径）', () => {
  for (const c of CASES) {
    test(`${c.path}：演示模式不展示数值，不发大屏请求`, async ({ page }) => {
      const screenRequests: string[] = []
      page.on('request', (request) => {
        if (request.url().includes('/admin/screen')) screenRequests.push(request.url())
      })
      const guards = await openAuthed(page, c.path)
      await expect.poll(() => new URL(page.url()).pathname).toBe(c.expectPath)
      await settleAdminPage(page, guards)
      await expect(page.locator('h1')).toHaveCount(1)
      if (c.display) {
        await expect(page.getByRole('heading', { level: 1, name: c.title })).toBeVisible()
        await expect(page.locator('.twin-toolbar')).toHaveCount(0)
      } else {
        await expect(page.locator('h1')).toHaveText('数据大屏')
        await expect(page.getByRole('heading', { level: 2, name: c.title })).toBeVisible()
      }
      await expect(page.getByText('演示模式不展示大屏数值')).toBeVisible()
      await expect(page.locator('[data-ops-screen]')).not.toContainText(/\d+\s*(条|台|次|场|家|页)/)
      expect(screenRequests, '演示包里大屏一个请求都不发').toEqual([])
    })
  }
})
