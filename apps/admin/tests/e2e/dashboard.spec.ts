import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('工作台（mock 口径）', () => {
  test('刷新与待办入口可点，页面保持诚实', async ({ page }) => {
    const guards = await openAuthed(page, '/')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible()
    await expect(page.getByText('工作台数据加载失败')).toHaveCount(0)
    await expect(page.getByText('数据源加载失败')).toHaveCount(0)
    const alertCta = page.getByRole('link', { name: /处理告警/ })
    if (await alertCta.isVisible()) {
      await expect(alertCta).toHaveText(/处理告警 \(\d+\)/)
    }
    await page.getByRole('button', { name: '刷新' }).click()
    await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible()
    const devices = page.getByRole('region', { name: '核心指标' }).getByRole('link', { name: /在线终端/ })
    await expect(devices).toHaveAttribute('href', '/devices')
    await devices.focus()
    await expect(devices).toBeFocused()
    const todo = page.locator('section').filter({ has: page.getByRole('heading', { name: '待办事项', exact: true }) }).getByRole('link', { name: /岗位|招聘会|告警|设备/ }).first()
    if (await todo.isVisible()) {
      await todo.click()
      await expect(page).not.toHaveURL(/\/login/)
      await expect(page.locator('h1').first()).toBeVisible()
    }
  })

  test('在线终端卡片可进入设备管理', async ({ page }) => {
    const guards = await openAuthed(page, '/')
    await settleAdminPage(page, guards)
    const devices = page.getByRole('region', { name: '核心指标' }).getByRole('link', { name: /在线终端/ })
    await devices.click()
    await expect(page).toHaveURL(/\/devices$/)
    await expect(page.getByRole('heading', { name: '设备管理' })).toBeVisible()
  })
})
