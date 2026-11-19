import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

const ORDER_NO = 'ORD-HOLD-MANUAL'
const AMOUNT = '¥2.00'

/**
 * 待人工退款的三步处置。每一步单独打开页面，因为点完去向就清掉，后两步不会再有按钮。
 * 金额必须是演示退款单上的 200 分，不能显示成 0。
 */
const steps = [
  {
    name: '确认退成',
    button: `确认退成 ${AMOUNT}`,
    pay: '已退款',
    task: '已取消',
    refunded: AMOUNT,
  },
  {
    name: '改为出纸',
    button: '确认改为出纸',
    pay: '已支付',
    task: '待领取',
    refunded: '¥0.00',
  },
  {
    name: '确认关单',
    button: '确认关单',
    pay: '已关闭',
    task: '已取消',
    refunded: '¥0.00',
  },
] as const

test.describe('待人工退款三步处置', () => {
  for (const step of steps) {
    test(`${step.name}：按钮金额与确认后的状态、列表一起变`, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('mock:order-hold', 'manual'))
      const guards = await openAuthed(page, '/orders')
      await settleAdminPage(page, guards)

      const row = page.locator('tbody tr').filter({ hasText: ORDER_NO })
      await expect(row).toBeVisible()
      await expect(row).toContainText('待退款')
      await expect(row).toContainText(AMOUNT)

      await page.getByRole('button', { name: `查看订单 ${ORDER_NO}`, exact: true }).click()
      const detail = page.getByRole('dialog', { name: `订单详情 · ${ORDER_NO}`, exact: true })
      await expect(detail).toBeVisible()
      await expect(detail.getByText(`退款单 RFD-HOLD-MANUAL，金额 ${AMOUNT}。`)).toBeVisible()
      await expect(detail.getByRole('button', { name: `确认退成 ${AMOUNT}`, exact: true })).toBeVisible()
      await expect(detail.getByRole('button', { name: '确认改为出纸', exact: true })).toBeVisible()
      await expect(detail.getByRole('button', { name: '确认关单', exact: true })).toBeVisible()
      await expect(detail.getByRole('button', { name: /确认退成 ¥0/ })).toHaveCount(0)

      await detail.getByRole('button', { name: step.button, exact: true }).click()
      // 点完会重新打开详情，处理中的那句提示会随组件卸掉。能留下的是详情和列表上的状态。
      await expect(detail.getByText('支付状态', { exact: true }).locator('..')).toContainText(step.pay)
      await expect(detail.getByText('任务状态', { exact: true }).locator('..')).toContainText(step.task)
      await expect(detail.getByText('已退款', { exact: true }).locator('..').filter({ hasText: step.refunded })).toBeVisible()
      await expect(detail.getByRole('button', { name: `确认退成 ${AMOUNT}`, exact: true })).toHaveCount(0)
      await expect(detail.getByRole('button', { name: '确认改为出纸', exact: true })).toHaveCount(0)
      await expect(detail.getByRole('button', { name: '确认关单', exact: true })).toHaveCount(0)

      await detail.getByRole('button', { name: '关闭', exact: true }).click()
      await expect(detail).toHaveCount(0)
      await expect(row).toContainText(step.pay)
      await expect(row).toContainText(step.task)
      await expect(row).not.toContainText('待退款')
      await settleAdminPage(page, guards)
    })
  }

  test('退款还在渠道处理中时，三步都不能点，并写明原因', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('mock:order-hold', 'pending'))
    const guards = await openAuthed(page, '/orders')
    await settleAdminPage(page, guards)

    const row = page.locator('tbody tr').filter({ hasText: ORDER_NO })
    await expect(row).toBeVisible()
    await expect(row).toContainText('待退款')

    await page.getByRole('button', { name: `查看订单 ${ORDER_NO}`, exact: true }).click()
    const detail = page.getByRole('dialog', { name: `订单详情 · ${ORDER_NO}`, exact: true })
    await expect(detail).toBeVisible()
    await expect(detail.getByText('处理中', { exact: true })).toBeVisible()
    const release = detail.getByRole('button', { name: '确认改为出纸', exact: true })
    const confirm = detail.getByRole('button', { name: `确认退成 ${AMOUNT}`, exact: true })
    const close = detail.getByRole('button', { name: '确认关单', exact: true })
    await expect(release).toBeVisible()
    await expect(release).toBeDisabled()
    await expect(confirm).toBeDisabled()
    await expect(close).toBeDisabled()
    await expect(detail.getByText('退款还在渠道处理中，结果出来前不能处置。', { exact: true })).toBeVisible()
    await settleAdminPage(page, guards)
  })
})
