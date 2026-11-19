import { expect, test, type Page } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

const ORDER_NO = 'ORD-HOLD-MANUAL'
const AMOUNT = '¥2.00'
const BLOCKED = '退款还在渠道处理中，结果出来前不能处置。'

/**
 * 待人工三颗按钮只看服务端给的「渠道在途」（channelInFlight），和服务端三步处置同一个判断。
 * 渠道受理过、记成待人工的单（例如金额对不上搁置）三颗都禁用并写明原因；
 * 取件窗口关闭后本地停放的待人工（渠道没受理过）三颗都能点，改为出纸照常完成。
 * 两张单的退款状态都是「待人工核对」，按钮能不能点不能靠退款状态猜。
 */
async function openHoldDetail(page: Page, mode: 'channel-manual' | 'window-local') {
  await page.addInitScript((value) => localStorage.setItem('mock:order-hold', value), mode)
  const guards = await openAuthed(page, '/orders')
  await settleAdminPage(page, guards)
  const row = page.locator('tbody tr').filter({ hasText: ORDER_NO })
  await expect(row).toBeVisible()
  await page.getByRole('button', { name: `查看订单 ${ORDER_NO}`, exact: true }).click()
  const detail = page.getByRole('dialog', { name: `订单详情 · ${ORDER_NO}`, exact: true })
  await expect(detail).toBeVisible()
  await expect(detail.getByText('退款状态', { exact: true }).locator('..')).toContainText('待人工核对')
  return { guards, row, detail }
}

test.describe('待人工三步按钮只看渠道在途', () => {
  test('渠道受理过的待人工：三颗按钮都禁用，并写明原因', async ({ page }) => {
    const { guards, detail } = await openHoldDetail(page, 'channel-manual')
    const confirm = detail.getByRole('button', { name: `确认退成 ${AMOUNT}`, exact: true })
    const release = detail.getByRole('button', { name: '确认改为出纸', exact: true })
    const close = detail.getByRole('button', { name: '确认关单', exact: true })
    await expect(confirm).toBeVisible()
    await expect(confirm).toBeDisabled()
    await expect(release).toBeDisabled()
    await expect(close).toBeDisabled()
    await expect(detail.getByText(BLOCKED, { exact: true })).toBeVisible()
    await settleAdminPage(page, guards)
  })

  test('窗口关闭后本地停放的待人工：三颗按钮都能点，改为出纸照常完成', async ({ page }) => {
    const { guards, row, detail } = await openHoldDetail(page, 'window-local')
    const confirm = detail.getByRole('button', { name: `确认退成 ${AMOUNT}`, exact: true })
    const release = detail.getByRole('button', { name: '确认改为出纸', exact: true })
    const close = detail.getByRole('button', { name: '确认关单', exact: true })
    await expect(confirm).toBeEnabled()
    await expect(release).toBeEnabled()
    await expect(close).toBeEnabled()
    await expect(detail.getByText(BLOCKED, { exact: true })).toHaveCount(0)

    await release.click()
    await expect(detail.getByText('支付状态', { exact: true }).locator('..')).toContainText('已支付')
    await expect(detail.getByText('任务状态', { exact: true }).locator('..')).toContainText('待领取')
    await expect(detail.getByRole('button', { name: '确认改为出纸', exact: true })).toHaveCount(0)
    await detail.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(detail).toHaveCount(0)
    await expect(row).toContainText('已支付')
    await settleAdminPage(page, guards)
  })
})
