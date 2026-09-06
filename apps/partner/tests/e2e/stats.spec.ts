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
    await expect(page.getByRole('heading', { name: '曝光与跳转效果' })).toBeVisible()
    await expect(page.getByRole('group', { name: '统计周期' }).getByRole('button', { name: '本周' })).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: '本月' }).click()
    await waitForMockList(page)
    await expect(page.getByText('本月', { exact: false }).first()).toBeVisible()

    await page.getByRole('button', { name: '本季度' }).click()
    await waitForMockList(page)
    await assertPageHonest(page, errors)
  })
})
