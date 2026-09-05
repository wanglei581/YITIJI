import { expect, test } from '@playwright/test'
import { expectDialogAndDismiss } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('设备 / 终端 / 打印机（mock 口径）', () => {
  test('历史路径重定向到设备管理 Tab', async ({ page }) => {
    const guards = await openAuthed(page, '/terminals')
    await expect(page).toHaveURL(/\/devices\?tab=terminals/)
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '设备管理' })).toBeVisible()
  })

  test('四个 Tab 可切换，停用终端有二次确认', async ({ page }) => {
    const guards = await openAuthed(page, '/devices')
    await settleAdminPage(page, guards)

    for (const tab of ['设备总览', '终端', '打印机', '外设']) {
      await page.getByRole('button', { name: tab }).click()
      await expect(page.getByRole('button', { name: tab })).toHaveAttribute('aria-pressed', 'true')
    }

    await page.getByRole('button', { name: '终端' }).click()
    const disable = page.getByRole('button', { name: /停用/ }).first()
    if (await disable.isVisible()) {
      await expectDialogAndDismiss(page, () => disable.click(), /确定停用终端/)
    }

    await page.getByRole('button', { name: '外设' }).click()
    await expect(page.getByText('本阶段不开放外设独立管理')).toBeVisible()
  })
})
