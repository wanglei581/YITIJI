import { expect, test } from '@playwright/test'
import { expectChineseFeedback } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('企业展示管理（mock 口径：初始空列表）', () => {
  test('新增企业：名称过短被中文校验拦住', async ({ page }) => {
    const guards = await openAuthed(page, '/companies')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '企业展示管理' })).toBeVisible()
    await page.getByRole('button', { name: '新增企业' }).click()
    await expect(page.getByRole('heading', { name: '新增企业' })).toBeVisible()

    const orgSelect = page.getByRole('combobox', { name: /来源机构/ }).first()
    await expect(orgSelect).toBeEnabled({ timeout: 10_000 })
    await orgSelect.selectOption({ index: 1 })
    await page.getByRole('textbox', { name: /外部编号/ }).fill('EXT-E2E-001')
    await page.getByRole('textbox', { name: '企业名称*' }).fill('甲')
    await page.getByRole('button', { name: '创建（待审核）' }).click()
    await expectChineseFeedback(page.locator('p').filter({ hasText: '企业名称长度需为 2-80 个字符' }))
    await page.getByRole('button', { name: '取消' }).click()
    await expect(page.getByText('暂无企业数据')).toBeVisible()
  })
})
