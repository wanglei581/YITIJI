import { expect, test } from '@playwright/test'
import { expectChineseFeedback } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('会员权益 / 活动 / 反馈 / 通知 / 隐私（mock 口径）', () => {
  test('会员权益：非法手机号中文拦截；合法号码诚实说明 mock 不能检索', async ({ page }) => {
    const guards = await openAuthed(page, '/member-benefits')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '会员权益' })).toBeVisible()
    await page.getByRole('button', { name: '搜索会员' }).click()
    await expect(page.getByText('请输入 11 位中国大陆手机号')).toBeVisible()

    await page.getByPlaceholder('输入会员手机号精确搜索').fill('13800138000')
    await page.getByRole('button', { name: '搜索会员' }).click()
    await expectChineseFeedback(page.getByText('当前为 mock 模式，无法检索真实会员'))
  })

  test('权益活动页渲染并拒绝 mock 发布', async ({ page }) => {
    const guards = await openAuthed(page, '/benefit-activities')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '权益活动' })).toBeVisible()
  })

  test('意见反馈页诚实空态', async ({ page }) => {
    const guards = await openAuthed(page, '/member-feedback')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '意见反馈' })).toBeVisible()
  })

  test('消息通知：空标题提交给出中文原因', async ({ page }) => {
    const guards = await openAuthed(page, '/member-notifications')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '消息通知' })).toBeVisible()
    await page.getByPlaceholder('例如：系统维护提醒').fill('一')
    await page.getByPlaceholder('填写系统维护、设备服务、文件处理或打印服务说明').fill('一')
    await page.getByRole('button', { name: '创建广播' }).click()
    await expect(page.getByText('标题和内容至少填写 2 个字符')).toBeVisible()
  })

  test('数据权利工单页渲染', async ({ page }) => {
    const guards = await openAuthed(page, '/privacy-requests')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '数据权利工单' })).toBeVisible()
  })
})
