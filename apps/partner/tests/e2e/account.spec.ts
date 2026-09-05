import { test, expect } from '@playwright/test'
import { collectPageFaults, gotoPartner, injectPartnerAuth, assertPageHonest } from './helpers'

test.describe('账号权限（mock 口径）', () => {
  test('诚实空态：不做半套 RBAC', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await injectPartnerAuth(page)
    await gotoPartner(page, '/account', '账号权限')
    await expect(page.getByText('账号与角色由平台侧统一管理')).toBeVisible()
    await expect(page.getByText(/本页不做半套 RBAC/)).toBeVisible()
    await assertPageHonest(page, errors)
  })
})
