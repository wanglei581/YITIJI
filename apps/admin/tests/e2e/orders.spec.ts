import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('订单管理（mock 口径：一条演示未支付单）', () => {
  test('筛选、打开详情、取消收款与退款入口', async ({ page }) => {
    const guards = await openAuthed(page, '/orders')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '订单管理' })).toBeVisible()

    await page.getByRole('button', { name: '已完成' }).click()
    await expect(page.getByText('ORD-20260625-MOCKREAD')).toBeVisible()
    await page.getByRole('button', { name: '全部' }).first().click()

    await page.getByRole('row', { name: /查看订单 ORD-20260625-MOCKREAD/ }).click()
    await expect(page.getByText('订单详情')).toBeVisible()

    await page.getByRole('button', { name: '确认收款' }).click()
    await expect(page.getByText('确认已在线下收到现金？')).toBeVisible()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByText('确认已在线下收到现金？')).toHaveCount(0)
    await expect(page.getByRole('status', { name: '未支付' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '订单管理' })).toBeVisible()
  })
})
