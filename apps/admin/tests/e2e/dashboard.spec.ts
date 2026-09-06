import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('工作台（mock 口径）', () => {
  test('刷新与待办入口可点，页面保持诚实', async ({ page }) => {
    const guards = await openAuthed(page, '/')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible()
    await page.getByRole('button', { name: '刷新' }).click()
    await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible()
    const todo = page.getByRole('link', { name: /岗位|招聘会|告警|设备/ }).first()
    if (await todo.isVisible()) {
      await todo.click()
      await expect(page).not.toHaveURL(/\/login/)
      await expect(page.locator('h1').first()).toBeVisible()
    }
  })
})
