import { expect, test } from '@playwright/test'
import { expectChineseFeedback, expectDialogAndDismiss } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('法务文档版本（mock 口径）', () => {
  test('新增版本空表单被中文校验拦住；激活有二次确认', async ({ page }) => {
    const guards = await openAuthed(page, '/legal-docs')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '法务文档版本' })).toBeVisible()

    await page.getByRole('button', { name: '新增版本' }).click()
    await expect(page.getByRole('dialog', { name: '新增法务文档版本' })).toBeVisible()
    await page.getByRole('button', { name: '创建草稿' }).click()
    await expectChineseFeedback(page.getByText('版本号、标题和内容不能为空'))
    await page.getByRole('button', { name: '取消' }).click()

    const activate = page.getByRole('button', { name: '激活' }).first()
    if (await activate.isVisible()) {
      await expectDialogAndDismiss(page, () => activate.click(), /确认激活/)
    }
  })
})
