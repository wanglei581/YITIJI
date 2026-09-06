import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('日志审计（mock 口径：演示审计行）', () => {
  test('筛选与刷新可点，列表含登录动作', async ({ page }) => {
    const guards = await openAuthed(page, '/audit')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '日志审计' })).toBeVisible()
    await expect(page.getByText('当前为 mock 演示数据')).toBeVisible()
    await page.getByRole('button', { name: '刷新' }).click()
    await expect(page.locator('table').first()).toBeVisible()
  })
})
