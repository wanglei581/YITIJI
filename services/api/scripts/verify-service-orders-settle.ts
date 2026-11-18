/**
 * verify:service-orders 的后半：清场、退款、扫描重放和后台退款。
 * 由 verify-service-orders.ts 调用，不是单独的门禁。
 */
// 与父门禁 verify-service-orders.ts 同值。托管声明门禁逐个文件查，拆出来的文件也要写一遍。
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { RedisService } from '../src/common/redis/redis.service'
import { executeServiceOrderRefund } from '../src/payment/service-order.payment'
import { isServiceOrderOpenRefConflict } from '../src/payment/service-order.ref'
import { PERSONAL_CHARGE_SETTING_KEY } from '../src/payment/terminal-charge.contract'
import type { CreateScanTaskDto } from '../src/scan-tasks/dto/create-scan-task.dto'
import { ScanTasksService } from '../src/scan-tasks/scan-tasks.service'
import { setTerminalUserPrintPrices } from './support/terminal-charge-fixture'
import {
  ADMIN,
  DEMO_PRICES,
  pass,
  TERM_CHARGE,
  TERM_PUBLIC,
  type ServiceOrderFixture,
} from './support/service-order-verify-fixture'

export async function verifyServiceOrderSettleCases(fx: ServiceOrderFixture, consumedOrderId: string): Promise<void> {
  const {
    adminToken,
    ai,
    audit,
    call,
    callback,
    chargeSession,
    chargeToken,
    endKiosk,
    expectStatus,
    interview,
    loadOrder,
    openKiosk,
    paidOrder,
    prisma,
    publicToken,
    redis,
    registry,
    sandbox,
    serviceOrders,
    termHeaders,
  } = fx
  const adminHeaders = { authorization: `Bearer ${adminToken}` }
  const idleSession = await openKiosk(TERM_CHARGE, chargeToken)
  const idleRow = await paidOrder(idleSession, 'resume_optimize', 'sbx_txn_c1_idle')
  await prisma.kioskSession.update({
    where: { terminalId_clientSessionId: { terminalId: TERM_CHARGE, clientSessionId: idleSession } },
    data: { expiresAt: new Date(Date.now() - 1000) },
  })
  await serviceOrders.sweep()
  const idleRefunded = await loadOrder(idleRow.id)
  assert.equal(idleRefunded.status, 'refunded')
  assert.equal(idleRefunded.refundReason, '人已离开，这一次还没用')
  const replaySession = await openKiosk(TERM_CHARGE, chargeToken)
  const replayPaid = await paidOrder(replaySession, 'scan', 'sbx_txn_c1_replay')
  await prisma.kioskSession.update({
    where: { terminalId_clientSessionId: { terminalId: TERM_CHARGE, clientSessionId: replaySession } },
    data: { endedAt: new Date() },
  })
  expectStatus(await endKiosk(TERM_CHARGE, chargeToken, replaySession), 200, '清场钩子失败后重发')
  assert.equal((await loadOrder(replayPaid.id)).status, 'refunded')
  assert.equal((await loadOrder(replayPaid.id)).refundReason, '人已离开，这一次还没用')
  pass('C-1 会话过期和清场重发都会退掉付了没用的单')

  const c2ResumeSession = await openKiosk(TERM_CHARGE, chargeToken)
  const c2Resume = await paidOrder(c2ResumeSession, 'resume_optimize', 'sbx_txn_c2_resume')
  await prisma.serviceOrder.update({
    where: { id: c2Resume.id },
    data: { status: 'consumed', attemptsUsed: 1, consumedAt: new Date(Date.now() - 8 * 60_000), consumedRef: 'c2-no-result', settledAt: null },
  })
  await prisma.kioskSession.update({
    where: { terminalId_clientSessionId: { terminalId: TERM_CHARGE, clientSessionId: c2ResumeSession } },
    data: { endedAt: new Date() },
  })
  await serviceOrders.sweep()
  assert.equal((await loadOrder(c2Resume.id)).status, 'refunded', 'C-2 简历中断且人已离开要退')
  const c2InterviewSession = await openKiosk(TERM_CHARGE, chargeToken, 'interview')
  const c2Interview = await paidOrder(c2InterviewSession, 'mock_interview', 'sbx_txn_c2_interview')
  await prisma.serviceOrder.update({
    where: { id: c2Interview.id },
    data: { status: 'consumed', attemptsUsed: 1, consumedAt: new Date(Date.now() - 8 * 60_000), consumedRef: 'c2-iv-open', settledAt: null },
  })
  await serviceOrders.sweep()
  const c2InterviewAfter = await loadOrder(c2Interview.id)
  assert.equal(c2InterviewAfter.status, 'paid', 'C-2 面试没开起来、人还在，回到可再试')
  assert.notEqual(c2InterviewAfter.status, 'consumed')
  const c2MadeSession = await openKiosk(TERM_CHARGE, chargeToken)
  const c2Made = await paidOrder(c2MadeSession, 'resume_optimize', 'sbx_txn_c2_made')
  await prisma.aiResumeResult.create({
    data: { taskId: 'c2-opt-made', kind: 'optimize', status: 'completed', provider: 'rules' },
  })
  await prisma.serviceOrder.update({
    where: { id: c2Made.id },
    data: { status: 'consumed', attemptsUsed: 1, consumedAt: new Date(Date.now() - 8 * 60_000), consumedRef: 'c2-opt-made', settledAt: null },
  })
  await serviceOrders.sweep()
  const c2MadeAfter = await loadOrder(c2Made.id)
  assert.equal(c2MadeAfter.status, 'consumed')
  assert.ok(c2MadeAfter.settledAt, '有优化稿要记成做成')
  await prisma.mockInterviewSession.create({
    data: {
      id: 'c2-stuck',
      status: 'in_progress',
      interviewerType: 'hr',
      industry: '仓储',
      position: '管理员',
      experience: 'y1_3',
      difficulty: 'standard',
      startedAt: new Date(Date.now() - 8 * 60_000),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  await serviceOrders.sweep()
  const stuck = await prisma.mockInterviewSession.findUnique({ where: { id: 'c2-stuck' } })
  assert.equal(stuck?.status, 'configured')
  assert.equal(stuck?.startedAt, null)
  fx.interviewMode = 'already'
  const alreadySession = await openKiosk(TERM_CHARGE, chargeToken, 'interview')
  const alreadyRow = await paidOrder(alreadySession, 'mock_interview', 'sbx_txn_c2_already')
  expectStatus(await call('POST', '/api/v1/mock-interviews/c2-already/start', {}, termHeaders(TERM_CHARGE, chargeToken, alreadySession, alreadyRow.id)), 400, '面试号称已开始但没有首题')
  const alreadyAfter = await loadOrder(alreadyRow.id)
  assert.equal(alreadyAfter.status, 'paid')
  assert.equal(alreadyAfter.attemptsUsed, 1)
  fx.interviewMode = 'ok'
  pass('C-2 简历和面试中断后能判定，没有首题不算做成')

  const c3Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
  const c3Base = Date.now() - 180_000
  const c3Made: string[] = []
  for (let i = 0; i < 35; i += 1) {
    const taskId = `c3-made-${i}`
    await prisma.scanTask.create({
      data: { id: taskId, terminalId: TERM_CHARGE, scanType: 'document', status: 'completed', fileId: `c3-file-${i}`, expiresAt: new Date(Date.now() + 3600_000) },
    })
    const id = randomUUID()
    await prisma.serviceOrder.create({
      data: {
        id,
        terminalId: TERM_CHARGE,
        serviceKey: 'scan',
        amountCents: 100,
        status: 'consumed',
        attemptsUsed: 1,
        kioskSessionId: c3Session,
        provider: 'sandbox',
        providerOrderNo: `c3-made-${id}`,
        consumedAt: new Date(c3Base + i * 1000),
        consumedRef: taskId,
        expiresAt: new Date(Date.now() + 60_000),
        paidAt: new Date(),
        channelTxnNo: `c3-txn-${id}`,
      },
    })
    c3Made.push(id)
  }
  const c3Victim = randomUUID()
  await prisma.serviceOrder.create({
    data: {
      id: c3Victim,
      terminalId: TERM_CHARGE,
      serviceKey: 'scan',
      amountCents: 100,
      status: 'consumed',
      attemptsUsed: 2,
      kioskSessionId: c3Session,
      provider: 'sandbox',
      providerOrderNo: `c3-victim-${c3Victim}`,
      consumedAt: new Date(c3Base + 35 * 1000),
      consumedRef: 'c3-missing-task',
      expiresAt: new Date(Date.now() + 60_000),
      paidAt: new Date(),
      channelTxnNo: `c3-txn-${c3Victim}`,
    },
  })
  await serviceOrders.sweep()
  await serviceOrders.sweep()
  assert.equal((await loadOrder(c3Victim)).status, 'refunded', 'C-3 排在做成的后面，两拍内也要退')
  const c3Settled = await prisma.serviceOrder.count({ where: { id: { in: c3Made }, settledAt: { not: null } } })
  assert.equal(c3Settled, c3Made.length, '做成的都结案')
  pass('C-3 做成的扫描让出名额，没出文件的能退')

  const realScans = new ScanTasksService(prisma, {} as never, {} as never)
  const plainPreview = await realScans.previewCreate(
    { terminalId: TERM_CHARGE, scanType: 'resume' } as CreateScanTaskDto,
    null,
  )
  assert.equal(plainPreview.scanTaskId, '', '普通建会话的预判是空任务号')
  await prisma.scanTask.create({
    data: { id: 'preview-live', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
  })
  const duringPreview = await realScans.previewCreate(
    { terminalId: TERM_CHARGE, scanType: 'resume' } as CreateScanTaskDto,
    null,
  )
  assert.equal(duringPreview.scanTaskId, '', '扫描进行中，普通建会话的预判仍是空任务号')
  pass('真服务预判：普通建会话不返回正在进行的任务号')

  const n1Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
  await prisma.scanTask.create({
    data: { id: 'b2-child', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
  })
  fx.scanReturnId = 'b2-child'
  const n1 = await paidOrder(n1Session, 'scan', 'sbx_txn_n1')
  expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, n1Session, n1.id)), 201, 'N1 第一次扫描')
  assert.equal((await loadOrder(n1.id)).attemptsUsed, 1)
  assert.equal((await loadOrder(n1.id)).consumedRef, 'b2-child')
  const n1Replay = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, n1Session, n1.id))
  expectStatus(n1Replay, 409, 'N1 重放')
  assert.equal(n1Replay.json.error?.code, 'SERVICE_ORDER_IN_USE')
  assert.equal((await loadOrder(n1.id)).attemptsUsed, 1, '重放不能再占一次')
  const n2Pay = await paidOrder(n1Session, 'scan', 'sbx_txn_n1_o2')
  expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, n1Session, n2Pay.id)), 201, 'N1 第二张单重扫')
  assert.equal((await loadOrder(n2Pay.id)).status, 'paid', '挂不上同一任务的新单要退回已付')
  const lineage = await prisma.serviceOrder.count({ where: { consumedRef: 'b2-child', status: { not: 'closed' } } })
  assert.equal(lineage, 1, '同一扫描任务只能挂一张单')
  pass('N1 重放只收一笔')

  await prisma.scanTask.create({
    data: { id: 'n4-dead', terminalId: TERM_CHARGE, scanType: 'resume', status: 'failed', expiresAt: new Date(Date.now() + 3600_000) },
  })
  await prisma.scanTask.create({
    data: { id: 'n4-new', terminalId: TERM_CHARGE, scanType: 'resume', status: 'completed', expiresAt: new Date(Date.now() + 3600_000) },
  })
  const n4Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
  const n4Row = await paidOrder(n4Session, 'scan', 'sbx_txn_n4')
  await prisma.serviceOrder.update({
    where: { id: n4Row.id },
    data: { status: 'consumed', attemptsUsed: 1, consumedAt: new Date(), consumedRef: 'n4-dead' },
  })
  fx.scanReturnId = 'n4-new'
  const n4Retry = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, n4Session, n4Row.id))
  expectStatus(n4Retry, 201, 'N4 失败后马上重扫')
  const n4After = await loadOrder(n4Row.id)
  assert.equal(n4After.status, 'consumed')
  assert.equal(n4After.consumedRef, 'n4-new')
  assert.notEqual(n4Retry.status, 402)
  pass('N4 扫描没出文件后马上重扫不用再付')

  const n2Session = await openKiosk(TERM_CHARGE, chargeToken)
  const n2Created = await call('POST', '/api/v1/kiosk/service-orders', {
    serviceKey: 'scan', kioskSessionId: n2Session,
  }, termHeaders(TERM_CHARGE, chargeToken))
  const n2Id = String(n2Created.json.data?.['id'])
  const n2Row = await loadOrder(n2Id)
  const findUnique = prisma.serviceOrder.findUnique.bind(prisma.serviceOrder)
  let n2Armed = true
  prisma.serviceOrder.findUnique = (async (args: unknown) => {
    const row = await findUnique(args as never)
    if (n2Armed && row?.id === n2Id && row.status === 'pending') {
      n2Armed = false
      await prisma.serviceOrder.update({
        where: { id: n2Id },
        data: { status: 'closed', channelTxnNo: null, closeReason: 'user_cancelled' },
      })
      return row
    }
    return row
  }) as typeof prisma.serviceOrder.findUnique
  try {
    const n2Notice = await callback(n2Row, 'success', 'sbx_txn_n2_race')
    expectStatus(n2Notice, 200, 'N2 关掉之后通知才到')
  } finally {
    prisma.serviceOrder.findUnique = findUnique
  }
  const n2After = await loadOrder(n2Id)
  assert.notEqual(n2After.status, 'closed', '关掉后付到的钱不能停在已关闭')
  assert.equal(n2After.status, 'refunded')
  assert.ok(n2After.channelTxnNo)
  assert.equal(n2After.refundReason, '付款时这一单已经关闭')
  pass('N2 付款通知和关单抢在一起时按原路退')

  const switchBefore = await prisma.platformSetting.findUnique({ where: { key: PERSONAL_CHARGE_SETTING_KEY } })
  await prisma.platformSetting.update({ where: { key: PERSONAL_CHARGE_SETTING_KEY }, data: { value: 'false' } })
  const switchSession = await openKiosk(TERM_CHARGE, chargeToken)
  const beforeSwitch = await prisma.serviceOrder.count()
  const switchCreate = await call('POST', '/api/v1/kiosk/service-orders', {
    serviceKey: 'resume_optimize', kioskSessionId: switchSession,
  }, termHeaders(TERM_CHARGE, chargeToken))
  expectStatus(switchCreate, 409, '总开关关着不能建单')
  assert.equal(switchCreate.json.error?.code, 'SERVICE_FREE_ON_THIS_TERMINAL')
  const switchStart = await call('GET', '/api/v1/resume/records/switch-off/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, switchSession))
  expectStatus(switchStart, 200, '总开关关着开始不拦')
  assert.equal(await prisma.serviceOrder.count(), beforeSwitch, '总开关关着不落新单')
  await prisma.platformSetting.update({ where: { key: PERSONAL_CHARGE_SETTING_KEY }, data: { value: switchBefore?.value ?? 'true' } })
  pass('总开关关时建单 409，开始不拦，不落单')

  const procSession = await openKiosk(TERM_CHARGE, chargeToken)
  const procRow = await paidOrder(procSession, 'scan', 'sbx_txn_processing')
  fx.refundMode = 'processing'
  fx.queryMode = 'processing'
  const procQueriesBefore = fx.queryRefundCalls
  await executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, procRow.id, '人已离开，这一次还没用')
  const processing = await loadOrder(procRow.id)
  assert.equal(processing.status, 'refunding')
  assert.equal(processing.refundAttempts, 0, '受理中不计失败次数')
  assert.equal(processing.refundChannelState, 'processing')
  assert.equal(processing.refundProcessingTries, 1)
  assert.ok(processing.nextRefundAt && processing.nextRefundAt.getTime() > Date.now() + 90_000)
  assert.equal(fx.queryRefundCalls, procQueriesBefore, '第一次受理中还不查单')
  fx.queryMode = 'success'
  await prisma.serviceOrder.update({ where: { id: procRow.id }, data: { nextRefundAt: new Date(Date.now() - 1000) } })
  await serviceOrders.sweep()
  const procDone = await loadOrder(procRow.id)
  assert.equal(procDone.status, 'refunded')
  assert.equal(await prisma.auditLog.count({ where: { action: 'service_order.refunded', targetId: procRow.id } }), 1)
  assert.ok(fx.queryRefundCalls > procQueriesBefore, '下一拍要先查单')
  fx.refundMode = 'ok'
  pass('退款受理中先查单，查到成功才记已退')

  const abnormalSession = await openKiosk(TERM_CHARGE, chargeToken)
  const abnormalRow = await paidOrder(abnormalSession, 'mock_interview', 'sbx_txn_abnormal')
  await prisma.serviceOrder.update({
    where: { id: abnormalRow.id },
    data: {
      status: 'refunding',
      refundAttempts: 7,
      refundChannelState: 'processing',
      refundNo: `svc-rfd-${abnormalRow.id}`,
      refundReason: '人已离开，这一次还没用',
      nextRefundAt: new Date(Date.now() - 1000),
      refundLeaseUntil: null,
    },
  })
  fx.queryMode = 'failed'
  await serviceOrders.sweep()
  const abnormalAfter = await loadOrder(abnormalRow.id)
  assert.equal(abnormalAfter.status, 'refund_failed')
  assert.equal(abnormalAfter.refundAttempts, 8)
  fx.queryMode = 'processing'
  pass('ABNORMAL 到最大次数停在退款失败')

  const dualSession = await openKiosk(TERM_CHARGE, chargeToken)
  const dualRow = await paidOrder(dualSession, 'resume_optimize', 'sbx_txn_d2')
  await Promise.all([
    executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, dualRow.id, '并发退款'),
    executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, dualRow.id, '并发退款'),
  ])
  assert.equal((await loadOrder(dualRow.id)).status, 'refunded')
  assert.equal(await prisma.auditLog.count({ where: { action: 'service_order.refunded', targetId: dualRow.id } }), 1, '并发退款只记一条已退')
  // 已付认领靠状态本身互斥。租约要挡的是两路同时看到「退款中」后再打渠道。
  const leaseSession = await openKiosk(TERM_CHARGE, chargeToken)
  const leaseRow = await paidOrder(leaseSession, 'scan', 'sbx_txn_d2_lease')
  await prisma.serviceOrder.update({
    where: { id: leaseRow.id },
    data: {
      status: 'refunding',
      refundNo: `svc-rfd-${leaseRow.id}`,
      refundReason: '并发退款',
      nextRefundAt: new Date(Date.now() - 1000),
      refundLeaseUntil: null,
      refundAttempts: 0,
      refundChannelState: null,
    },
  })
  const leaseCalls = fx.refundCalls
  // 手动重试不看 nextRefundAt，只有租约能挡住第二路再打渠道。
  await Promise.all([
    executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, leaseRow.id, '并发退款', { manual: true }),
    executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, leaseRow.id, '并发退款', { manual: true }),
  ])
  assert.equal(fx.refundCalls, leaseCalls + 1, '并发退款只打一次渠道')
  assert.equal(await prisma.auditLog.count({ where: { action: 'service_order.refunded', targetId: leaseRow.id } }), 1, '退款中并发也只记一条已退')
  pass('D-2 自动退款并发只写一条审计')

  const nowFreeSession = await openKiosk(TERM_CHARGE, chargeToken)
  const nowFreeRow = await paidOrder(nowFreeSession, 'resume_optimize', 'sbx_txn_now_free')
  await setTerminalUserPrintPrices(prisma, TERM_CHARGE, { resume_optimize: 0 })
  const nowFreeRun = await call('GET', '/api/v1/resume/records/now-free/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, nowFreeSession, nowFreeRow.id))
  expectStatus(nowFreeRun, 200, 'A-1 改成免费后放行')
  const nowFreeAfter = await loadOrder(nowFreeRow.id)
  assert.equal(nowFreeAfter.status, 'refunded')
  assert.equal(nowFreeAfter.refundReason, '这台机器已改为免费')
  await setTerminalUserPrintPrices(prisma, TERM_CHARGE, DEMO_PRICES)
  pass('A-1 机器改成免费后当场原路退，然后按免费放行')

  const forged = await call('GET', '/api/v1/resume/records/e2-forged/optimize', undefined, { 'x-terminal-id': TERM_PUBLIC })
  expectStatus(forged, 401, 'E-2 冒充公共点位')
  assert.equal(forged.json.error?.code, 'TERMINAL_SESSION_INVALID')
  const publicStill = await call('POST', '/api/v1/mock-interviews/iv-public-still/start', {}, termHeaders(TERM_PUBLIC, publicToken))
  expectStatus(publicStill, 201, '带着令牌的公共点位仍不收费')
  pass('E-2 带了终端头但不带令牌不能按免费放行')

  await setTerminalUserPrintPrices(prisma, TERM_CHARGE, { resume_optimize: 100_001 })
  const invalidPrice = await call('POST', '/api/v1/kiosk/service-orders', {
    serviceKey: 'resume_optimize', kioskSessionId: chargeSession,
  }, termHeaders(TERM_CHARGE, chargeToken))
  expectStatus(invalidPrice, 400, '价目不合法')
  assert.equal(invalidPrice.json.error?.code, 'PRICE_CONFIG_INVALID')
  await setTerminalUserPrintPrices(prisma, TERM_CHARGE, DEMO_PRICES)
  pass('建单价目不合法时拒绝，不按 0 放行')

  const adminRefundSession = await openKiosk(TERM_CHARGE, chargeToken)
  const adminRefundRow = await paidOrder(adminRefundSession, 'scan', 'sbx_txn_admin_refund')
  const missingConfirm = await call('POST', `/api/v1/admin/orders/${adminRefundRow.id}/refund-service`, {}, adminHeaders)
  expectStatus(missingConfirm, 400, '没确认不能退')
  const confirmed = await call('POST', `/api/v1/admin/orders/${adminRefundRow.id}/refund-service`, { confirm: true }, adminHeaders)
  expectStatus(confirmed, 200, '后台原路退款')
  assert.equal((await loadOrder(adminRefundRow.id)).status, 'refunded')
  assert.equal(await prisma.auditLog.count({ where: { action: 'service_order.admin_refund', targetId: adminRefundRow.id, actorId: ADMIN } }), 1)
  const settled = await call('POST', `/api/v1/admin/orders/${consumedOrderId}/refund-service`, { confirm: true }, adminHeaders)
  expectStatus(settled, 409, '做成的单不能从后台退')
  pass('后台对卡住的已付单可以原路退，做成的不行')

  const uniqRef = `open-ref-${randomUUID()}`
  const uniqSession = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
  const uniqFirst = randomUUID()
  const uniqSecond = randomUUID()
  await prisma.serviceOrder.create({
    data: {
      id: uniqFirst,
      terminalId: TERM_CHARGE,
      serviceKey: 'scan',
      amountCents: 100,
      status: 'consumed',
      attemptsUsed: 1,
      kioskSessionId: uniqSession,
      provider: 'sandbox',
      providerOrderNo: `uniq-a-${uniqFirst}`,
      consumedRef: uniqRef,
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      paidAt: new Date(),
      channelTxnNo: `uniq-txn-a-${uniqFirst}`,
    },
  })
  await prisma.serviceOrder.create({
    data: {
      id: uniqSecond,
      terminalId: TERM_CHARGE,
      serviceKey: 'scan',
      amountCents: 100,
      status: 'consumed',
      attemptsUsed: 1,
      kioskSessionId: uniqSession,
      provider: 'sandbox',
      providerOrderNo: `uniq-b-${uniqSecond}`,
      consumedRef: `other-${uniqSecond}`,
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      paidAt: new Date(),
      channelTxnNo: `uniq-txn-b-${uniqSecond}`,
    },
  })
  let uniqRejected = false
  try {
    await prisma.$transaction((tx) => tx.$executeRaw`UPDATE "ServiceOrder" SET "consumedRef" = ${uniqRef} WHERE "id" = ${uniqSecond}`)
  } catch (error) {
    uniqRejected = isServiceOrderOpenRefConflict(error)
    if (!uniqRejected) throw error
  }
  assert.equal(uniqRejected, true, '同一没结案任务的第二张单必须被唯一索引拒绝')
  assert.equal(await prisma.serviceOrder.count({
    where: { consumedRef: uniqRef, status: { in: ['pending', 'paid', 'consumed'] } },
  }), 1, '唯一索引拒绝后只剩一张')
  pass('a 同一任务的第二张没结案单写不进去')
}
