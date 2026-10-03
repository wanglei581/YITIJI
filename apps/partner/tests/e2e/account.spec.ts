import { test, expect } from '@playwright/test'
import { collectPageFaults, gotoPartner, injectPartnerAuth, assertPageHonest } from './helpers'

test.describe('账号权限（mock 口径）', () => {
  test('账号权限说明与密码长度提示使用通俗文案', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await injectPartnerAuth(page)
    // 页名 #804 起为「账号」：本页只自助改密，账号与权限仍归平台侧。
    await gotoPartner(page, '/account', '账号')
    await expect(page.getByText('账号与角色由平台侧统一管理')).toBeVisible()
    await expect(page.getByText('机构子账号与细分权限由平台统一管理。如需增删机构账号或调整权限，请联系平台运营。')).toBeVisible()
    await expect(page.getByText(/最长约 24 个汉字或 72 个英文字符/)).toBeVisible()
    await expect(page.getByText(/RBAC|UTF-8|字节/)).toHaveCount(0)
    await assertPageHonest(page, errors)
  })
})
