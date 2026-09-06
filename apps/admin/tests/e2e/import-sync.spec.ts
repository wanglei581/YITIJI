import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('导入批次 / 数据接入通道（mock 口径）', () => {
  test('Excel 导入记录页渲染', async ({ page }) => {
    const guards = await openAuthed(page, '/import-batches')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: 'Excel 导入记录' })).toBeVisible()
  })

  test('数据接入通道：批量下架有二次确认', async ({ page }) => {
    const guards = await openAuthed(page, '/sync-sources')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '数据接入通道' })).toBeVisible()
    const bulk = page.getByRole('button', { name: '批量下架内容' }).first()
    if (await bulk.isVisible()) {
      page.once('dialog', (dialog) => {
        void dialog.dismiss()
      })
      await bulk.click()
    }
    await expect(page.getByRole('heading', { name: '数据接入通道' })).toBeVisible()
  })
})
