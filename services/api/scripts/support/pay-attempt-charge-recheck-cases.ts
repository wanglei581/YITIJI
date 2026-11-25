/**
 * 出码前按订单所属终端的当前状态重算「该不该向个人收费」。
 * 由 verify-terminal-charge-settings 调用（同一个临时库、同一个 Nest 应用），不是单独的门禁入口。
 *
 * 断言照规格写：
 * - 订单建好没付，之后终端改绑到公共就业机构 / 总开关被关 / 改成机构付费：
 *   二维码、付款码两个入口都不出码，回 ORDER_CLOSED，这笔未付单被关掉，还没领走的打印任务一并取消；
 * - 仍该收费时照常出码，哪怕单价变了，金额仍是订单冻结的那个；
 * - 免费单的既有行为不变（仍是 PAY_NOT_REQUIRED，订单不动）。
 */
import assert from 'node:assert/strict'
import { AuditService } from '../../src/audit/audit.service'
import { OnlinePaymentService } from '../../src/payment/online-payment.service'
import { OrderStatusService } from '../../src/payment/order-status.service'
import {
  TERMINAL_NOT_CHARGING_CLOSE_ACTION,
  TERMINAL_NOT_CHARGING_TASK_ERROR_CODE,
} from '../../src/payment/pay-attempt-charge-recheck'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { createPaymentSessionToken } from '../../src/payment/payment-session-token'
import { SandboxPaymentProvider } from '../../src/payment/providers/sandbox-payment.provider'
import { PERSONAL_CHARGE_SETTING_KEY } from '../../src/payment/terminal-charge.contract'
import type { PrismaService } from '../../src/prisma/prisma.service'

interface CallResult {
  status: number
  json: { data?: Record<string, unknown>; error?: { code?: string; message?: string }; [key: string]: unknown }
}

export interface PayAttemptChargeRecheckDeps {
  prisma: PrismaService
  call: (method: string, path: string, body?: unknown, extra?: Record<string, string>) => Promise<CallResult>
  adminHeaders: Record<string, string>
  publicOrgId: string
}

const AUTH_CODE = '134567890123456789'
const PRINT_PRICES = { resume_optimize: 0, mock_interview: 0, print_bw_page: 50, print_color_page: 150, scan: 0 }

function codeOf(error: unknown): string {
  const exception = error as { getResponse?: () => unknown; message?: string }
  const response = typeof exception.getResponse === 'function' ? exception.getResponse() : undefined
  const nested = (response as { error?: { code?: string } } | undefined)?.error?.code
  const message = (response as { message?: unknown } | undefined)?.message
  return nested ?? (typeof message === 'string' ? message : exception.message ?? String(error))
}

async function expectCode(label: string, code: string, run: () => Promise<unknown>): Promise<void> {
  let caught: unknown
  try {
    await run()
  } catch (error) {
    caught = error
  }
  assert.ok(caught, `${label}：应拒绝并回 ${code}，实际成功了`)
  assert.equal(codeOf(caught), code, `${label}：错误码`)
}

export async function verifyPayAttemptChargeRecheck(deps: PayAttemptChargeRecheckDeps): Promise<void> {
  const { prisma, call, adminHeaders, publicOrgId } = deps
  process.env['PAYMENT_SESSION_SECRET'] ||= 'verify-pay-attempt-charge-recheck-session-0123456789'
  const audit = new AuditService(prisma)
  const provider = new SandboxPaymentProvider('verify-pay-attempt-charge-recheck-sandbox-0123')
  let qrCalls = 0
  let codeCalls = 0
  const createQr = provider.createQrPayment.bind(provider)
  const createCode = provider.createCodePayment.bind(provider)
  provider.createQrPayment = async (input) => { qrCalls += 1; return createQr(input) }
  provider.createCodePayment = async (input) => { codeCalls += 1; return createCode(input) }
  const payment = new OnlinePaymentService(
    prisma,
    audit,
    new OrderStatusService(prisma, audit),
    new PaymentProviderRegistry([provider]),
  )

  async function switchOn(): Promise<void> {
    await prisma.platformSetting.upsert({
      where: { key: PERSONAL_CHARGE_SETTING_KEY },
      create: { key: PERSONAL_CHARGE_SETTING_KEY, value: 'true' },
      update: { value: 'true' },
    })
  }

  /** 自营、向用户收费、打印有价的机器。 */
  async function chargingTerminal(id: string): Promise<void> {
    await prisma.terminal.create({
      data: { id, terminalCode: id.toUpperCase(), agentToken: `agent-${id}`, deviceFingerprint: `fp-${id}` },
    })
    const saved = await call('PUT', `/api/v1/admin/terminals/${id}/charge-settings`, {
      userChargeMode: 'user_pays',
      orgBindingGeneration: 0,
      prices: PRINT_PRICES,
    }, adminHeaders)
    assert.equal(saved.status, 200, `配成向用户收费：${JSON.stringify(saved.json)}`)
  }

  let seq = 0
  /** 一体机现场打印单：任务待领、订单未付，与建单接口落库的形状一致。 */
  async function kioskOrder(terminalId: string, amountCents: number, payStatus = 'unpaid') {
    seq += 1
    const taskId = `ptask-recheck-${seq}`
    await prisma.printTask.create({
      data: { id: taskId, terminalId, fileUrl: `/api/v1/files/recheck-${seq}/content`, fileMd5: `sha-${seq}`, status: 'pending' },
    })
    const order = await prisma.order.create({
      data: {
        orderNo: `ORD-RECHECK-${seq}`,
        type: 'print',
        channel: 'kiosk',
        printTaskId: taskId,
        terminalId,
        amountCents,
        payStatus,
        paymentSource: payStatus === 'paid' ? 'free' : null,
        taskStatus: 'pending',
      },
    })
    const token = createPaymentSessionToken({
      orderId: order.id,
      orderNo: order.orderNo,
      terminalId,
      amountCents,
      printTaskId: taskId,
    })
    return { orderId: order.id, taskId, token }
  }

  async function assertClosedWithoutCode(
    label: string,
    seeded: { orderId: string; taskId: string },
    reason: string,
  ): Promise<void> {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: seeded.orderId } })
    assert.equal(order.payStatus, 'closed', `${label}：未付单要被关掉`)
    assert.equal(order.taskStatus, 'cancelled', `${label}：订单上的任务状态跟着取消`)
    const task = await prisma.printTask.findUniqueOrThrow({ where: { id: seeded.taskId } })
    assert.equal(task.status, 'cancelled', `${label}：还没领走的打印任务要取消，不能留成待打印`)
    assert.equal(task.errorCode, TERMINAL_NOT_CHARGING_TASK_ERROR_CODE)
    assert.equal(await prisma.paymentAttempt.count({ where: { orderId: seeded.orderId } }), 0, `${label}：不能建付款尝试`)
    const log = await prisma.printTaskStatusLog.findFirst({ where: { taskId: seeded.taskId, toStatus: 'cancelled' } })
    assert.equal(log?.fromStatus, 'pending', `${label}：任务状态变化要留日志`)
    const row = await prisma.auditLog.findFirst({
      where: { action: TERMINAL_NOT_CHARGING_CLOSE_ACTION, targetType: 'order', targetId: seeded.orderId },
    })
    assert.ok(row, `${label}：关单要记审计`)
    const payload = JSON.parse(row.payloadJson ?? '{}') as { reason?: string; taskCancelled?: boolean }
    assert.equal(payload.reason, reason, `${label}：审计写明不收费的原因`)
    assert.equal(payload.taskCancelled, true)
  }

  await switchOn()

  // ── 改绑到公共就业机构：二维码、付款码都不出，订单关掉 ──
  await chargingTerminal('term-recheck-public')
  const publicQr = await kioskOrder('term-recheck-public', 100)
  const publicCode = await kioskOrder('term-recheck-public', 100)
  const rebound = await call('PATCH', '/api/v1/admin/terminals/term-recheck-public/org', { orgId: publicOrgId }, adminHeaders)
  assert.equal(rebound.status, 200, `改绑到公共就业机构：${JSON.stringify(rebound.json)}`)
  const qrBefore = qrCalls
  const codeBefore = codeCalls
  await expectCode('改绑到公共就业机构后出二维码', 'ORDER_CLOSED', () =>
    payment.createPayAttempt(publicQr.orderId, publicQr.token, 'sandbox'))
  await assertClosedWithoutCode('改绑公共点位 · 二维码', publicQr, 'public_site')
  await expectCode('改绑到公共就业机构后扫付款码', 'ORDER_CLOSED', () =>
    payment.createCodePayAttempt(publicCode.orderId, publicCode.token, AUTH_CODE, 'sandbox'))
  await assertClosedWithoutCode('改绑公共点位 · 付款码', publicCode, 'public_site')
  assert.equal(qrCalls, qrBefore, '不该收费时不能向渠道要二维码')
  assert.equal(codeCalls, codeBefore, '不该收费时不能向渠道提交付款码')
  await expectCode('已关的单再要码', 'ORDER_CLOSED', () =>
    payment.createPayAttempt(publicQr.orderId, publicQr.token, 'sandbox'))
  assert.equal(await prisma.paymentAttempt.count({ where: { orderId: publicQr.orderId } }), 0)
  console.log('PASS 改绑到公共就业机构后：二维码、付款码都不出，未付单关掉，打印任务取消')

  // ── 总开关关闭：同样 ──
  await chargingTerminal('term-recheck-switch')
  const switchQr = await kioskOrder('term-recheck-switch', 100)
  const switchCode = await kioskOrder('term-recheck-switch', 100)
  const turnedOff = await call('PUT', '/api/v1/admin/billing/personal-charge', { enabled: false }, adminHeaders)
  assert.equal(turnedOff.status, 200, `关总开关：${JSON.stringify(turnedOff.json)}`)
  await expectCode('总开关关闭后出二维码', 'ORDER_CLOSED', () =>
    payment.createPayAttempt(switchQr.orderId, switchQr.token, 'sandbox'))
  await assertClosedWithoutCode('总开关关闭 · 二维码', switchQr, 'personal_charge_off')
  await expectCode('总开关关闭后扫付款码', 'ORDER_CLOSED', () =>
    payment.createCodePayAttempt(switchCode.orderId, switchCode.token, AUTH_CODE, 'sandbox'))
  await assertClosedWithoutCode('总开关关闭 · 付款码', switchCode, 'personal_charge_off')
  console.log('PASS 总开关关闭后：二维码、付款码都不出，未付单关掉')
  await switchOn()

  // ── 改成机构付费：同样 ──
  const orgPaysQr = await kioskOrder('term-recheck-switch', 100)
  const generation = (await prisma.terminal.findUniqueOrThrow({ where: { id: 'term-recheck-switch' } })).orgBindingGeneration
  const toOrgPays = await call('PUT', '/api/v1/admin/terminals/term-recheck-switch/charge-settings', {
    userChargeMode: 'org_pays',
    orgBindingGeneration: generation,
    prices: PRINT_PRICES,
  }, adminHeaders)
  assert.equal(toOrgPays.status, 200, `改成机构付费：${JSON.stringify(toOrgPays.json)}`)
  await expectCode('改成机构付费后出二维码', 'ORDER_CLOSED', () =>
    payment.createPayAttempt(orgPaysQr.orderId, orgPaysQr.token, 'sandbox'))
  await assertClosedWithoutCode('机构付费 · 二维码', orgPaysQr, 'org_pays')
  console.log('PASS 改成机构付费后：不出码，未付单关掉')

  // ── 仍该收费：照常出码，单价变了也按订单冻结的金额 ──
  await chargingTerminal('term-recheck-still')
  const stillQr = await kioskOrder('term-recheck-still', 100)
  const stillCode = await kioskOrder('term-recheck-still', 100)
  await prisma.terminalServicePrice.update({
    where: { terminalId_serviceKey: { terminalId: 'term-recheck-still', serviceKey: 'print_bw_page' } },
    data: { unitCents: 80 },
  })
  const issued = await payment.createPayAttempt(stillQr.orderId, stillQr.token, 'sandbox')
  assert.equal(issued.status, 'pending', '仍该收费时照常出二维码')
  assert.equal(issued.amountCents, 100, '单价变了也按订单冻结的金额出码')
  assert.equal(issued.orderPayStatus, 'paying')
  assert.ok(issued.qrCodeContent)
  assert.equal((await prisma.printTask.findUniqueOrThrow({ where: { id: stillQr.taskId } })).status, 'pending', '照常出码不动打印任务')
  const codePaid = await payment.createCodePayAttempt(stillCode.orderId, stillCode.token, AUTH_CODE, 'sandbox')
  assert.equal(codePaid.status, 'success', '仍该收费时照常扫付款码')
  const codeAttempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: codePaid.attemptId } })
  assert.equal(codeAttempt.amountCents, 100, '付款码也按订单冻结的金额')
  assert.equal(await prisma.auditLog.count({
    where: { action: TERMINAL_NOT_CHARGING_CLOSE_ACTION, targetId: { in: [stillQr.orderId, stillCode.orderId] } },
  }), 0, '仍该收费时不能记关单审计')
  console.log('PASS 仍该收费时照常出码，单价变了也按订单冻结的金额')

  // ── 免费单的既有行为不变：公共点位上的 0 元单仍是 PAY_NOT_REQUIRED，订单与任务都不动 ──
  const freeOrder = await kioskOrder('term-recheck-public', 0, 'paid')
  await expectCode('0 元单出码', 'PAY_NOT_REQUIRED', () =>
    payment.createPayAttempt(freeOrder.orderId, freeOrder.token, 'sandbox'))
  await expectCode('0 元单扫付款码', 'PAY_NOT_REQUIRED', () =>
    payment.createCodePayAttempt(freeOrder.orderId, freeOrder.token, AUTH_CODE, 'sandbox'))
  const freeRow = await prisma.order.findUniqueOrThrow({ where: { id: freeOrder.orderId } })
  assert.equal(freeRow.payStatus, 'paid', '免费单不能被关掉')
  assert.equal(freeRow.paymentSource, 'free')
  assert.equal((await prisma.printTask.findUniqueOrThrow({ where: { id: freeOrder.taskId } })).status, 'pending', '免费单的打印任务不动')
  console.log('PASS 免费单仍是 PAY_NOT_REQUIRED，订单与打印任务都不动')
}
