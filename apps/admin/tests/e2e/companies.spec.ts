import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

// 3.15：本平台不代建、不代审、不代发企业资料。原「新增企业：名称过短被中文校验拦住」
// 测的是停放的 CreateCompanyDrawer（routes/companies/components/，不再挂载），改测页面只读。
test.describe('企业展示管理（mock 口径：初始空列表）', () => {
  test('没有新增企业入口，空态与页头如实说明只读', async ({ page }) => {
    const guards = await openAuthed(page, '/companies')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '企业展示管理' })).toBeVisible()
    await expect(page.getByRole('button', { name: '新增企业' })).toHaveCount(0)
    await expect(page.getByText('本平台不代建、不代审、不代发企业资料')).toBeVisible()
    await expect(page.getByText('暂无企业数据')).toBeVisible()
    await expect(page.getByText('当前只读：只能查看与紧急下架。')).toBeVisible()
  })
})
