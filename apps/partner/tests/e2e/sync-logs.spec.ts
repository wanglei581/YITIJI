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
    await expect(page.getByText('API Token 已过期')).toBeVisible()
    await page.getByRole('button', { name: '查看详情' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/同步详情/)).toBeVisible()
    await expect(dialog.getByText('API Token 已过期')).toBeVisible()
    await dialog.getByRole('button', { name: '关闭' }).click()
    await expect(dialog).toHaveCount(0)

    await page.getByRole('button', { name: /^全部/ }).click()
    await expect(page.getByText('SYNC-20260525-0018')).toBeVisible()
    await assertPageHonest(page, errors)
  })
})
