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

  test('发放 AI 额度：服务与次数联动，非法次数被拦，不出现购买引导', async ({ page }) => {
    const guards = await openAuthed(page, '/member-benefits')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('group', { name: '用于哪项 AI 服务' })).toHaveCount(0)
    await expect(page.getByLabel('次数')).toHaveCount(0)

    await page.getByLabel('权益类型').selectOption('ai_quota')
    await expect(page.getByRole('group', { name: '用于哪项 AI 服务' })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'AI 简历' })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'AI 顾问' })).toBeVisible()
    await expect(page.getByRole('radio', { name: '模拟面试' })).toBeVisible()
    await expect(page.getByLabel('次数')).toBeVisible()
    await expect(page.getByText('赠送给该会员的额外 AI 使用次数，先用每天的免费次数，用完再扣这里。')).toBeVisible()
    await expect(page.getByLabel('额度')).toHaveCount(0)

    await page.getByLabel('权益类型').selectOption('coupon')
    await expect(page.getByRole('radio', { name: 'AI 简历' })).toHaveCount(0)
    await expect(page.getByLabel('次数')).toHaveCount(0)
    await expect(page.getByLabel('额度')).toBeVisible()

    await page.getByLabel('权益类型').selectOption('ai_quota')
    await page.getByRole('button', { name: '发放 AI 额度' }).click()
    await expect(page.getByText('请选择这项额度用于哪项 AI 服务。')).toBeVisible()
    await expect(page.getByText('请填写次数。')).toBeVisible()

    await page.getByRole('radio', { name: 'AI 顾问' }).check()
    for (const raw of ['0', '10000', '1.5']) {
      await page.getByLabel('次数').fill(raw)
      await expect(page.getByText('次数须为 1–9999 的整数。')).toBeVisible()
    }
    await page.getByLabel('次数').fill('3')
    await expect(page.getByText('次数须为 1–9999 的整数。')).toHaveCount(0)
    await page.getByRole('button', { name: '发放 AI 额度' }).click()
    await expect(page.getByText('请先搜索并定位会员。')).toBeVisible()
    await expect(page.getByText('权益已发放')).toHaveCount(0)

    const text = await page.locator('body').innerText()
    expect(text).not.toMatch(/购买|充值|付费|价格/)
    expect(text).not.toMatch(/ai_quota|ai_resume|ai_assistant|ai_interview/)
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
