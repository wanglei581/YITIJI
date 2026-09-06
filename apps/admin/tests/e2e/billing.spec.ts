import { expect, test } from '@playwright/test'
import { expectDialogAndDismiss } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('计费与对账（mock 口径）', () => {
  test('改价与停用均二次确认，取消后不提交', async ({ page }) => {
    const guards = await openAuthed(page, '/billing')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '计费与对账' })).toBeVisible()

    const disable = page.getByRole('button', { name: /停用/ }).first()
    if (await disable.isVisible()) {
      await expectDialogAndDismiss(page, () => disable.click(), /停用后该项对应的打印报价会失败|确认停用/)
    }

    const priceInput = page.locator('input[type="number"]').first()
    await priceInput.fill('0')
    await expectDialogAndDismiss(
      page,
      () => page.getByRole('button', { name: '保存改价' }).first().click(),
      /0 元 = 免费打印，将跳过收银/,
    )
    await expect(page.getByRole('heading', { name: '计费与对账' })).toBeVisible()
  })
})
