import { expect, test } from '@playwright/test'
import { expectDialogAndAccept, expectDialogAndDismiss } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('计费与对账 · 小程序虚拟支付页签', () => {
  test('开关与道具配置默认关且强制二次确认，订单同步查单与原路退款明示 iOS 限制', async ({ page }) => {
    const guards = await openAuthed(page, '/billing')
    await settleAdminPage(page, guards)

    await page.getByRole('button', { name: '小程序虚拟支付' }).click()
    await expect(page.getByRole('heading', { name: '小程序虚拟支付开关与道具配置' })).toBeVisible()
    await expect(page.getByText('开关已关')).toBeVisible()
    await expect(page.getByText('参数未就绪')).toBeVisible()
    await expect(page.getByText(/iOS 订单苹果不支持开发者主动退款，需由用户向 App Store 申请/)).toBeVisible()

    // 1. 开关二次确认：取消不切换，确认后切换并可再关闭
    const openBtn = page.getByRole('button', { name: '打开小程序虚拟支付' })
    await expectDialogAndDismiss(page, () => openBtn.click(), /确认打开小程序虚拟支付开关/)
    await expect(page.getByText('开关已关')).toBeVisible()

    await expectDialogAndAccept(page, () => openBtn.click(), /确认打开小程序虚拟支付开关/)
    await expect(page.getByText('开关已开')).toBeVisible()
    await expectDialogAndAccept(
      page,
      () => page.getByRole('button', { name: '关闭小程序虚拟支付' }).click(),
      /确认关闭小程序虚拟支付开关/,
    )
    await expect(page.getByText('开关已关')).toBeVisible()

    // 2. 道具配置二次确认（不硬编码真实价格，使用测试输入值）
    const resumeProductInput = page.getByRole('textbox', { name: 'AI 简历优化道具编号' })
    const resumePriceInput = page.getByRole('spinbutton', { name: 'AI 简历优化单价' })
    await resumeProductInput.fill('TEST_RESUME_01')
    await resumePriceInput.fill('1.00')
    const saveResumeBtn = page.getByRole('row').filter({ has: resumeProductInput }).getByRole('button', { name: '保存道具' })
    await expectDialogAndDismiss(page, () => saveResumeBtn.click(), /确认保存「AI 简历优化」虚拟支付道具配置/)
    await expect(page.getByRole('row').filter({ has: resumeProductInput }).getByText('未配置')).toBeVisible()

    await expectDialogAndAccept(page, () => saveResumeBtn.click(), /确认保存「AI 简历优化」虚拟支付道具配置/)
    await expect(page.getByRole('row').filter({ has: resumeProductInput }).getByText('已配置')).toBeVisible()

    // 3. 订单与权益中文状态、详情与同步查单
    const rowPaidAvailable = page.getByRole('row').filter({ hasText: 'vp000000000000000000000001' })
    await expect(rowPaidAvailable).toContainText('已支付')
    await expect(rowPaidAvailable).toContainText('可用')
    await expect(rowPaidAvailable.getByRole('button', { name: '原路退款' })).toBeVisible()

    const rowConsumed = page.getByRole('row').filter({ hasText: 'vp000000000000000000000002' })
    await expect(rowConsumed).toContainText('已核销')
    await expect(rowConsumed).toContainText('权益已核销，不可退款')
    await expect(rowConsumed.getByRole('button', { name: '原路退款' })).toHaveCount(0)

    // 详情弹窗：含微信单号/诊断说明且无原始 openId
    await rowConsumed.getByRole('button', { name: '详情' }).click()
    const detailDialog = page.getByRole('dialog', { name: '小程序虚拟支付订单详情' })
    await expect(detailDialog).toBeVisible()
    await expect(detailDialog).toContainText('wx_demo_002')
    await expect(detailDialog).toContainText('vpcord_demo_used_01')
    await detailDialog.getByRole('button', { name: '关闭' }).click()

    // 同步查单：将 refunding 收敛为已退款 + 已退回
    const rowRefunding = page.getByRole('row').filter({ hasText: 'vp000000000000000000000003' })
    await expect(rowRefunding).toContainText('退款中')
    await expect(rowRefunding).toContainText('微信侧退款处理中，请稍后同步查单确认')
    await rowRefunding.getByRole('button', { name: '同步查单' }).click()
    await expect(rowRefunding).toContainText('已退款')
    await expect(rowRefunding).toContainText('已退回')

    // 4. 原路退款二次确认弹窗：明示 iOS 苹果不支持开发者主动退款，未勾选禁止提交
    await rowPaidAvailable.getByRole('button', { name: '原路退款' }).click()
    const refundDialog = page.getByRole('dialog', { name: '确认发起小程序虚拟支付原路退款' })
    await expect(refundDialog).toBeVisible()
    await expect(refundDialog).toContainText('iOS 订单苹果不支持开发者主动退款，需由用户向 App Store 申请')
    const confirmSubmit = refundDialog.getByRole('button', { name: '确认发起原路退款' })
    await expect(confirmSubmit).toBeDisabled()
    await refundDialog.getByLabel(/退款备注/).fill('用户未核销申请退款')
    await refundDialog.getByRole('checkbox').check()
    await expect(confirmSubmit).toBeEnabled()
    await confirmSubmit.click()
    await expect(refundDialog).toHaveCount(0)
    await expect(rowPaidAvailable).toContainText('退款中')
  })
})
