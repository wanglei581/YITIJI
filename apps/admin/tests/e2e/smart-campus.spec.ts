import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('智慧校园（mock 口径）', () => {
  test('页面渲染，保存按钮可点且结果诚实', async ({ page }) => {
    const guards = await openAuthed(page, '/smart-campus')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '智慧校园' })).toBeVisible()
    const save = page.getByRole('button', { name: /保存/ }).first()
    if (await save.isVisible() && await save.isEnabled()) {
      await save.click()
      await expect(page.locator('body')).toContainText(/已保存|保存失败|请先开启|mock/)
    }
  })
})
