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
  test('1280 列表不横滚，名称最多两行，账号入口和两步确认仍可见', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const guards = await openAuthed(page, '/partners')
    await settleAdminPage(page, guards)
    const table = page.locator('table')
    await expect(table.locator('thead th').filter({ hasText: /^机构名称$/ })).toBeVisible()
    const first = table.locator('tbody tr').first()
    const name = first.locator('td').first().locator('[title]')
    await expect(name).toHaveClass(/line-clamp-2/)
    expect(await name.getAttribute('title')).toBeTruthy()
    const size = await table.evaluate((el) => ({ scroll: el.parentElement!.scrollWidth, client: el.parentElement!.clientWidth }))
    expect(size.scroll).toBeLessThanOrEqual(size.client)
    await expect(first.locator('td').last()).toHaveClass(/sticky/)
    await first.getByRole('button', { name: '详情/账号' }).click()
    await expect(page.getByRole('dialog')).toContainText('机构档案')
    await page.keyboard.press('Escape')
    await first.getByRole('button', { name: '停用', exact: true }).click()
    await expect(first.getByRole('button', { name: '确认停用?' })).toBeVisible()
    // 不执行停用；验证第一步仅进入确认态。
    await expect(first).toContainText('合作中')
  })

  test('筛选换机构时不继承上一行的停用确认态', async ({ page }) => {
    const guards = await openAuthed(page, '/partners')
    await settleAdminPage(page, guards)
    const rows = page.locator('tbody tr')
    const secondName = await rows.nth(1).locator('td').first().locator('[title]').getAttribute('title')
    const secondAction = await rows.nth(1).getByRole('button', { name: /^(停用|启用)$/ }).innerText()
    expect(secondName).toBeTruthy()
    await rows.first().getByRole('button', { name: '停用', exact: true }).click()
    await expect(rows.first().getByRole('button', { name: '确认停用?' })).toBeVisible()
    await page.getByPlaceholder('搜索机构名称、联系人...').fill(secondName!)
    await expect(rows).toHaveCount(1)
    await expect(rows.first().getByRole('button', { name: secondAction, exact: true })).toBeVisible()
    await expect(rows.first().getByRole('button', { name: /^确认(停用|启用)\?/ })).toHaveCount(0)
  })

})
