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
    const pageSize = page.getByRole('combobox')
    await expect(pageSize.locator('option')).toHaveText(['10', '20', '50', '100'])
    await pageSize.selectOption('100')
    await settleAdminPage(page, guards)
    await expect(pageSize).toHaveValue('100')
    await page.getByRole('button', { name: '扫描', exact: true }).click()
    await settleAdminPage(page, guards)
    await expect(pageSize).toHaveValue('100')
  })
  test('任务编号仅在悬停或详情可见，失败原因使用中文', async ({ page }) => {
    const guards = await openAuthed(page, '/print-scan')
    await settleAdminPage(page, guards)
    const task = page.getByRole('button', { name: /查看打印任务/ }).first()
    await expect(task).toHaveAttribute('title', /任务编号：/)
    expect(await page.locator('tbody').innerText()).not.toMatch(/ptask_|PRINTER_ERROR|PRINTER_OFFLINE|PAPER_EMPTY|PRINT_JOB_UNCONFIRMED/)
    await task.click()
    await expect(page.getByText('任务编号', { exact: true })).toBeVisible()
    await expect(page.getByText('失败原因', { exact: true }).last()).toBeVisible()
  })

})
