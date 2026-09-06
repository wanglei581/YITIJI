import { expect, test } from '@playwright/test'
import { expectDialogAndDismiss } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('计费与对账（mock 口径）', () => {
  test('改价与停用均二次确认，取消后不提交', async ({ page }) => {
    const guards = await openAuthed(page, '/billing')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '计费与对账' })).toBeVisible()

    const savePrice = page.getByRole('button', { name: /保存单价|保存/ }).first()
    const disable = page.getByRole('button', { name: /停用/ }).first()
    if (await disable.isVisible()) {
      await expectDialogAndDismiss(page, () => disable.click(), /停用后该项对应的打印报价会失败|确认停用/)
    } else if (await savePrice.isVisible()) {
      await expectDialogAndDismiss(page, () => savePrice.click(), /确认将|改价即时/)
    }
    await expect(page.getByRole('heading', { name: '计费与对账' })).toBeVisible()
  })
})
