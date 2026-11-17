/**
 * 服务单并发、价变、占用冲突和少收多退。临时 SQLite，真实 Nest HTTP。
 * 从 verify-service-orders.ts 拆出，断言不改。
 */
/**
 * 密钥必须写在任何 import 之前。swc 会把 import 提前。
 */
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-service-orders-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-service-orders-terminal-action-secret-0123456789'
process.env['ADMIN_IP_ALLOWLIST'] = ''
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['NODE_ENV'] = 'test'
process.env['PAYMENT_PROVIDER'] = 'sandbox'
process.env['SANDBOX_PAYMENT_SECRET'] = 'verify-service-orders-sandbox-secret'
process.env['JWT_SECRET'] = 'verify-service-orders-jwt-secret-0123456789'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { RedisService } from '../src/common/redis/redis.service'
import { SERVICE_SWEEP_BATCH } from '../src/payment/service-order.policy'
import { RefundService } from '../src/payment/refund.service'
import { collectDerivedAlerts } from '../src/admin-ops/derived-alerts'
import { assignTerminalOrganization } from '../src/terminals/terminal-org-assignment'
import { SandboxPaymentProvider } from '../src/payment/providers/sandbox-payment.provider'
import { setTerminalUserPrintPrices } from './support/terminal-charge-fixture'
import { executeServiceOrderRefund, settleServiceRefundNotify } from '../src/payment/service-order.payment'
import { saveTerminalChargeSettings, writePersonalChargeEnabled } from '../src/payment/terminal-charge-settings'
import type { PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import type { RefundNotifyEvent } from '../src/payment/payment-provider.types'
import {
  pass,
  withServiceOrderFixture,
  ADMIN,
  DEMO_PRICES,
  ORG_SCHOOL,
  TERM_CHARGE,
} from './support/service-order-verify-fixture'

async function main(): Promise<void> {
  await withServiceOrderFixture(async (fx) => {
    const {
      adminHeaders,
      ai,
      applyOpenRefIndex,
      audit,
      base,
      call,
      callback,
      chargeToken,
      databasePath,
      endKiosk,
      expectStatus,
      interview,
      loadOrder,
      openKiosk,
      openedInterviews,
      paidOrder,
      prisma,
      redis,
      refundCalls,
      refundMode,
      registry,
      scanCreates,
      scanReturnId,
      serviceOrders,
      termHeaders,
    } = fx
    function stillCharged(row: { status: string }): boolean {
      return row.status === 'paid' || row.status === 'consumed' || row.status === 'refunding' || row.status === 'refund_failed'
    }

    const r16Releases: Array<() => void> = []
    const r16Session = await openKiosk(TERM_CHARGE, chargeToken)
    const r16O1 = await paidOrder(r16Session, 'resume_optimize', 'sbx_txn_r16_1')
    const r16Original = ai.getResumeOptimize.bind(ai)
    ai.getResumeOptimize = async (taskId, _requester, _existingOnly, _req, beforeGenerate) => {
      if (beforeGenerate) await beforeGenerate()
      await new Promise<void>((resolve) => { r16Releases.push(resolve) })
      return { taskId, status: 'failed' }
    }
    const r16Abort = new AbortController()
    const r16Hung = fetch(`${base}/api/v1/resume/records/r16-task/optimize`, {
      headers: termHeaders(TERM_CHARGE, chargeToken, r16Session, r16O1.id),
      signal: r16Abort.signal,
    }).catch(() => null)
    for (let i = 0; i < 100; i += 1) {
      if ((await loadOrder(r16O1.id)).status === 'consumed') break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal((await loadOrder(r16O1.id)).status, 'consumed', 'R16 第一张单已经占上任务')
    r16Abort.abort()
    await r16Hung
    ai.getResumeOptimize = async (taskId, _requester, existingOnly, _req, beforeGenerate) => {
      if (existingOnly) return { taskId, status: 'completed' }
      if (beforeGenerate) await beforeGenerate()
      await prisma.aiResumeResult.upsert({
        where: { taskId_kind: { taskId, kind: 'optimize' } },
        create: { taskId, kind: 'optimize', status: 'completed', provider: 'rules' },
        update: { status: 'completed' },
      })
      return { taskId, status: 'completed' }
    }
    const r16NoOrder = await call('GET', '/api/v1/resume/records/r16-task/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, r16Session))
    expectStatus(r16NoOrder, 402, 'R16 丢了单号要再付')
    const r16O2 = await paidOrder(r16Session, 'resume_optimize', 'sbx_txn_r16_2')
    expectStatus(await call('GET', '/api/v1/resume/records/r16-task/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, r16Session, r16O2.id)), 200, 'R16 第二张单做出稿')
    ai.getResumeOptimize = r16Original
    await serviceOrders.sweep(new Date(Date.now() + 8 * 60_000))
    await endKiosk(TERM_CHARGE, chargeToken, r16Session)
    await serviceOrders.sweep(new Date(Date.now() + 24 * 60 * 60_000))
    const r16A = await loadOrder(r16O1.id)
    const r16B = await loadOrder(r16O2.id)
    assert.equal([r16A, r16B].filter(stillCharged).length, 1, 'R16 同一份优化稿只收一笔')
    assert.equal([r16A, r16B].filter((row) => row.status === 'refunded').length, 1, 'R16 另一张要退')
    // 认领拦截还在时，上面那两张到不了复核。这里直接摆两张已占用、同一任务、稿已做成的单，复核必须退一张。
    await prisma.$transaction((tx) => tx.$executeRaw`DROP INDEX IF EXISTS "ServiceOrder_open_consumed_ref_key"`)
    const reviewRef = 'r16-review-only'
    await prisma.aiResumeResult.upsert({
      where: { taskId_kind: { taskId: reviewRef, kind: 'optimize' } },
      create: { taskId: reviewRef, kind: 'optimize', status: 'completed', provider: 'rules' },
      update: { status: 'completed' },
    })
    const reviewBase = {
      terminalId: TERM_CHARGE,
      serviceKey: 'resume_optimize',
      amountCents: 100,
      status: 'consumed',
      attemptsUsed: 1,
      kioskSessionId: r16Session,
      provider: 'sandbox',
      consumedRef: reviewRef,
      consumedAt: new Date(Date.now() - 10 * 60_000),
      expiresAt: new Date(Date.now() + 60_000),
      paidAt: new Date(),
    }
    const reviewOld = await prisma.serviceOrder.create({
      data: { ...reviewBase, id: 'r16-review-old', providerOrderNo: 'r16-review-old-no', channelTxnNo: 'r16-review-old-txn' },
    })
    const reviewNew = await prisma.serviceOrder.create({
      data: { ...reviewBase, id: 'r16-review-new', providerOrderNo: 'r16-review-new-no', channelTxnNo: 'r16-review-new-txn' },
    })
    await serviceOrders.sweep(new Date())
    const reviewRows = [await loadOrder(reviewOld.id), await loadOrder(reviewNew.id)]
    assert.equal(reviewRows.filter(stillCharged).length, 1, 'R16 复核看到别的单占着同一任务时只留一笔')
    assert.equal(reviewRows.filter((row) => row.status === 'refunded').length, 1, 'R16 复核要把另一张退掉')
    applyOpenRefIndex(databasePath)
    for (const release of r16Releases) release()
    await new Promise((resolve) => setTimeout(resolve, 50))
    pass('R16 简历中断后再付，只收做出稿的那一笔')

    const r17Releases: Array<() => void> = []
    const r17Session = await openKiosk(TERM_CHARGE, chargeToken, 'interview')
    await prisma.mockInterviewSession.create({
      data: {
        id: 'r17-iv',
        status: 'configured',
        interviewerType: 'hr',
        industry: '仓储',
        position: '管理员',
        experience: 'y1_3',
        difficulty: 'standard',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    const r17O1 = await paidOrder(r17Session, 'mock_interview', 'sbx_txn_r17_1')
    const r17Original = interview.start.bind(interview)
    interview.start = async (id: string) => {
      await prisma.mockInterviewSession.update({ where: { id }, data: { status: 'in_progress', startedAt: new Date() } })
      await new Promise<void>((resolve) => { r17Releases.push(resolve) })
      return { id, status: 'started' }
    }
    const r17Abort = new AbortController()
    const r17Hung = fetch(`${base}/api/v1/mock-interviews/r17-iv/start`, {
      method: 'POST',
      headers: { ...termHeaders(TERM_CHARGE, chargeToken, r17Session, r17O1.id), 'content-type': 'application/json' },
      body: '{}',
      signal: r17Abort.signal,
    }).catch(() => null)
    for (let i = 0; i < 100; i += 1) {
      if ((await loadOrder(r17O1.id)).status === 'consumed') break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal((await loadOrder(r17O1.id)).status, 'consumed', 'R17 第一张单已经占上场次')
    r17Abort.abort()
    await r17Hung
    interview.start = async (id: string) => {
      const current = await prisma.mockInterviewSession.findUnique({ where: { id } })
      if (current?.status === 'in_progress') {
        throw new BadRequestException({ error: { code: 'INTERVIEW_ALREADY_STARTED', message: '本场练习已开始或已结束' } })
      }
      await prisma.mockInterviewSession.update({ where: { id }, data: { status: 'in_progress', startedAt: new Date() } })
      await prisma.mockInterviewTurn.create({
        data: { sessionId: id, idx: 0, role: 'interviewer', content: '请先做个自我介绍' },
      })
      openedInterviews.add(id)
      return { id, status: 'started' }
    }
    const r17O2 = await paidOrder(r17Session, 'mock_interview', 'sbx_txn_r17_2')
    const r17Try1 = await call('POST', '/api/v1/mock-interviews/r17-iv/start', {}, termHeaders(TERM_CHARGE, chargeToken, r17Session, r17O2.id))
    expectStatus(r17Try1, 201, 'R17 新单第一次就要开起来')
    assert.equal((await loadOrder(r17O2.id)).attemptsUsed, 1, 'R17 第一次就要占上')
    interview.start = r17Original
    await serviceOrders.sweep(new Date(Date.now() + 8 * 60_000))
    await endKiosk(TERM_CHARGE, chargeToken, r17Session)
    await serviceOrders.sweep(new Date(Date.now() + 24 * 60 * 60_000))
    const r17A = await loadOrder(r17O1.id)
    const r17B = await loadOrder(r17O2.id)
    assert.equal([r17A, r17B].filter(stillCharged).length, 1, 'R17 同一场面试只收一笔')
    assert.equal([r17A, r17B].filter((row) => row.status === 'refunded').length, 1, 'R17 另一张要退')
    for (const release of r17Releases) release()
    await new Promise((resolve) => setTimeout(resolve, 50))
    pass('R17 面试中断后再付，只收开起来的那一笔')

    async function pendingChargeOrder() {
      const sessionId = await openKiosk(TERM_CHARGE, chargeToken)
      const made = await call('POST', '/api/v1/kiosk/service-orders', {
        serviceKey: 'resume_optimize', kioskSessionId: sessionId,
      }, termHeaders(TERM_CHARGE, chargeToken))
      expectStatus(made, 200, '待付建单')
      const row = await loadOrder(String(made.json.data?.['id']))
      assert.equal(row.status, 'pending')
      return { sessionId, row }
    }

    async function payOldCode(
      row: { id: string; providerOrderNo: string; prepayId: string | null; amountCents: number },
      txn: string,
      reason: string,
    ): Promise<void> {
      const before = fx.refundCalls
      expectStatus(await callback(row, 'success', txn), 200, txn)
      const after = await loadOrder(row.id)
      assert.equal(after.status, 'refunded', `${txn} 当场退`)
      assert.equal(after.refundReason, reason)
      assert.equal(after.consumedAt, null, `${txn} 退了就不能用`)
      assert.equal(fx.refundCalls, before + 1, `${txn} 只退一次`)
      expectStatus(await callback(row, 'success', txn), 200, `${txn} 再通知`)
      assert.equal(fx.refundCalls, before + 1, `${txn} 不能退第二次`)
      assert.equal((await loadOrder(row.id)).status, 'refunded')
    }

    const recheck = await pendingChargeOrder()
    await prisma.terminalServicePrice.update({
      where: { terminalId_serviceKey: { terminalId: TERM_CHARGE, serviceKey: 'resume_optimize' } },
      data: { unitCents: 180 },
    })
    const recheckBeforePay = await loadOrder(recheck.row.id)
    assert.equal(recheckBeforePay.status, 'pending', '直接改价不关单，通知前仍是待付')
    await payOldCode(recheck.row, 'sbx_txn_price_recheck', '这一项的价格已经变了')
    await prisma.terminalServicePrice.update({
      where: { terminalId_serviceKey: { terminalId: TERM_CHARGE, serviceKey: 'resume_optimize' } },
      data: { unitCents: 100 },
    })
    pass('生效价变了，原码付款当场退，只退一次')

    const repriced = await pendingChargeOrder()
    await saveTerminalChargeSettings(prisma, TERM_CHARGE, {
      userChargeMode: 'user_pays',
      prices: { ...DEMO_PRICES, resume_optimize: 180 },
    }, ADMIN)
    const repricedClosed = await loadOrder(repriced.row.id)
    assert.equal(repricedClosed.status, 'closed', '改价成功后、付款通知前必须已经关掉')
    assert.equal(repricedClosed.closeReason, 'price_changed')
    await payOldCode(repriced.row, 'sbx_txn_price_change', '付款时这一单已经关闭')
    await setTerminalUserPrintPrices(prisma, TERM_CHARGE, DEMO_PRICES)
    pass('改价后旧付款码不能按旧价收')

    const switched = await pendingChargeOrder()
    await writePersonalChargeEnabled(prisma, false, undefined, ADMIN)
    const switchedClosed = await loadOrder(switched.row.id)
    assert.equal(switchedClosed.status, 'closed', '关掉总开关后、付款通知前必须已经关掉')
    assert.equal(switchedClosed.closeReason, 'personal_charge_changed')
    await payOldCode(switched.row, 'sbx_txn_r18', '付款时这一单已经关闭')
    await writePersonalChargeEnabled(prisma, true, true, ADMIN)
    pass('R18 关掉总开关后旧付款码不能收')

    const rebound = await pendingChargeOrder()
    await assignTerminalOrganization(prisma, TERM_CHARGE, ORG_SCHOOL, new Date(), async () => undefined)
    const reboundClosed = await loadOrder(rebound.row.id)
    assert.equal(reboundClosed.status, 'closed', '改绑成功后、付款通知前必须已经关掉')
    assert.equal(reboundClosed.closeReason, 'org_rebound')
    await payOldCode(rebound.row, 'sbx_txn_r19', '付款时这一单已经关闭')
    await assignTerminalOrganization(prisma, TERM_CHARGE, null, new Date(), async () => undefined)
    await setTerminalUserPrintPrices(prisma, TERM_CHARGE, DEMO_PRICES)
    pass('R19 改绑后旧付款码不能收')

    const r20Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    await prisma.scanTask.create({
      data: { id: 'r20-dup', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    fx.scanReturnId = 'r20-dup'
    const r20Holder = await paidOrder(r20Session, 'scan', 'sbx_txn_r20_x')
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, r20Session, r20Holder.id)), 201, 'R20 先占上这一次扫描')
    const r20Order = await paidOrder(r20Session, 'scan', 'sbx_txn_r20_o')
    await prisma.serviceOrder.update({
      where: { id: r20Order.id },
      data: { attemptsUsed: 1, failureReason: '扫描没出文件', retryUntil: new Date(Date.now() + 10 * 60_000) },
    })
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, r20Session, r20Order.id)), 201, 'R20 挂不上就退回')
    const r20Released = await loadOrder(r20Order.id)
    assert.equal(r20Released.status, 'paid', 'R20 退回后仍是已付')
    assert.ok(r20Released.attemptsUsed >= 1, 'R20 用过的次数还在')
    assert.ok(r20Released.retryUntil, 'R20 退回后必须还在可重用期内')
    await serviceOrders.sweep()
    assert.equal((await loadOrder(r20Order.id)).status, 'paid', 'R20 还在可重用期内不能退')
    await prisma.serviceOrder.update({ where: { id: r20Order.id }, data: { retryUntil: null } })
    await serviceOrders.sweep()
    const r20Final = await loadOrder(r20Order.id)
    assert.equal(r20Final.status, 'refunded', 'R20 没了再试期限必须由清扫退')
    assert.equal(r20Final.refundReason, '免费再试已过期')
    pass('R20 再试被退回后，要么还能再试，要么清扫退款')

    const r21Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    const r21Order = await paidOrder(r21Session, 'scan', 'sbx_txn_r21')
    await prisma.serviceOrder.update({
      where: { id: r21Order.id },
      data: {
        status: 'refunding',
        refundAttempts: 7,
        refundNo: `svc-rfd-${r21Order.id}`,
        refundReason: '人已离开，这一次还没用',
        refundChannelState: 'failed',
        nextRefundAt: new Date(Date.now() - 1000),
        refundLeaseUntil: null,
      },
    })
    fx.refundMode = 'throw'
    const r21Manual = await call('POST', `/api/v1/admin/orders/${r21Order.id}/retry-service-refund`, {}, adminHeaders)
    expectStatus(r21Manual, 200, 'R21 手动再试')
    const r21After = await loadOrder(r21Order.id)
    assert.equal(r21After.status, 'refund_failed', 'R21 到上限后进入退款待人工处理')
    assert.equal(r21After.refundAttempts, 8)
    assert.equal(await prisma.auditLog.count({ where: { action: 'service_order.refund_retry', targetId: r21Order.id, actorId: ADMIN } }), 1, 'R21 手动失败要记审计')
    const r21Listed = await call('GET', '/api/v1/admin/orders?recordKind=service&serviceStatus=refund_failed', undefined, adminHeaders)
    expectStatus(r21Listed, 200, 'R21 后台能筛退款待人工处理')
    assert.ok((r21Listed.json.items ?? []).some((item) => item['id'] === r21Order.id), 'R21 这张单要出现在筛选里')
    await serviceOrders.sweep()
    await serviceOrders.sweep()
    await serviceOrders.sweep()
    const r21Held = await loadOrder(r21Order.id)
    assert.equal(r21Held.status, 'refund_failed', 'R21 清扫不能把它留在退款中，也不能当成已退')
    assert.equal(r21Held.refundAttempts, 8, 'R21 到上限后清扫不再打渠道')
    const r21Leak = randomUUID()
    await prisma.serviceOrder.create({
      data: {
        id: r21Leak,
        terminalId: TERM_CHARGE,
        serviceKey: 'scan',
        amountCents: 100,
        status: 'refunding',
        attemptsUsed: 1,
        refundAttempts: 8,
        refundNo: `svc-rfd-${r21Leak}`,
        refundReason: '人已离开，这一次还没用',
        kioskSessionId: r21Session,
        provider: 'sandbox',
        providerOrderNo: `r21-leak-${r21Leak}`,
        expiresAt: new Date(Date.now() + 60_000),
        paidAt: new Date(),
        channelTxnNo: `r21-txn-${r21Leak}`,
        nextRefundAt: null,
        refundLeaseUntil: null,
      },
    })
    await serviceOrders.sweep()
    const r21LeakAfter = await loadOrder(r21Leak)
    assert.equal(r21LeakAfter.status, 'refund_failed', 'R21 漏在退款中的到顶单要交给人工')
    assert.equal(r21LeakAfter.refundAttempts, 8, 'R21 交给人工时不再打渠道')
    const r21Alerts = await collectDerivedAlerts(prisma, new Date())
    assert.ok(r21Alerts.alerts.some((alert) => alert.type === 'service_return_manual' && alert.subjectId === r21Order.id), 'R21 告警中心要有这一张')
    assert.equal(r21Alerts.firingTotal, r21Alerts.alerts.length + r21Alerts.omitted)
    fx.refundMode = 'ok'
    const r21Again = await call('POST', `/api/v1/admin/orders/${r21Order.id}/retry-service-refund`, {}, adminHeaders)
    expectStatus(r21Again, 200, 'R21 人工再试一次可以退成')
    assert.equal((await loadOrder(r21Order.id)).status, 'refunded')
    const r21AlertsAfter = await collectDerivedAlerts(prisma, new Date())
    assert.equal(r21AlertsAfter.alerts.some((alert) => alert.subjectId === r21Order.id), false, 'R21 退成后告警消失')
    pass('R21 退款到上限后待人工处理，失败也留在那里')

    const r22Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    await prisma.scanTask.create({
      data: { id: 'r22-1', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    fx.scanReturnId = 'r22-1'
    const r22Order = await paidOrder(r22Session, 'scan', 'sbx_txn_r22')
    const r22Creates = fx.scanCreates
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, r22Session, r22Order.id)), 201, 'R22 第一次扫描')
    assert.equal(fx.scanCreates, r22Creates + 1)
    await prisma.scanTask.update({ where: { id: 'r22-1' }, data: { status: 'completed', fileId: 'file-r22-1' } })
    await prisma.scanTask.create({
      data: { id: 'r22-2', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    fx.scanReturnId = 'r22-2'
    const r22BeforeSecond = fx.scanCreates
    const r22Second = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, r22Session, r22Order.id))
    expectStatus(r22Second, 409, 'R22 已经有文件不能再开新扫描')
    assert.equal(r22Second.json.error?.code, 'SERVICE_ORDER_IN_USE')
    assert.equal(fx.scanCreates, r22BeforeSecond, 'R22 有文件时不能再创建扫描任务')
    assert.equal((await loadOrder(r22Order.id)).consumedRef, 'r22-1')
    const r22LiveSession = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    await prisma.scanTask.create({
      data: { id: 'r22-live', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    fx.scanReturnId = 'r22-live'
    const r22Live = await paidOrder(r22LiveSession, 'scan', 'sbx_txn_r22_live')
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, r22LiveSession, r22Live.id)), 201, 'R22 活着的扫描')
    await prisma.scanTask.create({
      data: { id: 'r22-other', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    fx.scanReturnId = 'r22-other'
    const r22Attach = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, r22LiveSession, r22Live.id))
    expectStatus(r22Attach, 409, 'R22 换一个任务挂上来要拒绝')
    assert.equal(r22Attach.json.error?.code, 'SERVICE_ORDER_IN_USE')
    assert.equal((await loadOrder(r22Live.id)).consumedRef, 'r22-live', 'R22 拒绝后原任务还在这张单上')
    await prisma.serviceOrder.update({ where: { id: r22Order.id }, data: { consumedAt: new Date(Date.now() - 20_000) } })
    await serviceOrders.sweep()
    assert.ok((await loadOrder(r22Order.id)).settledAt, 'R22 出了文件要结案')
    await prisma.scanTask.create({
      data: { id: 'r22-3', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    fx.scanReturnId = 'r22-3'
    const r22Third = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, r22Session, r22Order.id))
    expectStatus(r22Third, 409, 'R22 结案后不能再开')
    const r22View = await call('GET', `/api/v1/kiosk/service-orders/${r22Order.id}`, undefined, termHeaders(TERM_CHARGE, chargeToken, r22Session))
    expectStatus(r22View, 200, 'R22 读单')
    assert.equal(Object.prototype.hasOwnProperty.call(r22View.json.data ?? {}, 'settledAt'), true, 'R22 读单要带结案时间')
    assert.equal(typeof r22View.json.data?.['settledAt'], 'string')
    pass('R22 一张单用过之后不能再开新扫描，读单能看到结案时间')

    const r23Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    await prisma.scanTask.create({
      data: { id: 'r23-slow', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 10 * 60_000) },
    })
    fx.scanReturnId = 'r23-slow'
    const r23Order = await paidOrder(r23Session, 'scan', 'sbx_txn_r23')
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, r23Session, r23Order.id)), 201, 'R23 扫描开始')
    await prisma.serviceOrder.update({ where: { id: r23Order.id }, data: { consumedAt: new Date(Date.now() - 30 * 60_000) } })
    await serviceOrders.sweep()
    const r23Live = await loadOrder(r23Order.id)
    assert.equal(r23Live.status, 'consumed', 'R23 会话还活着不能判没做成')
    assert.equal(r23Live.refundedAt, null)
    await prisma.serviceOrder.update({ where: { id: r23Order.id }, data: { attemptsUsed: 2 } })
    await prisma.scanTask.update({ where: { id: 'r23-slow' }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await serviceOrders.sweep()
    const r23Expired = await loadOrder(r23Order.id)
    assert.equal(r23Expired.status, 'refunded', 'R23 过了有效期还没文件才退')
    await prisma.scanTask.update({ where: { id: 'r23-slow' }, data: { status: 'completed', fileId: 'file-r23' } })
    await serviceOrders.sweep()
    const r23Later = await loadOrder(r23Order.id)
    assert.equal(r23Later.status, 'refunded', 'R23 退了之后文件出来也不再收')
    assert.equal(r23Later.amountCents, 100)
    pass('R23 活着的扫描不判，过期才退，之后出文件不再收')

    const r24Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    const r24Ok = await paidOrder(r24Session, 'scan', 'sbx_txn_r24')
    fx.refundMode = 'processing'
    await executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, r24Ok.id, '人已离开，这一次还没用')
    fx.refundMode = 'ok'
    const r24Success = { refundNo: `svc-rfd-${r24Ok.id}`, channelRefundNo: 'wx-rfd-r24', refundAmountCents: 100, status: 'success' as const }
    const r24First = await settleServiceRefundNotify(prisma, audit, null, r24Success)
    const r24Second = await settleServiceRefundNotify(prisma, audit, null, r24Success)
    assert.equal((await loadOrder(r24Ok.id)).status, 'refunded', 'R24 成功通知记已退')
    assert.equal(await prisma.auditLog.count({ where: { action: 'service_order.refunded', targetId: r24Ok.id } }), 1, 'R24 成功通知只记一次')
    assert.equal(r24Second.idempotent, true)
    assert.equal(r24First.handled, true)
    const r24Fail = await paidOrder(r24Session, 'scan', 'sbx_txn_r24b')
    fx.refundMode = 'processing'
    await executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, r24Fail.id, '人已离开，这一次还没用')
    fx.refundMode = 'ok'
    const r24FailNotice = { refundNo: `svc-rfd-${r24Fail.id}`, channelRefundNo: null, refundAmountCents: null, status: 'failed' as const }
    await settleServiceRefundNotify(prisma, audit, null, r24FailNotice)
    const r24FailOnce = await loadOrder(r24Fail.id)
    await settleServiceRefundNotify(prisma, audit, null, r24FailNotice)
    const r24FailTwice = await loadOrder(r24Fail.id)
    assert.equal(r24FailTwice.refundAttempts, r24FailOnce.refundAttempts, 'R24 同一条失败通知不能记两次')
    assert.equal(r24FailTwice.refundAttempts, 1)
    const r24ThenOk = await settleServiceRefundNotify(prisma, audit, null, {
      refundNo: `svc-rfd-${r24Fail.id}`, channelRefundNo: 'wx-rfd-r24-ok', refundAmountCents: 100, status: 'success',
    })
    assert.equal(r24ThenOk.handled, true)
    assert.equal((await loadOrder(r24Fail.id)).status, 'refunded', 'R24 失败之后换一条成功通知要收下')
    const r24Mismatch = await paidOrder(r24Session, 'scan', 'sbx_txn_r24c')
    fx.refundMode = 'processing'
    await executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, r24Mismatch.id, '人已离开，这一次还没用')
    fx.refundMode = 'ok'
    const r24Bad = await settleServiceRefundNotify(prisma, audit, null, {
      refundNo: `svc-rfd-${r24Mismatch.id}`, channelRefundNo: 'wx-rfd-bad', refundAmountCents: 1, status: 'success',
    })
    assert.equal(r24Bad.handled, true, 'R24 金额不符也要回已处理')
    const r24BadRow = await loadOrder(r24Mismatch.id)
    assert.notEqual(r24BadRow.status, 'refunded', 'R24 金额不符不能记成已退')
    assert.ok(r24BadRow.refundAnomaly, 'R24 金额不符要记下来')
    const r24Alerts = await collectDerivedAlerts(prisma, new Date())
    assert.ok(r24Alerts.alerts.some((alert) => alert.type === 'service_return_manual' && alert.subjectId === r24Mismatch.id), 'R24 金额不符要进告警中心')
    const r24Unknown = await settleServiceRefundNotify(prisma, audit, null, {
      refundNo: 'svc-rfd-missing-order', channelRefundNo: 'wx-rfd-missing', refundAmountCents: 100, status: 'success',
    })
    assert.equal(r24Unknown.handled, true, 'R24 对不上的服务单退款通知也不再让渠道重发')
    pass('R24 退款通知只处理一次，对不上也回成功')

    const originalCloseQr = SandboxPaymentProvider.prototype.closeExpiredQrPayment
    const closeQr = SandboxPaymentProvider.prototype as unknown as {
      closeExpiredQrPayment: (input: { attemptId: string; orderId: string }) => Promise<{ status: string; channelTxnNo: string | null; amountCents: number | null }>
    }
    try {
      const g1 = await pendingChargeOrder()
      await prisma.terminalServicePrice.update({
        where: { terminalId_serviceKey: { terminalId: TERM_CHARGE, serviceKey: 'resume_optimize' } },
        data: { unitCents: 180 },
      })
      await prisma.serviceOrder.update({
        where: { id: g1.row.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      closeQr.closeExpiredQrPayment = async (input) => {
        if (input.orderId !== g1.row.id) return originalCloseQr.call(SandboxPaymentProvider.prototype, input)
        return { status: 'paid', channelTxnNo: 'sbx_txn_g1_expire', amountCents: g1.row.amountCents }
      }
      const g1Refunds = fx.refundCalls
      await serviceOrders.sweep(new Date())
      const g1After = await loadOrder(g1.row.id)
      assert.equal(g1After.status, 'refunded', 'G1 到期关码发现已付且价已变，必须当场退')
      assert.equal(g1After.refundReason, '这一项的价格已经变了')
      assert.equal(g1After.consumedAt, null, 'G1 退了就不能按旧价用掉')
      assert.equal(fx.refundCalls, g1Refunds + 1, 'G1 只退一次')
      const g1Use = await call('GET', '/api/v1/resume/records/g1-task/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, g1.sessionId, g1.row.id))
      expectStatus(g1Use, 402, 'G1 退掉的单不能再优化')
      assert.equal((await loadOrder(g1.row.id)).status, 'refunded')
      pass('G1 到期关码查到已付且价已变，当场退')
    } finally {
      closeQr.closeExpiredQrPayment = originalCloseQr
      await prisma.terminalServicePrice.update({
        where: { terminalId_serviceKey: { terminalId: TERM_CHARGE, serviceKey: 'resume_optimize' } },
        data: { unitCents: 100 },
      }).catch(() => undefined)
    }

    const g10Session = await openKiosk(TERM_CHARGE, chargeToken)
    const g10When = new Date(Date.now() - 2 * 60 * 60_000)
    await prisma.serviceOrder.create({
      data: {
        id: 'g10-old',
        terminalId: TERM_CHARGE,
        serviceKey: 'resume_optimize',
        amountCents: 100,
        status: 'consumed',
        attemptsUsed: 1,
        consumedRef: 'g10-task',
        consumedAt: g10When,
        settledAt: g10When,
        kioskSessionId: g10Session,
        provider: 'sandbox',
        providerOrderNo: 'g10-old-no',
        expiresAt: new Date(Date.now() + 60_000),
        paidAt: g10When,
        channelTxnNo: 'g10-old-txn',
      },
    })
    const g10New = await paidOrder(g10Session, 'resume_optimize', 'sbx_txn_g10')
    const g10Res = await call('GET', '/api/v1/resume/records/g10-task/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, g10Session, g10New.id))
    expectStatus(g10Res, 409, 'G10 结案的旧单不能让新单接手')
    assert.equal(g10Res.json.error?.code, 'SERVICE_ORDER_REF_OCCUPIED')
    assert.equal(g10Res.json.error?.existingOrderId, 'g10-old')
    const g10OldAfter = await loadOrder('g10-old')
    assert.equal(g10OldAfter.status, 'consumed', 'G10 旧单保持已占用')
    assert.ok(g10OldAfter.settledAt, 'G10 旧单仍然结案')
    assert.equal(g10OldAfter.refundReason, null, 'G10 不能把做成的旧单退掉')
    const g10NewAfter = await loadOrder(g10New.id)
    assert.equal(g10NewAfter.status, 'paid')
    assert.equal(g10NewAfter.attemptsUsed, 0)
    pass('G10 已经结案的旧单不许退，新单进不去')

    const g2Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    await prisma.scanTask.create({
      data: { id: 'g2-live', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    fx.scanReturnId = 'g2-live'
    const g2 = await paidOrder(g2Session, 'scan', 'sbx_txn_g2')
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, g2Session, g2.id)), 201, 'G2 第一次扫描')
    assert.equal((await loadOrder(g2.id)).consumedRef, 'g2-live')
    await prisma.scanTask.create({
      data: { id: 'g2-other', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    fx.scanReturnId = 'g2-other'
    const g2Before = fx.scanCreates
    const g2Replay = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, g2Session, g2.id))
    expectStatus(g2Replay, 409, 'G2 换任务号要拒绝')
    assert.equal(g2Replay.json.error?.code, 'SERVICE_ORDER_IN_USE')
    assert.equal(g2Replay.json.error?.consumedRef, 'g2-live', 'G2 拒绝时要带这张单正在占的任务')
    assert.equal(fx.scanCreates, g2Before, 'G2 拒绝前不能再建扫描任务')
    assert.equal((await loadOrder(g2.id)).consumedRef, 'g2-live')
    pass('G2 重放换成另一个任务时，不建新任务，409 带原来的任务号')

    const g9Session = await openKiosk(TERM_CHARGE, chargeToken)
    await prisma.aiResumeResult.upsert({
      where: { taskId_kind: { taskId: 'g9-task', kind: 'optimize' } },
      create: { taskId: 'g9-task', kind: 'optimize', status: 'completed', provider: 'rules' },
      update: { status: 'completed' },
    })
    const g9Old = await prisma.serviceOrder.create({
      data: {
        id: 'g9-old',
        terminalId: TERM_CHARGE,
        serviceKey: 'resume_optimize',
        amountCents: 100,
        status: 'consumed',
        attemptsUsed: 1,
        consumedRef: 'g9-task',
        consumedAt: new Date(),
        kioskSessionId: g9Session,
        provider: 'sandbox',
        providerOrderNo: 'g9-old-no',
        expiresAt: new Date(Date.now() + 60_000),
        paidAt: new Date(),
        channelTxnNo: 'g9-old-txn',
      },
    })
    const g9New = await paidOrder(g9Session, 'resume_optimize', 'sbx_txn_g9')
    const g9Res = await call('GET', '/api/v1/resume/records/g9-task/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, g9Session, g9New.id))
    expectStatus(g9Res, 409, 'G9 判不了的旧单要拦住新单')
    assert.equal(g9Res.json.error?.code, 'SERVICE_ORDER_REF_OCCUPIED')
    assert.equal(g9Res.json.error?.existingOrderId, g9Old.id, 'G9 要告诉是哪张旧单占着')
    const g9NewHeld = await loadOrder(g9New.id)
    assert.equal(g9NewHeld.status, 'paid', 'G9 新单仍是已付')
    assert.equal(g9NewHeld.attemptsUsed, 0, 'G9 新单一次都没用')
    expectStatus(await endKiosk(TERM_CHARGE, chargeToken, g9Session), 200, 'G9 人离开')
    const g9NewLeft = await loadOrder(g9New.id)
    assert.equal(g9NewLeft.status, 'refunded', 'G9 会话结束要把没用的新单退掉')
    assert.equal(g9NewLeft.refundReason, '人已离开，这一次还没用')
    assert.equal((await loadOrder(g9Old.id)).status, 'consumed', 'G9 旧单不动')
    pass('G9 任务还被旧单占着时，新单保持已付，人走了再退')

    let nextRefundEvent: RefundNotifyEvent | null = null
    const serviceRefunds = new RefundService(prisma, audit, {
      get(channel: string) {
        if (channel !== 'wechat') return undefined
        return {
          async verifyRefundNotify() {
            if (!nextRefundEvent) return { ok: false as const, code: 'CALLBACK_SIGNATURE_INVALID' }
            return { ok: true as const, event: nextRefundEvent }
          },
        }
      },
    } as unknown as PaymentProviderRegistry, redis as unknown as RedisService)
    async function notifyServiceRefund(event: Omit<RefundNotifyEvent, 'channel' | 'outTradeNo' | 'nonce' | 'timestampMs'>): Promise<void> {
      nextRefundEvent = {
        channel: 'wechat',
        outTradeNo: 'svc-out',
        nonce: randomUUID().replace(/-/g, ''),
        timestampMs: Date.now(),
        ...event,
      }
      const notified = await serviceRefunds.processWechatRefundNotify(Buffer.from('{}'), {})
      assert.equal(notified.ok, true)
    }
    const rfdSession = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    const rfdOk = await paidOrder(rfdSession, 'scan', 'sbx_txn_rfd_ok')
    fx.refundMode = 'processing'
    await executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, rfdOk.id, '人已离开，这一次还没用')
    fx.refundMode = 'ok'
    await notifyServiceRefund({ refundNo: `svc-rfd-${rfdOk.id}`, channelRefundNo: 'wx-rfd-svc-ok', refundAmountCents: 100, status: 'success' })
    assert.equal((await loadOrder(rfdOk.id)).status, 'refunded', '成功通知要记成已退')
    assert.equal(await prisma.auditLog.count({ where: { action: 'service_order.refunded', targetId: rfdOk.id } }), 1)
    await notifyServiceRefund({ refundNo: `svc-rfd-${rfdOk.id}`, channelRefundNo: 'wx-rfd-svc-ok', refundAmountCents: 100, status: 'success' })
    assert.equal((await loadOrder(rfdOk.id)).status, 'refunded')
    assert.equal(await prisma.auditLog.count({ where: { action: 'service_order.refunded', targetId: rfdOk.id } }), 1, '同一条成功通知不能再记一次')
    const rfdFail = await paidOrder(rfdSession, 'scan', 'sbx_txn_rfd_fail')
    fx.refundMode = 'processing'
    await executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, rfdFail.id, '人已离开，这一次还没用')
    fx.refundMode = 'ok'
    await notifyServiceRefund({ refundNo: `svc-rfd-${rfdFail.id}`, channelRefundNo: null, refundAmountCents: null, status: 'failed' })
    const rfdFailOnce = await loadOrder(rfdFail.id)
    await notifyServiceRefund({ refundNo: `svc-rfd-${rfdFail.id}`, channelRefundNo: null, refundAmountCents: null, status: 'failed' })
    const rfdFailTwice = await loadOrder(rfdFail.id)
    assert.equal(rfdFailTwice.refundAttempts, rfdFailOnce.refundAttempts, '同一条失败通知不能记两次')
    assert.equal(rfdFailTwice.refundAttempts, 1)
    assert.notEqual(rfdFailTwice.status, 'refunded')
    const rfdBad = await paidOrder(rfdSession, 'scan', 'sbx_txn_rfd_bad')
    fx.refundMode = 'processing'
    await executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, rfdBad.id, '人已离开，这一次还没用')
    fx.refundMode = 'ok'
    await notifyServiceRefund({ refundNo: `svc-rfd-${rfdBad.id}`, channelRefundNo: 'wx-rfd-svc-bad', refundAmountCents: 1, status: 'success' })
    const rfdBadRow = await loadOrder(rfdBad.id)
    assert.notEqual(rfdBadRow.status, 'refunded', '金额不符不能记成已退')
    assert.ok(rfdBadRow.refundAnomaly, '金额不符要记下来')
    pass('服务单退款通知经退款服务分派：成功、失败、重复、金额不符')

    try {
      const g5 = await pendingChargeOrder()
      closeQr.closeExpiredQrPayment = async (input) => {
        if (input.orderId === g5.row.id) throw new Error('channel close down')
        return { status: 'closed', channelTxnNo: null, amountCents: null }
      }
      await saveTerminalChargeSettings(prisma, TERM_CHARGE, {
        userChargeMode: 'user_pays',
        prices: { ...DEMO_PRICES, resume_optimize: 180 },
      }, ADMIN)
      const g5Closed = await loadOrder(g5.row.id)
      assert.equal(g5Closed.status, 'closed', '关单失败也要先把这一单关掉')
      assert.equal(g5Closed.closeReason, 'price_changed')
      assert.equal(g5Closed.channelClosePending, true, '渠道没关上，要留下重试')
      const g5Price = await prisma.terminalServicePrice.findUnique({
        where: { terminalId_serviceKey: { terminalId: TERM_CHARGE, serviceKey: 'resume_optimize' } },
      })
      assert.equal(g5Price?.unitCents, 180, '关单失败不能把改价滚回去')
      assert.equal(await prisma.auditLog.count({
        where: { action: 'service_order.channel_close_failed', targetId: g5.row.id },
      }), 1, '关单失败要记一笔')
      closeQr.closeExpiredQrPayment = async (input) => {
        if (input.orderId === g5.row.id) {
          return { status: 'paid', channelTxnNo: 'sbx_txn_g5', amountCents: g5.row.amountCents }
        }
        return { status: 'closed', channelTxnNo: null, amountCents: null }
      }
      const g5Refunds = fx.refundCalls
      await serviceOrders.sweep()
      const g5Paid = await loadOrder(g5.row.id)
      assert.equal(g5Paid.status, 'refunded', '清扫重试发现已付必须退')
      assert.equal(g5Paid.refundReason, '付款时这一单已经关闭')
      assert.equal(fx.refundCalls, g5Refunds + 1, '这一张只退一次')
      await serviceOrders.sweep()
      assert.equal(fx.refundCalls, g5Refunds + 1, '下一拍不能再退')
      assert.equal((await loadOrder(g5.row.id)).status, 'refunded')
      pass('改价时渠道关单失败，清扫重试发现已付就退一次')

      await setTerminalUserPrintPrices(prisma, TERM_CHARGE, DEMO_PRICES)
      const g5Bind = await pendingChargeOrder()
      closeQr.closeExpiredQrPayment = async (input) => {
        if (input.orderId === g5Bind.row.id) {
          return { status: 'paid', channelTxnNo: 'sbx_txn_g5_bind', amountCents: g5Bind.row.amountCents }
        }
        return { status: 'closed', channelTxnNo: null, amountCents: null }
      }
      await assignTerminalOrganization(prisma, TERM_CHARGE, ORG_SCHOOL, new Date(), async () => undefined)
      const g5BindAfter = await loadOrder(g5Bind.row.id)
      assert.equal(g5BindAfter.status, 'refunded', '改绑时渠道说已付必须退')
      assert.equal(g5BindAfter.refundReason, '这台机器已改为免费')
      assert.equal(await prisma.auditLog.count({
        where: { action: 'service_order.refunded', targetId: g5Bind.row.id },
      }), 1, '改绑这一张只退一次')
      assert.equal((await prisma.terminal.findUnique({ where: { id: TERM_CHARGE } }))?.orgId, ORG_SCHOOL, '退款不能把改绑滚回去')
      await setTerminalUserPrintPrices(prisma, TERM_CHARGE, DEMO_PRICES)
      const g5Retry = await pendingChargeOrder()
      closeQr.closeExpiredQrPayment = async (input) => {
        if (input.orderId === g5Retry.row.id) throw new Error('channel close down')
        return { status: 'closed', channelTxnNo: null, amountCents: null }
      }
      await assignTerminalOrganization(prisma, TERM_CHARGE, null, new Date(), async () => undefined)
      const g5RetryClosed = await loadOrder(g5Retry.row.id)
      assert.equal(g5RetryClosed.status, 'closed')
      assert.equal(g5RetryClosed.closeReason, 'org_rebound')
      assert.equal(g5RetryClosed.channelClosePending, true)
      closeQr.closeExpiredQrPayment = async () => ({ status: 'closed', channelTxnNo: null, amountCents: null })
      const g5RetryRefunds = fx.refundCalls
      await serviceOrders.sweep()
      const g5RetryAfter = await loadOrder(g5Retry.row.id)
      assert.equal(g5RetryAfter.status, 'closed', '渠道确认没付就保持关闭')
      assert.equal(g5RetryAfter.channelClosePending, false, '重试关上之后不再挂着')
      assert.equal(g5RetryAfter.refundedAt, null)
      assert.equal(fx.refundCalls, g5RetryRefunds, '没付不能退')
      assert.equal((await prisma.terminal.findUnique({ where: { id: TERM_CHARGE } }))?.orgId, null)
      pass('改绑时渠道说已付要退；关不上就清扫重试')
    } finally {
      closeQr.closeExpiredQrPayment = originalCloseQr
      await assignTerminalOrganization(prisma, TERM_CHARGE, null, new Date(), async () => undefined).catch(() => undefined)
      await setTerminalUserPrintPrices(prisma, TERM_CHARGE, DEMO_PRICES).catch(() => undefined)
    }

    await prisma.$transaction((tx) => tx.$executeRaw`DROP INDEX IF EXISTS "ServiceOrder_open_consumed_ref_key"`)
    try {
      const reviewSession = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
      const reviewWhen = new Date('2019-06-01T00:00:00.000Z')
      await prisma.scanTask.create({
        data: {
          id: 'p2a4-scan-ref',
          terminalId: TERM_CHARGE,
          scanType: 'resume',
          status: 'completed',
          fileId: 'file-p2a4-scan',
          expiresAt: new Date(Date.now() + 3600_000),
        },
      })
      const scanReviewBase = {
        terminalId: TERM_CHARGE,
        serviceKey: 'scan',
        amountCents: 100,
        status: 'consumed',
        attemptsUsed: 1,
        consumedRef: 'p2a4-scan-ref',
        consumedAt: reviewWhen,
        kioskSessionId: reviewSession,
        provider: 'sandbox',
        expiresAt: new Date(Date.now() + 60_000),
        paidAt: reviewWhen,
      }
      await prisma.serviceOrder.create({
        data: { ...scanReviewBase, id: 'p2a4-scan-a', providerOrderNo: 'p2a4-scan-a-no', channelTxnNo: 'p2a4-scan-a-txn' },
      })
      await prisma.serviceOrder.create({
        data: { ...scanReviewBase, id: 'p2a4-scan-b', providerOrderNo: 'p2a4-scan-b-no', channelTxnNo: 'p2a4-scan-b-txn' },
      })
      await serviceOrders.sweep(new Date())
      const scanA = await loadOrder('p2a4-scan-a')
      const scanB = await loadOrder('p2a4-scan-b')
      assert.equal(scanA.status, 'refunded', '扫描复核先看到的那张要退')
      assert.equal(scanA.refundReason, '这一趟已经算在另一张单上')
      assert.equal(scanB.status, 'consumed', '扫描复核留下做成的那张')
      assert.ok(scanB.settledAt, '留下的扫描要结案')
      pass('扫描复核看到同一任务两张单时只留一笔')

      await prisma.mockInterviewSession.create({
        data: {
          id: 'p2a4-iv-ref',
          status: 'in_progress',
          interviewerType: 'hr',
          industry: '仓储',
          position: '管理员',
          experience: 'y1_3',
          difficulty: 'standard',
          expiresAt: new Date(Date.now() + 3600_000),
        },
      })
      await prisma.mockInterviewTurn.create({
        data: { sessionId: 'p2a4-iv-ref', idx: 0, role: 'interviewer', content: '请先做个自我介绍' },
      })
      const interviewReviewBase = {
        terminalId: TERM_CHARGE,
        serviceKey: 'mock_interview',
        amountCents: 200,
        status: 'consumed',
        attemptsUsed: 1,
        consumedRef: 'p2a4-iv-ref',
        consumedAt: reviewWhen,
        kioskSessionId: reviewSession,
        provider: 'sandbox',
        expiresAt: new Date(Date.now() + 60_000),
        paidAt: reviewWhen,
      }
      await prisma.serviceOrder.create({
        data: { ...interviewReviewBase, id: 'p2a4-iv-a', providerOrderNo: 'p2a4-iv-a-no', channelTxnNo: 'p2a4-iv-a-txn' },
      })
      await prisma.serviceOrder.create({
        data: { ...interviewReviewBase, id: 'p2a4-iv-b', providerOrderNo: 'p2a4-iv-b-no', channelTxnNo: 'p2a4-iv-b-txn' },
      })
      await serviceOrders.sweep(new Date())
      const ivA = await loadOrder('p2a4-iv-a')
      const ivB = await loadOrder('p2a4-iv-b')
      assert.equal(ivA.status, 'refunded', '面试复核先看到的那张要退')
      assert.equal(ivA.refundReason, '这一趟已经算在另一张单上')
      assert.equal(ivB.status, 'consumed', '面试复核留下开过的那张')
      assert.ok(ivB.settledAt, '留下的面试要结案')
      pass('模拟面试复核看到同一场两张单时只留一笔')
    } finally {
      applyOpenRefIndex(databasePath)
    }

    const sweepSession = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    const sweepOldest = new Date('2020-01-01T00:00:00.000Z')
    await prisma.scanTask.create({
      data: {
        id: 'p2a4-sweep-old',
        terminalId: TERM_CHARGE,
        scanType: 'resume',
        status: 'failed',
        expiresAt: new Date(Date.now() - 1000),
      },
    })
    await prisma.serviceOrder.create({
      data: {
        id: 'p2a4-sweep-old',
        terminalId: TERM_CHARGE,
        serviceKey: 'scan',
        amountCents: 100,
        status: 'consumed',
        attemptsUsed: 2,
        consumedRef: 'p2a4-sweep-old',
        consumedAt: sweepOldest,
        kioskSessionId: sweepSession,
        provider: 'sandbox',
        providerOrderNo: 'p2a4-sweep-old-no',
        expiresAt: new Date(Date.now() + 60_000),
        paidAt: sweepOldest,
        channelTxnNo: 'p2a4-sweep-old-txn',
      },
    })
    for (let i = 0; i < SERVICE_SWEEP_BATCH; i += 1) {
      const taskId = `p2a4-sweep-live-${i}`
      await prisma.scanTask.create({
        data: {
          id: taskId,
          terminalId: TERM_CHARGE,
          scanType: 'resume',
          status: 'waiting',
          expiresAt: new Date(Date.now() + 3600_000),
        },
      })
      await prisma.serviceOrder.create({
        data: {
          id: taskId,
          terminalId: TERM_CHARGE,
          serviceKey: 'scan',
          amountCents: 100,
          status: 'consumed',
          attemptsUsed: 1,
          consumedRef: taskId,
          consumedAt: new Date(sweepOldest.getTime() + (i + 1) * 1000),
          kioskSessionId: sweepSession,
          provider: 'sandbox',
          providerOrderNo: `${taskId}-no`,
          expiresAt: new Date(Date.now() + 60_000),
          paidAt: sweepOldest,
          channelTxnNo: `${taskId}-txn`,
        },
      })
    }
    await serviceOrders.sweep(new Date())
    const sweepVictim = await loadOrder('p2a4-sweep-old')
    const sweepNewest = await loadOrder(`p2a4-sweep-live-${SERVICE_SWEEP_BATCH - 1}`)
    assert.equal(sweepVictim.status, 'refunded', '最早那张没出文件的扫描这一拍就要退')
    assert.equal(sweepNewest.status, 'consumed', '还活着的新扫描不能被这一拍退掉')
    assert.equal(sweepNewest.settledAt, null, '还活着的新扫描不能被这一拍结案')
    pass('扫描清扫先看占用更早的，活着的新扫描留到后面')
  })
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
