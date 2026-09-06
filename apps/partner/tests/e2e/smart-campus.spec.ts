import { test, expect } from '@playwright/test'
import { collectPageFaults, gotoPartner, injectPartnerAuth, assertPageHonest } from './helpers'

test.describe('智慧校园（mock 口径）', () => {
  test('licensed_hr_agency 直达 URL 给出不可用说明，不把 403 当故障', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await injectPartnerAuth(page)
    await gotoPartner(page, '/smart-campus', '智慧校园')
    await expect(page.getByText('智慧校园仅对高校就业中心开放')).toBeVisible()
    await expect(page.getByText(/本机构账号无法查看或配置/)).toBeVisible()
    await expect(page.getByRole('navigation', { name: '侧边导航' }).getByText('智慧校园')).toHaveCount(0)
    await assertPageHonest(page, errors)
  })
})
