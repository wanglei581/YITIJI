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

  test('未登记能力必须先选择状态才能登记，已登记行保留原状态', async ({ page }) => {
    const guards = await openAuthed(page, '/print-scan')
    await settleAdminPage(page, guards)
    await page.getByRole('button', { name: '设备能力' }).click()

    const materialRow = page.locator('tr').filter({ hasText: '材料包' })
    await expect(materialRow).toBeVisible()
    const materialSelect = materialRow.locator('select')
    await expect(materialSelect).toHaveValue('')
    await expect(materialSelect.locator('option:checked')).toHaveText('请选择')
    await expect(materialRow.getByRole('button', { name: '登记' })).toBeDisabled()
    await expect(materialRow.getByText('请先选择要登记的状态')).toBeVisible()

    // 彩色 / 双面未登记时一体机是关闭的，下拉仍不得预选成「未验收」。
    const colorRow = page.locator('tr').filter({ hasText: '彩色打印（需真机验证）' })
    await expect(colorRow.getByText('未登记 · 默认关闭')).toBeVisible()
    await expect(colorRow.locator('select')).toHaveValue('')
    await expect(colorRow.getByRole('button', { name: '登记' })).toBeDisabled()

    const printRow = page.locator('tr').filter({ hasText: '文档打印' })
    await expect(printRow.locator('select')).toHaveValue('available')
    await expect(printRow.getByRole('button', { name: '保存' })).toBeDisabled()
    await expect(printRow.getByText('请先选择要登记的状态')).toHaveCount(0)

    const usbRow = page.locator('tr').filter({ hasText: 'U盘导入' })
    await expect(usbRow.locator('select')).toHaveValue('not_verified')
    await expect(usbRow.getByRole('button', { name: '保存' })).toBeDisabled()

    await materialSelect.selectOption('available')
    await expect(materialRow.getByText('请先选择要登记的状态')).toHaveCount(0)
    await expect(materialRow.getByRole('button', { name: '登记' })).toBeEnabled()
    await materialRow.getByRole('button', { name: '登记' }).click()
    await expect(materialRow.getByText('已开通')).toBeVisible()
    await expect(materialRow.getByRole('button', { name: '保存' })).toBeDisabled()
    await settleAdminPage(page, guards)
  })

  test('已登记能力恢复未配置要先确认，确认后刷新列表', async ({ page }) => {
    const guards = await openAuthed(page, '/print-scan')
    await settleAdminPage(page, guards)
    await page.getByRole('button', { name: '设备能力' }).click()

    const materialRow = page.locator('tr').filter({ hasText: '材料包' })
    await expect(materialRow.getByRole('button', { name: '恢复未配置' })).toHaveCount(0)

    const printRow = page.locator('tr').filter({ hasText: '文档打印' })
    await expect(printRow.getByText('已开通')).toBeVisible()
    await printRow.getByRole('button', { name: '恢复未配置' }).click()
    await expect(page.getByRole('dialog', { name: '恢复未配置' })).toBeVisible()
    await expect(page.getByText('跟随服务器的默认设置')).toBeVisible()
    await expect(printRow.getByText('已开通')).toBeVisible()
    await page.getByRole('button', { name: '确认恢复' }).click()
    await expect(page.getByText('已恢复为未配置')).toBeVisible()
    await expect(printRow.getByText('未登记', { exact: true })).toBeVisible()
    await expect(printRow.getByRole('button', { name: '恢复未配置' })).toHaveCount(0)
    await settleAdminPage(page, guards)
  })

})
