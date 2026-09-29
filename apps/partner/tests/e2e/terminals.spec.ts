import { test, expect } from '@playwright/test'
import { collectPageFaults, gotoPartner, injectPartnerAuth, assertPageHonest } from './helpers'

test.describe('终端数据（mock 口径）', () => {
  test('试点四项指标如实呈现：演示数据有徽标，AI 可用率不冒充', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await injectPartnerAuth(page)
    await gotoPartner(page, '/terminals', '终端数据')
    // mock 模式只出明确标注的演示数据（http 模式不出，门禁 verify:partner-stats-contract D 段钉住）
    await expect(page.getByText('演示数据', { exact: true })).toBeVisible()
    for (const title of ['服务人次', '出纸成功率', 'AI 可用率', '故障与恢复']) {
      await expect(page.getByRole('heading', { name: title })).toBeVisible()
    }
    await expect(page.getByText(/不等于人次/).first()).toBeVisible()
    await expect(page.getByText('暂不能统计').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /导出 CSV/ })).toBeVisible()
    await page.getByRole('button', { name: '近 30 天' }).click()
    await expect(page.getByRole('button', { name: '近 30 天' })).toHaveAttribute('aria-pressed', 'true')
    await assertPageHonest(page, errors)
  })
})
