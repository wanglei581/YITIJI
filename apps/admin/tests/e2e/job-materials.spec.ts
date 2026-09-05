import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('求职材料库（mock 口径）', () => {
  // 这一页 2026-09-06 从「只读运营页」改成了模板可编辑（模板后台可编辑合入 main）。
  // 因此断言的不再是「只读」，而是新页面必须诚实说清可编辑范围：
  // 模板可改，生成统计与文件只读——用户据此判断改动会不会影响线上。
  test('模板目录渲染模板或空态，且合规提示说清可编辑范围', async ({ page }) => {
    const guards = await openAuthed(page, '/job-materials')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '求职材料库' })).toBeVisible()
    await expect(page.getByText('模板可编辑，生成统计与文件只读')).toBeVisible()
    await expect(page.getByRole('heading', { name: '模板目录' })).toBeVisible()

    // 有模板就渲染列表，没有就渲染空态；两者必居其一，不允许两者都不出现（那是白屏）。
    const emptyState = page.getByText('暂无模板')
    const newTemplate = page.getByRole('button', { name: '新建模板' })
    await expect(newTemplate).toBeVisible()
    const hasEmpty = await emptyState.isVisible().catch(() => false)
    const hasRows = (await page.getByRole('button', { name: '编辑' }).count()) > 0
    expect(hasEmpty || hasRows).toBe(true)
  })
})
