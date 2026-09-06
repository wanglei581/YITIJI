import { expect, test } from '@playwright/test'
import { expectDialogAndDismiss } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('来源审核：岗位 / 招聘会 / 政策（mock 口径）', () => {
  test('岗位信息源：查看、拒绝取消、下架二次确认', async ({ page }) => {
    const guards = await openAuthed(page, '/job-sources')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '岗位信息源' })).toBeVisible()

    await page.getByRole('button', { name: /待审核/ }).click()
    await expect(page.getByRole('button', { name: '查看' }).first()).toBeVisible()
    await page.getByRole('button', { name: '查看' }).first().click()
    await expect(page.getByText('岗位来源详情')).toBeVisible()
    await page.getByRole('button', { name: '关闭' }).filter({ hasText: '关闭' }).click()

    await page.getByRole('button', { name: /已通过/ }).click()
    const unpublish = page.getByRole('button', { name: '下架' }).first()
    if (await unpublish.isVisible()) {
      await expectDialogAndDismiss(page, () => unpublish.click(), /确认下架/)
      await expect(page.getByText('已发布').first()).toBeVisible()
    }
  })

  test('招聘会信息源：下架有确认', async ({ page }) => {
    const guards = await openAuthed(page, '/fair-sources')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '招聘会信息源' })).toBeVisible()
    const unpublish = page.getByRole('button', { name: '下架' }).first()
    if (await unpublish.isVisible()) {
      await expectDialogAndDismiss(page, () => unpublish.click(), /确认下架/)
    }
  })

  test('政策信息源：筛选与下架确认', async ({ page }) => {
    const guards = await openAuthed(page, '/policy-sources')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '政策信息源' })).toBeVisible()
    const unpublish = page.getByRole('button', { name: '下架' }).first()
    if (await unpublish.isVisible()) {
      await expectDialogAndDismiss(page, () => unpublish.click(), /确认下架/)
    }
  })
})
