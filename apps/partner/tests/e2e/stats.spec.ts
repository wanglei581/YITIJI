import { test, expect } from '@playwright/test'
import { collectPageFaults, gotoPartner, injectPartnerAuth, waitForMockList, assertPageHonest } from './helpers'

test.describe('数据统计（mock 口径：dataMode=demo）', () => {
  test.beforeEach(async ({ page }) => {
    await injectPartnerAuth(page)
  })

  test('周期切换、在架快照、归因诚实不可用', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/stats', '数据统计')
    await waitForMockList(page)

    await expect(page.getByText('在架岗位')).toBeVisible()
    const visits = page.getByRole('region', { name: '服务人次' })
    await expect(visits).toBeVisible()
    await expect(visits).toContainText('近 7 天（截至昨天）')
    await expect(visits).toContainText('样本不足，不显示')
    await expect(visits.getByRole('link', { name: '查看各终端明细' })).toHaveAttribute('href', '/terminals')
    await expect(page.getByText('产生了什么效果')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '同步概况' })).toBeVisible()
    await expect(page.getByText('还不能按本机构统计，这里不显示这些数字')).toBeVisible()
    await expect(page.getByRole('group', { name: '统计周期' }).getByRole('button', { name: '近 7 天（截至昨天）' })).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: '近 30 天（截至昨天）' }).click()
    await waitForMockList(page)
    await expect(page.getByText('近 30 天（截至昨天）', { exact: false }).first()).toBeVisible()

    await page.getByRole('button', { name: '近 90 天（截至昨天）' }).click()
    await waitForMockList(page)
    await assertPageHonest(page, errors)
  })
})
