import { test, expect } from '@playwright/test'
import { collectPageFaults, gotoPartner, injectPartnerAuth, assertPageHonest } from './helpers'

test.describe('终端数据（mock 口径）', () => {
  test('诚实空态：不展示演示指标', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await injectPartnerAuth(page)
    await gotoPartner(page, '/terminals', '终端数据')
    await expect(page.getByText('终端明细暂由平台统一运营')).toBeVisible()
    await expect(page.getByText(/不展示演示指标或伪状态/)).toBeVisible()
    await assertPageHonest(page, errors)
  })
})
