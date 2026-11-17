import { expect, test } from '@playwright/test'
import { expectDialogAndAccept, expectDialogAndDismiss } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('计费与对账（mock 口径）', () => {
  test('改价与停用均二次确认，取消后不提交', async ({ page }) => {
    const guards = await openAuthed(page, '/billing')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '计费与对账' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '向个人收费总开关' })).toBeVisible()
    await expect(page.getByText('11/13 起打印按每台机器的收费设置报价，这两行不再决定用户付多少钱').first()).toBeVisible()

    const disable = page.getByRole('button', { name: /停用/ }).first()
    await expect(disable).toBeVisible()
    await expectDialogAndDismiss(page, () => disable.click(), /确认停用/)

    const priceInput = page.locator('input[type="number"]').first()
    await priceInput.fill('0')
    await expectDialogAndDismiss(
      page,
      () => page.getByRole('button', { name: '保存改价' }).first().click(),
      /0 元 = 当前免费，不扣权益/,
    )
    await expect(page.getByRole('heading', { name: '计费与对账' })).toBeVisible()
  })
  test('价目键仅供悬停核对，多行说明保存仍需二次确认', async ({ page }) => {
    const guards = await openAuthed(page, '/billing')
    await settleAdminPage(page, guards)
    const visible = await page.locator('main').innerText()
    expect(visible).not.toMatch(/resume_export|print_bw_page|print_color_page/)
    await expect(page.locator('[title="print_bw_page"]')).toHaveText('黑白打印（每页）')
    const printRow = page.getByRole('row').filter({ has: page.locator('[title="print_bw_page"]') })
    await expect(printRow.getByText('只读')).toBeVisible()
    await expect(printRow.locator('input')).toHaveCount(0)
    const description = page.getByRole('textbox', { name: '简历导出（每次）说明' })
    await expect(description).toHaveAttribute('rows', '3')
    await description.fill('测试说明第一行\n测试说明第二行')
    await expectDialogAndDismiss(page, () => page.getByRole('row').filter({ has: description }).getByRole('button', { name: '保存说明' }).click(), /只更新说明，不修改单价与启停状态/)
    await expect(description).toHaveValue('测试说明第一行\n测试说明第二行')
    await expect(page.getByText('现在关着。关着时，即使某台机器配了价，用户这边仍是 0 元。')).toBeVisible()
    await expect(page.getByText('QD-SN-SELF')).toBeVisible()
    await expect(page.getByText('市南自营')).toBeVisible()
    await expect(page.getByText('青岛市市南区香港中路')).toBeVisible()
    await expect(page.getByText('打印要出版主管部门书面答复或印刷经营许可证')).toBeVisible()
    await expect(page.getByText('再问青岛人社第十八条')).toBeVisible()
    await expect(page.getByText('自动退款')).toBeVisible()
    const openCharge = page.getByRole('button', { name: '打开向个人收费' })
    await expectDialogAndDismiss(page, () => openCharge.click(), /确认打开向个人收费？打开后有 1 台机器会开始向用户收费/)
    await expect(openCharge).toBeVisible()
    await expect(page.getByText('现在关着。关着时，即使某台机器配了价，用户这边仍是 0 元。')).toBeVisible()
    await expectDialogAndAccept(page, () => openCharge.click(), /确认打开向个人收费？打开后有 1 台机器会开始向用户收费/)
    await expect(page.getByRole('button', { name: '关闭向个人收费' })).toBeVisible()
    await expect(page.getByText('现在开着。关着时，即使某台机器配了价，用户这边仍是 0 元。')).toBeVisible()
    await page.getByRole('button', { name: '关闭向个人收费' }).click()
    await expect(page.getByRole('button', { name: '打开向个人收费' })).toBeVisible()

    await page.getByRole('button', { name: '本地对账' }).click()
    await expect(page.getByText(/渠道账单仍需使用真实商户账单另行核对/)).toBeVisible()
    expect(await page.locator('main').innerText()).not.toContain('diff')
  })

})
