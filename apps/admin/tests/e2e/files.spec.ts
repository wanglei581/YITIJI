import { expect, test } from '@playwright/test'
import { expectDialogAndDismiss } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('文件管理（mock 口径）', () => {
  test('删除与清理过期有二次确认，取消后列表仍在', async ({ page }) => {
    const guards = await openAuthed(page, '/files')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '文件管理' })).toBeVisible()

    const deleteButton = page.getByRole('button', { name: /删除/ }).first()
    if (await deleteButton.isVisible()) {
      await expectDialogAndDismiss(page, () => deleteButton.click(), /确认删除文件/)
    }

    const cleanup = page.getByRole('button', { name: /清理过期/ })
    if (await cleanup.isVisible()) {
      await expectDialogAndDismiss(page, () => cleanup.click(), /立即清理所有已过期文件/)
    }

    await expect(page.getByRole('heading', { name: '文件管理' })).toBeVisible()
  })
  test('1280 宽操作可达，策略来源与同意信息保留在详情', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const guards = await openAuthed(page, '/files')
    await settleAdminPage(page, guards)
    await expect(page.locator('thead th')).toHaveText(['文件名', '类型', '用户', '大小', '敏感级别', '保存策略', '清理状态', '操作'])
    await expect(page.getByRole('button', { name: '手动删除' }).first()).toBeInViewport()
    expect(await page.locator('table').evaluate((el) => el.scrollWidth - el.parentElement!.clientWidth)).toBeLessThanOrEqual(1)
    const visible = await page.locator('tbody').innerText()
    expect(visible).not.toMatch(/匿名\(Kiosk\)|cmu[a-z0-9]+/)
    await page.getByRole('button', { name: '详情', exact: true }).first().click()
    for (const field of ['策略来源', '同意时间', '同意版本', '来源', '上传时间', '到期时间']) {
      await expect(page.getByText(field, { exact: true })).toBeVisible()
    }
  })

})
