import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('订单管理（mock 口径：一条演示未支付单）', () => {
  test('筛选、打开详情、取消收款与退款入口', async ({ page }) => {
    const guards = await openAuthed(page, '/orders')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '订单管理' })).toBeVisible()

    await page.getByRole('button', { name: '已完成' }).click()
    await expect(page.getByText('ORD-20260625-MOCKREAD')).toBeVisible()
    await page.getByRole('button', { name: '全部' }).first().click()

    await page.getByRole('row', { name: /查看订单 ORD-20260625-MOCKREAD/ }).click()
    await expect(page.getByText('订单详情')).toBeVisible()

    await page.getByRole('button', { name: '确认收款' }).click()
    await expect(page.getByText('确认已在线下收到现金？')).toBeVisible()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByText('确认已在线下收到现金？')).toHaveCount(0)
    await expect(page.getByRole('status', { name: '未支付' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '订单管理' })).toBeVisible()
  })

  // M-2（2026-09-18）：待退款入口不得把 payStatus 钉死在「已支付」。
  //
  // 服务端 refundRequired=true 覆盖两类单，其中「渠道已收款但订单未转 paid」
  // 的 payStatus 是 closed/unpaid/paying。旧写法点一下 chip 会连带
  // setPayStatus('paid')，后端只查得到另一类。
  //
  // 这一条不读源码，读的是**点击之后界面上的既成事实**：支付状态那一排里
  // 高亮的必须是「全部支付状态」而不是「已支付」——那正是 payStatus 被清空的
  // 可观察后果。（mock 口径下没有待退款单，因此只断言筛选可达与状态正确，
  // 不断言结果集。）
  test('待退款入口可达，且不会连带选中「已支付」', async ({ page }) => {
    const guards = await openAuthed(page, '/orders')
    await settleAdminPage(page, guards)

    const pendingRefund = page.getByRole('button', { name: '待退款（已收款未出纸）' })
    await expect(pendingRefund).toBeVisible()

    // 触控/点击目标可达：chip 高度与文案都不得被裁切。
    const box = await pendingRefund.boundingBox()
    expect(box, '待退款 chip 没有可点击的盒模型').not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(28)
    const overflow = await pendingRefund.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    )
    expect(overflow, '待退款 chip 文案溢出被裁切').toBeLessThanOrEqual(1)

    await pendingRefund.click()

    const activeClass = /bg-primary-600/
    await expect(pendingRefund).toHaveClass(activeClass)
    await expect(page.getByRole('button', { name: '已支付', exact: true })).not.toHaveClass(activeClass)
    await expect(page.getByRole('button', { name: '全部支付状态' })).toHaveClass(activeClass)

    // 点完仍是正常列表页：无未捕获异常、无英文技术串。
    await settleAdminPage(page, guards)
  })
})
