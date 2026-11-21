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
 * 长期查不到渠道结果的单可以按商户平台核实结果登记：重输订单号对上才能登记，登记「没退出去」后三步照常。
 */
async function openHoldDetail(
  page: Page,
  mode: 'channel-manual' | 'window-local' | 'channel-stuck' | 'paper-channel-manual',
  refundStatus = '待人工核对',
) {
  await page.addInitScript((value) => localStorage.setItem('mock:order-hold', value), mode)
  const guards = await openAuthed(page, '/orders')
  await settleAdminPage(page, guards)
  const row = page.locator('tbody tr').filter({ hasText: ORDER_NO })
  await expect(row).toBeVisible()
  await page.getByRole('button', { name: `查看订单 ${ORDER_NO}`, exact: true }).click()
  const detail = page.getByRole('dialog', { name: `订单详情 · ${ORDER_NO}`, exact: true })
  await expect(detail).toBeVisible()
  await expect(detail.getByText('退款状态', { exact: true }).locator('..')).toContainText(refundStatus)
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

  test('长期查不到渠道结果：按商户平台核实结果登记，重输订单号对上才能登记，登记后三步照常', async ({ page }) => {
    const { guards, detail } = await openHoldDetail(page, 'channel-stuck', '处理中')
    await expect(detail.getByRole('button', { name: '确认改为出纸', exact: true })).toBeDisabled()
    await expect(detail.getByText(BLOCKED, { exact: true })).toBeVisible()

    await detail.getByRole('button', { name: '按商户平台核实结果登记', exact: true }).click()
    await detail.getByRole('button', { name: '渠道确认没退出去', exact: true }).click()
    await detail.getByLabel('核实说明').fill('商户平台查无此退款，确认没有出款')
    const submit = detail.getByRole('button', { name: '确认登记', exact: true })
    await detail.getByLabel('重输订单号确认').fill('ORD-HOLD-WRONG')
    await expect(submit).toBeDisabled()
    await detail.getByLabel('重输订单号确认').fill(ORDER_NO)
    await expect(submit).toBeEnabled()
    await submit.click()

    await expect(detail.getByText('退款状态', { exact: true }).locator('..')).toContainText('没有成功')
    await expect(detail.getByText(BLOCKED, { exact: true })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: '按商户平台核实结果登记', exact: true })).toHaveCount(0)
    const release = detail.getByRole('button', { name: '确认改为出纸', exact: true })
    await expect(release).toBeEnabled()
    await release.click()
    await expect(detail.getByText('支付状态', { exact: true }).locator('..')).toContainText('已支付')
    await expect(detail.getByText('任务状态', { exact: true }).locator('..')).toContainText('待领取')
    await settleAdminPage(page, guards)
  })

  test('纸已出且渠道在途待人工：不亮起「核对后仍退款」，避免二次出款', async ({ page }) => {
    const { guards, detail } = await openHoldDetail(page, 'paper-channel-manual')
    await expect(detail.getByRole('button', { name: '核对后仍退款', exact: true })).toHaveCount(0)
    await expect(detail.getByText(BLOCKED, { exact: true })).toBeVisible()
    await expect(detail.getByText('退款还在渠道处理中，结果出来前不能处置，也不能重复退款。', { exact: true })).toBeVisible()
    await settleAdminPage(page, guards)
  })
})
