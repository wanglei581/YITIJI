import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('合作机构管理（mock 口径）', () => {
  test('新增机构抽屉：空名称按钮不可点；取消关闭', async ({ page }) => {
    const guards = await openAuthed(page, '/partners')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '合作机构管理' })).toBeVisible()
    await page.getByRole('button', { name: '新增机构' }).click()
    await expect(page.getByText('新增合作机构')).toBeVisible()
    await expect(page.getByRole('button', { name: '创建机构' })).toBeDisabled()
    await page.getByRole('button', { name: '取消' }).click()
    await expect(page.getByText('新增合作机构')).toHaveCount(0)
  })
})
