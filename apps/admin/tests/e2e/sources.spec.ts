import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('来源审核：岗位 / 招聘会 / 政策（mock 口径）', () => {
  // 3.15：审核 / 发布 / 下架不论托管开关一律停放（JobSourceReviewActions.tsx），原「拒绝取消、下架二次确认」
  // 测的是停放的按钮；改测「未审核」筛选可用、只剩查看与紧急下架。
  test('岗位信息源：按审核状态查看，只留查看与紧急下架', async ({ page }) => {
    const guards = await openAuthed(page, '/job-sources')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '岗位信息源' })).toBeVisible()
    await expect(page.getByText(/共\s+\d+\s+条/)).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '行业' })).toHaveCount(0)

    await page.getByRole('button', { name: /未审核/ }).click()
    await expect(page.getByRole('button', { name: '查看' }).first()).toBeVisible()
    await page.getByRole('button', { name: '查看' }).first().click()
    await expect(page.getByText('岗位来源详情')).toBeVisible()
    await page.getByRole('button', { name: '关闭' }).filter({ hasText: '关闭' }).click()

    await page.getByRole('button', { name: /已通过/ }).click()
    // 先等两种状态都会出现的「紧急下架」，再断言停放的按钮不存在，免得列表没渲染时计数为 0 假通过
    await expect(page.getByRole('button', { name: '紧急下架', exact: true }).first()).toBeVisible()
    for (const label of ['审核通过', '拒绝', '发布', '下架', '批量发布']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0)
    }
    await expect(page.getByText('本平台不代审、不代发招聘内容').first()).toBeVisible()
  })

  test('招聘会信息源：详情口径诚实，只留查看与紧急下架', async ({ page }) => {
    const guards = await openAuthed(page, '/fair-sources')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '招聘会信息源' })).toBeVisible()
    await expect(page.getByText(/共\s+\d+\s+条/)).toBeVisible()
    await page.getByRole('button', { name: '查看' }).first().click()
    await expect(page.getByText('参展企业数')).toBeVisible()
    await expect(page.getByText('展位数')).toHaveCount(0)
    await page.getByRole('button', { name: '关闭' }).filter({ hasText: '关闭' }).click()
    await expect(page.getByRole('button', { name: '紧急下架', exact: true }).first()).toBeVisible()
    for (const label of ['审核通过', '拒绝', '发布', '下架', '批量发布']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0)
    }
  })

  // 3.13：政策由机构自己审核发布，管理员只剩查看与紧急下架（两种托管状态都一样）。
  // 原「下架有浏览器确认」换成更严的「紧急下架必须选事由、写说明」，取消不改数据。
  test('政策信息源：管理员无审核 / 发布，紧急下架有事由确认', async ({ page }) => {
    const guards = await openAuthed(page, '/policy-sources')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '政策信息源' })).toBeVisible()
    await expect(page.getByText(/共\s+\d+\s+条/)).toBeVisible()
    for (const label of ['审核通过', '拒绝', '发布', '下架', '批量发布']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0)
    }
    await page.getByRole('button', { name: '紧急下架', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: /紧急下架政策/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: /确认紧急下架/ })).toBeDisabled()
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('已发布').first()).toBeVisible()
  })
})
