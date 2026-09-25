import { expect, test } from '@playwright/test'
import { expectDialogAndDismiss } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('来源审核：岗位 / 招聘会 / 政策（mock 口径）', () => {
  test('岗位信息源：查看、拒绝取消、下架二次确认', async ({ page }) => {
    const guards = await openAuthed(page, '/job-sources')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '岗位信息源' })).toBeVisible()
    await expect(page.getByText(/共\s+\d+\s+条/)).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '行业' })).toHaveCount(0)

    await page.getByRole('button', { name: /待审核/ }).click()
    await expect(page.getByRole('button', { name: '查看' }).first()).toBeVisible()
    await page.getByRole('button', { name: '查看' }).first().click()
    await expect(page.getByText('岗位来源详情')).toBeVisible()
    await page.getByRole('button', { name: '关闭' }).filter({ hasText: '关闭' }).click()

    await page.getByRole('button', { name: /已通过/ }).click()
    // 等「已通过」这一页真的换上来（没有待审核行），再找「下架」；
    // exact：同一行还有「紧急下架」，按子串会点到它（3.13）。
    await expect(page.getByRole('button', { name: '审核通过', exact: true })).toHaveCount(0)
    const unpublish = page.getByRole('button', { name: '下架', exact: true }).first()
    if (await unpublish.isVisible()) {
      await expectDialogAndDismiss(page, () => unpublish.click(), /确认下架/)
      await expect(page.getByText('已发布').first()).toBeVisible()
    }
  })

  test('招聘会信息源：下架有确认', async ({ page }) => {
    const guards = await openAuthed(page, '/fair-sources')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '招聘会信息源' })).toBeVisible()
    await expect(page.getByText(/共\s+\d+\s+条/)).toBeVisible()
    await page.getByRole('button', { name: '查看' }).first().click()
    await expect(page.getByText('参展企业数')).toBeVisible()
    await expect(page.getByText('展位数')).toHaveCount(0)
    await page.getByRole('button', { name: '关闭' }).filter({ hasText: '关闭' }).click()
    const unpublish = page.getByRole('button', { name: '下架', exact: true }).first()
    if (await unpublish.isVisible()) {
      await expectDialogAndDismiss(page, () => unpublish.click(), /确认下架/)
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
