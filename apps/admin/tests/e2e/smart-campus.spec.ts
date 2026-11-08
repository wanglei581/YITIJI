import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('智慧校园（mock 口径）', () => {
  test('页面渲染，保存按钮可点且结果诚实', async ({ page }) => {
    const guards = await openAuthed(page, '/smart-campus')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '智慧校园' })).toBeVisible()
    await expect(page.locator('body')).toContainText('按终端配置「智慧校园」模块的显示开关。')
    await expect(page.locator('body')).toContainText('管理员按终端配置「智慧校园」模块的显示开关')
    await expect(page.locator('body')).toContainText('2026-11-04 起一体机端停放「智慧校园」：开关照常保存，一体机暂不显示，恢复后按开关生效')
    await expect(page.locator('body')).toContainText('学校账号在机构后台只能配置本校终端')
    await expect(page.locator('body')).toContainText('迎新内容 / 使用统计')
    await expect(page.locator('body')).toContainText('校园大数据')
    const save = page.getByRole('button', { name: /保存/ }).first()
    if (await save.isVisible() && await save.isEnabled()) {
      await save.click()
      await expect(page.locator('body')).toContainText(/已保存|保存失败|请先开启|当前是演示数据，没有连上真实后台/)
    }
  })
})
