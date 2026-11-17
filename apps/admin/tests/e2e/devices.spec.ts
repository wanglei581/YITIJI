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
    await expect(page.getByRole('button', { name: '设备总览', exact: true })).toHaveAttribute('aria-pressed', 'true')

    for (const tab of ['设备总览', '终端', '打印机', '外设']) {
      await page.getByRole('button', { name: tab, exact: true }).click()
      await expect(page.getByRole('button', { name: tab, exact: true })).toHaveAttribute('aria-pressed', 'true')
    }

    await page.getByRole('button', { name: '终端', exact: true }).click()
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
    await page.getByRole('button', { name: '外设', exact: true }).click()
    await expect(page.getByText('打印机异常', { exact: true })).toBeVisible()
    await expect(page.getByText(/^U 盘/).first()).toBeVisible()
    await expect(page.getByText('不上报').first()).toBeVisible()
    const peripheralFootnote = page.getByText(/U 盘、扫码枪、摄像头、读卡器由一体机本地使用/)
    await expect(peripheralFootnote).toBeVisible()
    await expect(peripheralFootnote).toContainText('当前不会向云端上报状态')
    await expect(peripheralFootnote).toContainText('后台看不到好坏')
    await expect(page.getByText('终端离线').first()).toBeVisible()

    await page.getByRole('button', { name: '打印机', exact: true }).click()
    await expect(page.getByText('张)')).toHaveCount(0)
    await expect(page.getByText('未上报').first()).toBeVisible()
  })

  test('终端详情点首页免费使用失败后开关仍是原来的开，并显示没有写入服务器', async ({ page }) => {
    const guards = await openAuthed(page, '/devices')
    await settleAdminPage(page, guards)
    await page.getByRole('button', { name: '终端', exact: true }).click()
    const manager = page.getByRole('button', { name: /^管理 / }).first()
    await expect(manager).toBeVisible()
    await manager.click()
    const drawer = page.getByRole('dialog', { name: /终端详情/ })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('heading', { name: '首页显示『免费使用』' })).toBeVisible()
    await expect(drawer.getByText('开着时，一体机首页只在五个生效价全是 0 元时显示『免费使用』；这台机器以后要收费，先关掉。')).toBeVisible()
    const toggle = drawer.getByRole('switch', { name: '首页显示『免费使用』' })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    // 演示包在保存函数里直接拒绝，请求发不出去。失败后必须停在点之前的「开」，
    // 否则管理员会以为已经关掉，再点一次发出去的是反方向。
    await expect(drawer.getByText('当前是演示数据，没有写入服务器')).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(toggle).toHaveText('开')
  })

  test('收费设置：公共点位锁死，自营点位可保存且总开关关着仍是 0 元', async ({ page }) => {
    const guards = await openAuthed(page, '/devices')
    await settleAdminPage(page, guards)
    await page.getByRole('button', { name: '终端', exact: true }).click()
    const search = page.getByPlaceholder('搜索编号、设备名、MAC、位置、IP...')

    await search.fill('QD-SB-GIG')
    await page.getByRole('button', { name: '管理 QD-SB-GIG' }).click()
    const drawer = page.getByRole('dialog', { name: /终端详情/ })
    await expect(drawer.getByRole('heading', { name: '收费设置' })).toBeVisible()
    await expect(drawer.getByText('公共就业点位永远不向求职者收费')).toBeVisible()
    await expect(drawer.getByRole('radio', { name: '向用户收费' })).toBeDisabled()
    await expect(drawer.getByRole('radio', { name: '机构或我方承担（用户免费）' })).toBeDisabled()
    await expect(drawer.getByRole('button', { name: '保存收费设置' })).toHaveCount(0)
    await drawer.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(drawer).toBeHidden()

    await search.fill('QD-LS-CAMPUS')
    await page.getByRole('button', { name: '管理 QD-LS-CAMPUS' }).click()
    await expect(drawer).toBeVisible()
    await drawer.getByRole('radio', { name: '向用户收费' }).check()
    await expect(drawer.getByText('这台机器绑定了机构。机构买的机器由机构承担；只有我方自己投放的机器才向用户收费，不用我方收款账户替机构收钱。')).toBeVisible()
    await drawer.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(drawer).toBeHidden()

    await search.fill('QD-SN-SELF')
    await page.getByRole('button', { name: '管理 QD-SN-SELF' }).click()
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('radio', { name: '向用户收费' })).toBeChecked()
    await expect(drawer.getByText(/现在实际向用户收：/)).toBeVisible()
    await expect(drawer.getByText(/总开关关着/)).toBeVisible()
    await drawer.getByRole('button', { name: '保存收费设置' }).click()
    await expect(drawer.getByText('已保存，并记入审计。')).toBeVisible()
    await expect(drawer.getByText(/总开关关着/)).toBeVisible()
  })
})
