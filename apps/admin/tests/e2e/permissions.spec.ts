import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

// 权限管理页 = 内部账号名册（3.9）。E2E 默认 mock 模式：不造假名册，只验诚实空态、
// 筛选入口与「新建备用管理员」抽屉在演示模式下的诚实拒绝（不发假验证码）。
// 真实接口链路（三种角色、启停、备用管理员两步）由 3401/5401 走查覆盖，不进本 spec。

test.describe('权限管理（内部账号名册）', () => {
  test('诚实空态：mock 模式不连接真实账号数据', async ({ page }) => {
    const guards = await openAuthed(page, '/permissions')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '权限管理' })).toBeVisible()

    // 顶部说明：本页管理什么、合作机构账号去哪处理
    await expect(page.getByText('本页管理平台内部账号：管理员（含备用管理员）、合作机构账号、终端账号。')).toBeVisible()
    await expect(page.getByText(/合作机构账号的启用停用在「合作机构管理」里做/)).toBeVisible()

    // mock 模式：名册保持诚实空态，不造假行
    await expect(page.getByText('当前演示模式不连接真实账号数据')).toBeVisible()
    await expect(page.locator('table').first()).toHaveCount(0)

    // 筛选入口存在（角色 / 状态 / 关键词）
    await expect(page.getByPlaceholder('搜索账号、姓名或完整手机号')).toBeVisible()
    await expect(page.getByRole('combobox').filter({ has: page.getByRole('option', { name: '全部角色' }) })).toBeVisible()
  })

  test('新建备用管理员抽屉：演示模式如实拒绝，不假装发码', async ({ page }) => {
    const guards = await openAuthed(page, '/permissions')
    await settleAdminPage(page, guards)

    await page.getByRole('button', { name: '新建备用管理员' }).click()
    const dialog = page.getByRole('dialog', { name: '新建备用管理员' })
    await expect(dialog).toBeVisible()

    // 抽屉必须先讲清建号语义：默认停用、随机临时密码
    await expect(dialog.getByText(/默认停用、使用随机临时密码（没有人知道）/)).toBeVisible()

    // 填好手机号与本人密码后发送验证码 → mock 模式明确说需要真实后端，不进入第二步
    await dialog.getByLabel(/备用管理员手机号/).fill('13800138000')
    await dialog.getByLabel(/管理员本人当前密码/).fill('demo-password')
    await dialog.getByRole('button', { name: '发送验证码' }).click()
    await expect(dialog.getByRole('alert')).toContainText('当前为演示模式')
    await expect(dialog.getByText('验证码已发送至')).toHaveCount(0)
    await expect(dialog.getByLabel('短信验证码')).toHaveCount(0)
  })
})
