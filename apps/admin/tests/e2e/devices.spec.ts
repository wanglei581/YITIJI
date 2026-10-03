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
    // 等列表真的渲染出来再点：以前用「此刻是否可见」决定走不走抽屉，
    // 数据慢时整段被跳过（停用确认没测到），数据快时抽屉开着不关、后面的点击被遮罩挡住。
    const manager = page.getByRole('button', { name: /^管理 / }).first()
    await expect(manager).toBeVisible()
    await manager.click()
    const drawer = page.getByRole('dialog', { name: /终端详情/ })
    await expect(drawer).toBeVisible()
    const disable = drawer.getByRole('button', { name: '停用', exact: true })
    await expect(disable).toBeVisible()
    await expectDialogAndDismiss(page, () => disable.click(), /确定停用终端/)
    await drawer.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(drawer).toBeHidden()

    // 外设页（3.9）：按外设看的状态矩阵；云端没有遥测的四类外设如实写「不上报」，离线终端不冒充正常
    await page.getByRole('button', { name: '外设' }).click()
    await expect(page.getByText('打印机异常', { exact: true })).toBeVisible()
    await expect(page.getByText(/^U 盘/).first()).toBeVisible()
    await expect(page.getByText('不上报').first()).toBeVisible()
    const peripheralFootnote = page.getByText(/U 盘、扫码枪、摄像头、读卡器由一体机本地使用/)
    await expect(peripheralFootnote).toBeVisible()
    await expect(peripheralFootnote).toContainText('当前不会向云端上报状态')
    await expect(peripheralFootnote).toContainText('后台看不到好坏')
    await expect(page.getByText('终端离线').first()).toBeVisible()

    await page.getByRole('button', { name: '打印机' }).click()
    await expect(page.getByText('张)')).toHaveCount(0)
    await expect(page.getByText('未上报').first()).toBeVisible()
  })
})
