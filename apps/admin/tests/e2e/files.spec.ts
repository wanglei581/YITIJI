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
      await expectDialogAndDismiss(page, () => deleteButton.click(), /确认删除文件[\s\S]*正在打印的文件会拒绝删除/)
    }

    const cleanup = page.getByRole('button', { name: /清理过期/ })
    if (await cleanup.isVisible()) {
      const message = await expectDialogAndDismiss(
        page,
        () => cleanup.click(),
        /立即清理已过期、且当前没有在打印的文件/,
      )
      expect(message).not.toMatch(/所有已过期/)
      expect(message).toMatch(/会员数据导出不在这次清理里/)
      expect(message).toMatch(/物理删除清理到的文件并写入审计/)
    }

    await expect(page.getByRole('heading', { name: '文件管理' })).toBeVisible()
  })

  test('招聘会资料同时列出两种用途', async ({ page }) => {
    const guards = await openAuthed(page, '/files')
    await settleAdminPage(page, guards)
    await page.getByRole('button', { name: '招聘会资料', exact: true }).click()
    // 点下去之前整表里两种资料都在。先等不属于这一类的行消失，再看两种招聘会资料。
    await expect(page.getByText('王某某_简历_2026.pdf')).toHaveCount(0)
    await expect(page.getByText('招聘会资料_2026春招.pdf')).toBeVisible()
    await expect(page.getByText('场次资料_春季招聘会.pdf')).toBeVisible()
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
