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
  test('价目键仅供悬停核对，多行说明保存仍需二次确认', async ({ page }) => {
    const guards = await openAuthed(page, '/billing')
    await settleAdminPage(page, guards)
    const visible = await page.locator('main').innerText()
    expect(visible).not.toMatch(/resume_export|print_bw_page|print_color_page/)
    await expect(page.locator('[title="resume_export"]')).toHaveText('简历导出（每次）')
    const description = page.getByRole('textbox', { name: '简历导出（每次）说明' })
    await expect(description).toHaveAttribute('rows', '3')
    await description.fill('测试说明第一行\n测试说明第二行')
    await expectDialogAndDismiss(page, () => page.getByRole('button', { name: '保存说明' }).click(), /只更新说明，不修改单价与启停状态/)
    await expect(description).toHaveValue('测试说明第一行\n测试说明第二行')
    await page.getByRole('button', { name: '本地对账' }).click()
    await expect(page.getByText(/渠道账单仍需使用真实商户账单另行核对/)).toBeVisible()
    expect(await page.locator('main').innerText()).not.toContain('diff')
  })

})
