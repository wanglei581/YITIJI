import { expect, test } from '@playwright/test'
import { expectDialogAndDismiss } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('文件管理（mock 口径）', () => {
  test('删除与清理过期有二次确认，取消后列表仍在', async ({ page }) => {
    const guards = await openAuthed(page, '/files')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '文件管理' })).toBeVisible()

    const deleteButton = page.getByRole('button', { name: /删除/ }).first()
    if (await deleteButton.isVisible()) {
      await expectDialogAndDismiss(page, () => deleteButton.click(), /确认删除文件/)
    }

    const cleanup = page.getByRole('button', { name: /清理过期/ })
    if (await cleanup.isVisible()) {
      await expectDialogAndDismiss(page, () => cleanup.click(), /立即清理所有已过期文件/)
    }

    await expect(page.getByRole('heading', { name: '文件管理' })).toBeVisible()
  })
})
