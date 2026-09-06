import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('AI 服务 / 配置（mock 口径）', () => {
  test('AI 服务管理渲染统计与日志区', async ({ page }) => {
    const guards = await openAuthed(page, '/ai-services')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: 'AI 服务管理' })).toBeVisible()
  })

  test('AI 大模型：功能位可点，连通性测试给出 mock 中文原因', async ({ page }) => {
    const guards = await openAuthed(page, '/ai-config')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: 'AI大模型' })).toBeVisible()
    await expect(page.getByRole('button', { name: /AI 顾问对话/ }).first()).toBeVisible()
    await page.getByRole('button', { name: '保存并测试连通' }).click()
    await expect(page.getByText('当前为 mock 模式，连通性测试需要连接真实后端')).toBeVisible()
  })
})
