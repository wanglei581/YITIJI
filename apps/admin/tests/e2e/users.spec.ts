import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('用户管理（mock 口径：演示模式不连真实用户库，列表为空）', () => {
  test('查询 / 重置 / 刷新可点，空态诚实', async ({ page }) => {
    const guards = await openAuthed(page, '/users')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible()
    await expect(page.getByText('暂无注册用户')).toBeVisible()

    await page.getByPlaceholder('搜索昵称、关键词或完整手机号').fill('13800138000')
    await page.getByRole('button', { name: '查询' }).click()
    await expect(page.getByText(/暂无注册用户|未找到符合条件的用户/)).toBeVisible()
    await page.getByRole('button', { name: '重置', exact: true }).click()
    await page.getByRole('button', { name: '刷新' }).click()
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible()
  })
})
