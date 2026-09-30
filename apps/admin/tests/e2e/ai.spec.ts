import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('AI 服务 / 配置（mock 口径）', () => {
  test('AI 服务管理渲染统计与日志区', async ({ page }) => {
    const guards = await openAuthed(page, '/ai-services')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: 'AI 服务管理' })).toBeVisible()
    await expect(page.getByText('AI 开关、用量与额度、调用记录', { exact: true })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '厂商与模型' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Task ID', exact: true })).toHaveCount(0)
    const quality = page.getByRole('region', { name: '岗位来源质量' })
    await expect(quality.getByText('部分缺失 / 信息不足', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: '最近 AI 调用日志' }).getByText('简历解析', { exact: true }).first()).toBeVisible()
  })

  test('AI 用量与额度：mock 模式显示诚实空态，不出现金额或次数', async ({ page }) => {
    const guards = await openAuthed(page, '/ai-services')
    await settleAdminPage(page, guards)
    const panel = page.getByRole('region', { name: 'AI 用量与额度' })
    await expect(panel).toBeVisible()
    await expect(panel.getByText('演示模式不连接真实用量数据')).toBeVisible()
    // 运营看钱的面板：mock 不造假数，面板里不能出现「x.xx 元」这类金额
    await expect(panel.getByText(/\d+\.\d{2} 元/)).toHaveCount(0)
  })

  test('AI 大模型：三档桌面宽度铺满，角标不拆字，地址保留悬停', async ({ page }) => {
    const guards = await openAuthed(page, '/ai-config')
    await settleAdminPage(page, guards)
    for (const [width, columns] of [[1280, 2], [1440, 3], [1920, 4]]) {
      await page.setViewportSize({ width, height: 1000 })
      const grid = page.locator('div.grid').filter({ has: page.getByRole('button', { name: /AI顾问对话/ }) }).first()
      await expect(grid).toBeVisible()
      const layout = await grid.evaluate((element) => ({
        columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
        width: element.getBoundingClientRect().width,
        parentWidth: element.parentElement!.getBoundingClientRect().width,
        nowrap: [...element.querySelectorAll('span.rounded-full')].every((badge) => getComputedStyle(badge).whiteSpace === 'nowrap'),
      }))
      expect(layout.columns).toBe(columns)
      expect(layout.parentWidth - layout.width).toBeLessThan(40)
      expect(layout.nowrap).toBe(true)
      await expect(grid.locator('p.font-mono[title]').first()).toBeVisible()
    }
  })

  test('AI 大模型：功能位可点，连通性测试给出 mock 中文原因', async ({ page }) => {
    const guards = await openAuthed(page, '/ai-config')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: 'AI大模型' })).toBeVisible()
    await expect(page.getByText('已接入的功能保存后生效；标为「未接入」的功能可以先保存配置，接入前不影响一体机。')).toBeVisible()
    await expect(page.getByRole('button', { name: /AI顾问对话/ }).first()).toBeVisible()
    await page.getByRole('button', { name: '保存并测试连通' }).click()
    await expect(page.getByText('当前为 mock 模式，连通性测试需要连接真实后端')).toBeVisible()
  })
})
