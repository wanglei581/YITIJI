import { test, expect } from '@playwright/test'
import { collectPageFaults, gotoPartner, injectPartnerAuth, waitForMockList, assertPageHonest } from './helpers'

test.describe('同步日志（mock 口径）', () => {
  test.beforeEach(async ({ page }) => {
    await injectPartnerAuth(page)
  })

  test('筛选、查看详情、关闭；失败原因中文可见', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/sync-logs', '同步日志')
    await waitForMockList(page)

    await page.getByRole('button', { name: /^失败/ }).click()
    // 必须等筛选真的生效再点。「API Token 已过期」在筛选前后都可见（未筛选列表里
    // 也有那条失败记录），拿它当等待条件等于没等：.first() 会点到未筛选列表的
    // 第一行——一条成功记录——于是详情弹窗开的是别人。改为等成功记录消失。
    await expect(page.getByText('SYNC-20260525-0018')).toHaveCount(0)
    await expect(page.getByText('SYNC-20260523-0029')).toBeVisible()
    await page.getByRole('button', { name: '查看详情' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('同步详情 · SYNC-20260523-0029')).toBeVisible()
    await expect(dialog.getByText('API Token 已过期（401 Unauthorized）')).toBeVisible()
    await dialog.getByRole('button', { name: '关闭' }).click()
    await expect(dialog).toHaveCount(0)

    await page.getByRole('button', { name: /^全部/ }).click()
    await expect(page.getByText('SYNC-20260525-0018')).toBeVisible()
    await assertPageHonest(page, errors)
  })
})
