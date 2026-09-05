import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('权限管理', () => {
  test('诚实空态：不提供自助 RBAC', async ({ page }) => {
    const guards = await openAuthed(page, '/permissions')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '权限管理' })).toBeVisible()
    await expect(page.getByText('账号与角色由平台侧统一管理')).toBeVisible()
    await expect(page.getByText('本页不开放细粒度权限编辑')).toBeVisible()
  })
})
