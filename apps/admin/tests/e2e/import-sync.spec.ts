import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('导入批次 / 数据接入通道（mock 口径）', () => {
  test('Excel 导入记录页渲染', async ({ page }) => {
    const guards = await openAuthed(page, '/import-batches')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: 'Excel 导入记录' })).toBeVisible()
    await page.getByRole('button', { name: '查看招聘会' }).click()
    await expect(page).toHaveURL(/filterScope=org/)
    await expect(page.getByText('按来源机构筛选招聘会')).toBeVisible()
    await expect(page.getByText('无法按 Excel 批次精确过滤')).toBeVisible()
  })

  // 3.15：字段映射、立即同步、停用 / 审批启用、批量下架内容停放（SyncSourceWriteActions.tsx），只留按来源熔断。
  test('数据接入通道：只留查看与按来源熔断', async ({ page }) => {
    const guards = await openAuthed(page, '/sync-sources')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '数据接入通道' })).toBeVisible()
    await expect(page.getByRole('button', { name: '按来源熔断', exact: true }).first()).toBeVisible()
    for (const label of ['mappings', '审批并启用', '停用通道', '批量下架内容']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0)
    }
    await expect(page.getByRole('button', { name: /立即同步/ })).toHaveCount(0)
  })
})
