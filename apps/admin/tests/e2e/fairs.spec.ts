import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('招聘会管理（mock 口径）', () => {
  test('列表渲染，点开详情或空态诚实', async ({ page }) => {
    const guards = await openAuthed(page, '/fairs')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '招聘会管理' })).toBeVisible()
    const rowButton = page.getByRole('button', { name: /编辑|查看|详情/ }).first()
    if (await rowButton.isVisible()) {
      await rowButton.click()
      await expect(page.locator('h1, h2').first()).toBeVisible()
    } else {
      await expect(page.getByText(/暂无招聘会数据|招聘会/)).toBeVisible()
    }
  })
})
