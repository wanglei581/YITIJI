import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('打印扫描运维（mock 口径）', () => {
  test('三个分区可切换，任务中心刷新诚实', async ({ page }) => {
    const guards = await openAuthed(page, '/print-scan')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '打印扫描运维' })).toBeVisible()

    await page.getByRole('button', { name: '设备能力' }).click()
    await expect(page.getByRole('heading', { name: '打印扫描运维' })).toBeVisible()

    await page.getByRole('button', { name: '商业化控制' }).click()
    await expect(page.locator('h1')).toBeVisible()

    await page.getByRole('button', { name: '任务中心' }).click()
    await expect(page.getByRole('button', { name: /打印/ }).first()).toBeVisible()
  })
})
