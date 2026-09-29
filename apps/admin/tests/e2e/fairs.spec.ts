import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('招聘会管理（mock 口径）', () => {
  // 3.15 停放后管理员对招聘会只查看与紧急下架：没有编辑入口，页面写明不代改
  test('只读列表：没有编辑入口，写明本平台不代改', async ({ page }) => {
    const guards = await openAuthed(page, '/fairs')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '招聘会管理' })).toBeVisible()
    await expect(page.getByRole('button', { name: /编辑基本信息|新增招聘会/ })).toHaveCount(0)
    await expect(page.getByText(/本平台不代改/).first()).toBeVisible()
  })
})
