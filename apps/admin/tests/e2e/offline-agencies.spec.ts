import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

// 3.15：线下机构整页停放（源码保留在 routes/offline-agencies/，不注册、不进侧栏），
// 旧地址重定向到合作机构管理；入驻时的资质核验迁到机构详情的「资质核验」小节。
test.describe('线下机构已停放（mock 口径）', () => {
  test('旧地址转到合作机构管理，侧栏没有线下机构，机构详情里能看到资质核验', async ({ page }) => {
    const guards = await openAuthed(page, '/offline-agencies')
    await settleAdminPage(page, guards)
    await expect(page).toHaveURL(/\/partners$/)
    await expect(page.getByRole('heading', { name: '合作机构管理' })).toBeVisible()
    await expect(page.getByRole('link', { name: '线下机构' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '线下机构' })).toHaveCount(0)

    await page.getByRole('button', { name: '详情/账号' }).first().click()
    const section = page.getByRole('region', { name: '资质核验' })
    await expect(section).toBeVisible()
    await expect(section).toContainText('资质登记入口尚未开放')
  })
})
