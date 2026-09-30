import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('日志审计（mock 口径：演示审计行）', () => {
  test('每页条数切换保留 URL 参数、更新列表并回到第 1 页（W-106）', async ({ page }) => {
    // 现有 mock 有 13 条；10 条时能进入第 2 页，50 条时应显示全部。
    const guards = await openAuthed(page, '/audit')
    await settleAdminPage(page, guards)
    const pager = page.locator('div.border-t').filter({ has: page.locator('select option[value="50"]') })
    const pageSize = pager.getByRole('combobox')
    const rows = page.locator('table tbody tr')
    await expect(pageSize).toHaveValue('20')
    await expect(rows).toHaveCount(13)

    await pageSize.selectOption('10')
    await expect(page).toHaveURL(/[?&]pageSize=10(?:&|$)/)
    await expect(page).toHaveURL(/[?&]page=1(?:&|$)/)
    await expect(pageSize).toHaveValue('10')
    await expect(pager).toContainText('第 1/2 页')
    await expect(rows).toHaveCount(10)

    await pager.getByRole('button', { name: '下一页' }).click()
    await expect(page).toHaveURL(/[?&]page=2(?:&|$)/)
    await expect(rows).toHaveCount(3)

    await pageSize.selectOption('50')
    await expect(page).toHaveURL(/[?&]pageSize=50(?:&|$)/)
    await expect(page).toHaveURL(/[?&]page=1(?:&|$)/)
    await expect(pageSize).toHaveValue('50')
    await expect(pager).toContainText('第 1/1 页')
    await expect(rows).toHaveCount(13)
    await settleAdminPage(page, guards)
  })

  test('筛选与刷新可点，列表含登录动作', async ({ page }) => {
    const guards = await openAuthed(page, '/audit')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '日志审计' })).toBeVisible()
    await expect(page.getByText('当前为 mock 演示数据')).toBeVisible()
    await page.getByRole('button', { name: '刷新' }).click()
    await expect(page.locator('table').first()).toBeVisible()
  })
})
