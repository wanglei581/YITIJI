/**
 * verify:service-orders 的前半：建单、付款、简历改写、面试和扫描占用。
 * 由 verify-service-orders.ts 调用，不是单独的门禁。
 */
// 与父门禁 verify-service-orders.ts 同值。托管声明门禁逐个文件查，拆出来的文件也要写一遍。
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { RedisInflightLock } from '../src/ai/redis-inflight-lock'
import { AiService } from '../src/ai/ai.service'
import {
  ADMIN,
  pass,
  TERM_CHARGE,
  TERM_FREE,
  TERM_ORG,
  TERM_PUBLIC,
  type ServiceOrderFixture,
} from './support/service-order-verify-fixture'

export async function verifyServiceOrderChargeCases(fx: ServiceOrderFixture): Promise<string> {
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
    freeSession,
    freeToken,
    interview,
    loadOrder,
    memberToken,
    openKiosk,
    orgSession,
    orgToken,
    packCallback,
    paidOrder,
    postCallback,
    prisma,
    publicSession,
    publicToken,
    redis,
    registry,
    sandbox,
    serviceOrders,
    termHeaders,
  } = fx
  for (const [terminalId, token, kioskSessionId, label] of [
    [TERM_PUBLIC, publicToken, publicSession, '公共点位'],
    [TERM_ORG, orgToken, orgSession, '机构承担'],
    [TERM_FREE, freeToken, freeSession, '生效价 0'],
  ] as const) {
    const before = await prisma.serviceOrder.count({ where: { terminalId } })
    const denied = await call('POST', '/api/v1/kiosk/service-orders', {
      serviceKey: 'resume_optimize',
      kioskSessionId,
    }, termHeaders(terminalId, token))
    expectStatus(denied, 409, label)
    assert.equal(denied.json.error?.code, 'SERVICE_FREE_ON_THIS_TERMINAL')
    const after = await prisma.serviceOrder.count({ where: { terminalId } })
    assert.equal(after, before, `${label} 不能建单`)
  }
  pass('公共点位、机构承担、生效价 0 都不建单')

  const created = await call('POST', '/api/v1/kiosk/service-orders', {
    serviceKey: 'resume_optimize',
    kioskSessionId: chargeSession,
  }, termHeaders(TERM_CHARGE, chargeToken))
  expectStatus(created, 200, '收费机器建单')
  const createdView = created.json.data ?? {}
  assert.equal(createdView['amountCents'], 100)
  assert.equal(createdView['status'], 'pending')
  assert.equal(typeof createdView['qrCodeContent'], 'string')
  assert.ok(String(createdView['qrCodeContent']).startsWith('sandboxpay://'))
  const expiresAt = Date.parse(String(createdView['expiresAt']))
  assert.ok(expiresAt > Date.now() + 4 * 60_000 && expiresAt < Date.now() + 6 * 60_000, '二维码 5 分钟过期')
  const createdRow = await loadOrder(String(createdView['id']))
  assert.equal(createdRow.amountCents, 100)
  assert.equal(createdRow.provider, 'sandbox')
  await prisma.terminalServicePrice.update({
    where: { terminalId_serviceKey: { terminalId: TERM_CHARGE, serviceKey: 'resume_optimize' } },
    data: { unitCents: 50 },
  })
  const mismatched = await callback({ ...createdRow, amountCents: 50 }, 'success', 'sbx_txn_mismatch')
  expectStatus(mismatched, 400, '改价后按新价通知')
  assert.equal(mismatched.json.error?.code, 'CALLBACK_AMOUNT_MISMATCH')
  const stillPending = await loadOrder(createdRow.id)
  assert.equal(stillPending.status, 'pending')
  assert.equal(stillPending.amountCents, 100, '建单金额不随后续改价变')
  await prisma.terminalServicePrice.update({
    where: { terminalId_serviceKey: { terminalId: TERM_CHARGE, serviceKey: 'resume_optimize' } },
    data: { unitCents: 100 },
  })
  const failedNotice = await callback(createdRow, 'failed')
  expectStatus(failedNotice, 200, '支付失败通知')
  const failedRow = await loadOrder(createdRow.id)
  assert.equal(failedRow.status, 'pending')
  assert.equal(failedRow.paymentFailed, true)
  const checking = await call('GET', `/api/v1/kiosk/service-orders/${createdRow.id}?refresh=1`, undefined, termHeaders(TERM_CHARGE, chargeToken, chargeSession))
  expectStatus(checking, 200, '刷新核实')
  assert.equal(checking.json.data?.['checking'], true)
  assert.equal(checking.json.data?.['status'], 'pending')
  const paidPacked = packCallback(createdRow, 'success', 'sbx_txn_resume_1')
  const paid = await postCallback(paidPacked)
  expectStatus(paid, 200, '支付成功')
  assert.equal(paid.json['ok'], true)
  const paidAgain = await callback(createdRow, 'success', 'sbx_txn_resume_1')
  expectStatus(paidAgain, 200, '重复成功通知')
  assert.equal(paidAgain.json['idempotent'], true)
  const paidAudits = await prisma.auditLog.count({ where: { action: 'service_order.paid', targetId: createdRow.id } })
  assert.equal(paidAudits, 1, '重复通知不能重复记账')
  const replay = await postCallback(paidPacked)
  expectStatus(replay, 401, '同一 nonce 重放')
  assert.equal(replay.json.error?.code, 'CALLBACK_REPLAY')
  const paidView = await call('GET', `/api/v1/kiosk/service-orders/${createdRow.id}`, undefined, termHeaders(TERM_CHARGE, chargeToken, chargeSession))
  assert.equal(paidView.json.data?.['status'], 'paid')
  assert.equal(paidView.json.data?.['paymentFailed'], false)
  assert.equal(paidView.json.data?.['amountCents'], 100)
  const wrongSession = await call('GET', `/api/v1/kiosk/service-orders/${createdRow.id}`, undefined, termHeaders(TERM_CHARGE, chargeToken, randomUUID()))
  expectStatus(wrongSession, 404, '别的会话不能看')
  assert.equal(wrongSession.json.error?.code, 'SERVICE_ORDER_NOT_FOUND')
  pass('建单、验签、失败仍待付、重复通知不重复记账、金额按建单时锁定')

  const missing = await call('GET', `/api/v1/resume/records/task-missing/optimize`, undefined, termHeaders(TERM_CHARGE, chargeToken, chargeSession))
  expectStatus(missing, 402, '没付款不能开始改写')
  assert.equal(missing.json.error?.code, 'SERVICE_PAYMENT_REQUIRED')
  assert.equal(missing.json.error?.amountCents, 100)
  assert.equal(missing.json.error?.serviceName, 'AI 简历优化')
  const callsAfter402 = fx.optimizeCalls
  const history = await call('GET', `/api/v1/resume/records/task-history/optimize?existingOnly=1`, undefined, termHeaders(TERM_CHARGE, chargeToken, chargeSession))
  expectStatus(history, 200, '回看历史')
  assert.equal(await prisma.serviceOrder.count({ where: { status: 'consumed' } }), 0, '回看不能占用')
  const started = await call('GET', `/api/v1/resume/records/task-ok/optimize`, undefined, termHeaders(TERM_CHARGE, chargeToken, chargeSession, createdRow.id))
  expectStatus(started, 200, '付完开始改写')
  assert.equal(started.json['status'], 'completed')
  const used = await loadOrder(createdRow.id)
  assert.equal(used.status, 'consumed')
  assert.equal(used.attemptsUsed, 1)
  assert.equal(used.consumedRef, 'task-ok')
  const again = await call('GET', `/api/v1/resume/records/task-ok-2/optimize`, undefined, termHeaders(TERM_CHARGE, chargeToken, chargeSession, createdRow.id))
  expectStatus(again, 409, '同一张单不能再用一次')
  assert.equal(again.json.error?.code, 'SERVICE_ORDER_IN_USE')
  assert.equal(again.json.error?.consumedRef, 'task-ok')
  const usedStill = await loadOrder(createdRow.id)
  assert.equal(usedStill.attemptsUsed, 1)
  assert.ok(fx.optimizeCalls > callsAfter402)
  pass('没单 402，付完只用一次，回看不占用')

  const raceSession = await openKiosk(TERM_CHARGE, chargeToken)
  const raceCreated = await call('POST', '/api/v1/kiosk/service-orders', {
    serviceKey: 'resume_optimize', kioskSessionId: raceSession,
  }, termHeaders(TERM_CHARGE, chargeToken))
  const raceId = String(raceCreated.json.data?.['id'])
  const raceRow = await loadOrder(raceId)
  expectStatus(await callback(raceRow, 'success', 'sbx_txn_race'), 200, '并发单付款')
  const [left, right] = await Promise.all([
    call('GET', '/api/v1/resume/records/task-race-a/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, raceSession, raceId)),
    call('GET', '/api/v1/resume/records/task-race-b/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, raceSession, raceId)),
  ])
  const raceStatuses = [left.status, right.status].sort((a, b) => a - b)
  assert.deepEqual(raceStatuses, [200, 409], `并发两次应只有一次成功 ${JSON.stringify([left.json, right.json])}`)
  const loser = left.status === 409 ? left : right
  assert.equal(loser.json.error?.code, 'SERVICE_ORDER_IN_USE')
  const raced = await loadOrder(raceId)
  assert.equal(raced.attemptsUsed, 1)
  assert.equal(raced.status, 'consumed')
  pass('并发两次开始只占用一次')

  const fitWithout = await call('POST', '/api/v1/resume/job-fit', {
    taskId: 'task-fit-none',
    manualJob: { title: '仓库管理员' },
  }, { ...termHeaders(TERM_CHARGE, chargeToken, chargeSession), authorization: `Bearer ${memberToken}` })
  expectStatus(fitWithout, 429, '没有这一趟时岗位对照仍扣每日次数')
  assert.equal(fitWithout.json.error?.code, 'AI_QUOTA_EXHAUSTED')
  assert.equal(fx.jobFitReserves, 1)
  const reservesBeforeCovered = fx.jobFitReserves
  const fitCovered = await call('POST', '/api/v1/resume/job-fit', {
    taskId: 'task-fit-covered',
    manualJob: { title: '仓库管理员' },
  }, { ...termHeaders(TERM_CHARGE, chargeToken, chargeSession, createdRow.id), authorization: `Bearer ${memberToken}` })
  expectStatus(fitCovered, 201, '付过的这一趟岗位对照')
  assert.notEqual(fitCovered.json.error?.code, 'AI_QUOTA_EXHAUSTED')
  assert.equal(fx.jobFitReserves, reservesBeforeCovered, '收费机器上这一趟的岗位对照不再扣每日次数')
  const follow = await call('POST', `/api/v1/mock-interviews/iv-follow/answer`, { answer: '我做过仓储' }, termHeaders(TERM_CHARGE, chargeToken, chargeSession))
  expectStatus(follow, 201, '追问不再另收')
  pass('收费机器上这一趟的子调用不再扣每日次数，也不再付一次')

  const layout = await call('POST', '/api/v1/resume/records/task-ok/layout-adjust', {
    action: 'reformat',
    resume: {
      basic: { name: '王磊' },
      intention: {},
      summary: '',
      education: [],
      experience: [],
      projects: [],
      skills: [],
      certificates: [],
    },
  }, termHeaders(TERM_CHARGE, chargeToken, chargeSession, createdRow.id))
  expectStatus(layout, 400, '排版失败')
  const afterLayout = await loadOrder(createdRow.id)
  assert.equal(afterLayout.status, 'consumed')
  assert.equal(afterLayout.refundedAt, null)
  const layoutAudit = await prisma.auditLog.count({ where: { action: 'service_order.layout_only', targetId: createdRow.id } })
  assert.equal(layoutAudit, 1, '排版失败只记一笔，不退款')
  pass('排版失败不退款')

  const retrySession = await openKiosk(TERM_CHARGE, chargeToken)
  const retryRow = await paidOrder(retrySession, 'resume_optimize', 'sbx_txn_retry')
  fx.optimizeMode = 'fail'
  const firstFail = await call('GET', '/api/v1/resume/records/task-fail-1/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, retrySession, retryRow.id))
  expectStatus(firstFail, 200, '第一次没做成')
  assert.equal(firstFail.json['status'], 'failed')
  const retryable = await loadOrder(retryRow.id)
  assert.equal(retryable.status, 'paid')
  assert.equal(retryable.attemptsUsed, 1)
  assert.equal(retryable.failureReason, '优化稿没做出来')
  assert.ok(retryable.retryUntil && retryable.retryUntil.getTime() > Date.now() + 9 * 60_000)
  const secondFail = await call('GET', '/api/v1/resume/records/task-fail-2/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, retrySession, retryRow.id))
  expectStatus(secondFail, 200, '再试仍没做成')
  const refundedFail = await loadOrder(retryRow.id)
  assert.equal(refundedFail.status, 'refunded')
  assert.equal(refundedFail.refundReason, '优化稿没做出来')
  assert.equal(refundedFail.refundAttempts, 0, '渠道一次退成，失败次数仍是 0')
  assert.ok(refundedFail.refundedAt)
  const refundAudit = await prisma.auditLog.count({ where: { action: 'service_order.refunded', targetId: retryRow.id } })
  assert.equal(refundAudit, 1)
  fx.optimizeMode = 'ok'
  pass('没做成可以免费再试一次，再失败才退')

  const successRetrySession = await openKiosk(TERM_CHARGE, chargeToken)
  const successRetryRow = await paidOrder(successRetrySession, 'resume_optimize', 'sbx_txn_retry_ok')
  fx.optimizeMode = 'fail'
  expectStatus(await call('GET', '/api/v1/resume/records/task-then-ok-1/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, successRetrySession, successRetryRow.id)), 200, '先失败')
  fx.optimizeMode = 'ok'
  const retriedOk = await call('GET', '/api/v1/resume/records/task-then-ok-2/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, successRetrySession, successRetryRow.id))
  expectStatus(retriedOk, 200, '再试做成')
  assert.equal(retriedOk.json['status'], 'completed')
  const kept = await loadOrder(successRetryRow.id)
  assert.equal(kept.status, 'consumed')
  assert.equal(kept.attemptsUsed, 2)
  assert.equal(kept.refundedAt, null)
  pass('再试做成了不退')

  const leaveFailSession = await openKiosk(TERM_CHARGE, chargeToken)
  const leaveFailRow = await paidOrder(leaveFailSession, 'resume_optimize', 'sbx_txn_leave_fail')
  fx.optimizeMode = 'end-then-fail'
  const originalGet = ai.getResumeOptimize
  ai.getResumeOptimize = async (taskId, requester, existingOnly, req, beforeGenerate) => {
    if (beforeGenerate) await beforeGenerate()
    expectStatus(await endKiosk(TERM_CHARGE, chargeToken, leaveFailSession), 200, '生成途中清场')
    return { taskId, status: 'failed' }
  }
  expectStatus(await call('GET', '/api/v1/resume/records/task-leave/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, leaveFailSession, leaveFailRow.id)), 200, '人走了这次没做成')
  ai.getResumeOptimize = originalGet
  fx.optimizeMode = 'ok'
  const leftFailed = await loadOrder(leaveFailRow.id)
  assert.equal(leftFailed.status, 'refunded', '人已经离开就不再给免费再试')
  pass('清场之后没做成直接退')

  const interviewSession = await openKiosk(TERM_CHARGE, chargeToken, 'interview')
  const interviewRow = await paidOrder(interviewSession, 'mock_interview', 'sbx_txn_interview')
  const noInterviewPay = await call('POST', '/api/v1/mock-interviews/iv-missing/start', {}, termHeaders(TERM_CHARGE, chargeToken, interviewSession))
  expectStatus(noInterviewPay, 402, '面试没付款')
  assert.equal(noInterviewPay.json.error?.serviceName, 'AI 模拟面试')
  assert.equal(noInterviewPay.json.error?.amountCents, 200)
  const interviewStart = await call('POST', '/api/v1/mock-interviews/iv-open/start', {}, termHeaders(TERM_CHARGE, chargeToken, interviewSession, interviewRow.id))
  expectStatus(interviewStart, 201, '面试开始')
  const interviewUsed = await loadOrder(interviewRow.id)
  assert.equal(interviewUsed.status, 'consumed')
  assert.equal(interviewUsed.attemptsUsed, 1)
  const replayStart = await call('POST', '/api/v1/mock-interviews/iv-open/start', {}, termHeaders(TERM_CHARGE, chargeToken, interviewSession, interviewRow.id))
  expectStatus(replayStart, 201, '已开场的回放')
  assert.equal((await loadOrder(interviewRow.id)).attemptsUsed, 1, '回放不能再占用')
  fx.interviewMode = 'throw'
  const interviewFailRow = await paidOrder(interviewSession, 'mock_interview', 'sbx_txn_interview_fail')
  expectStatus(await call('POST', '/api/v1/mock-interviews/iv-down-1/start', {}, termHeaders(TERM_CHARGE, chargeToken, interviewSession, interviewFailRow.id)), 500, '面试没开起来')
  const interviewRetry = await loadOrder(interviewFailRow.id)
  assert.equal(interviewRetry.status, 'paid')
  assert.equal(interviewRetry.failureReason, '面试没开起来')
  expectStatus(await call('POST', '/api/v1/mock-interviews/iv-down-2/start', {}, termHeaders(TERM_CHARGE, chargeToken, interviewSession, interviewFailRow.id)), 500, '面试再试仍失败')
  assert.equal((await loadOrder(interviewFailRow.id)).status, 'refunded')
  fx.interviewMode = 'ok'
  pass('面试开始前收，开起来不退，没开起来再试一次仍失败才退')

  const scanSession = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
  const scanMissing = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, scanSession))
  expectStatus(scanMissing, 402, '扫描没付款')
  assert.equal(scanMissing.json.error?.serviceName, '扫描')
  const scanFileId = 'scan-file-made'
  await prisma.scanTask.create({
    data: { id: scanFileId, terminalId: TERM_CHARGE, scanType: 'resume', status: 'completed', fileId: 'file-demo', expiresAt: new Date(Date.now() + 3600_000) },
  })
  fx.scanReturnId = scanFileId
  const scanRow = await paidOrder(scanSession, 'scan', 'sbx_txn_scan_ok')
  const scanStart = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, scanSession, scanRow.id))
  expectStatus(scanStart, 201, '扫描开始')
  assert.equal((await loadOrder(scanRow.id)).consumedRef, scanFileId)
  await prisma.serviceOrder.update({ where: { id: scanRow.id }, data: { consumedAt: new Date(Date.now() - 20_000) } })
  await serviceOrders.sweep()
  assert.equal((await loadOrder(scanRow.id)).status, 'consumed', '出了文件不退')
  const scanAgeRow = await paidOrder(scanSession, 'scan', 'sbx_txn_scan_age')
  await prisma.serviceOrder.update({
    where: { id: scanAgeRow.id },
    data: { status: 'consumed', attemptsUsed: 1, consumedAt: new Date(Date.now() - 3 * 60_000), consumedRef: 'pending' },
  })
  await serviceOrders.sweep()
  const scanAged = await loadOrder(scanAgeRow.id)
  assert.equal(scanAged.status, 'paid')
  assert.equal(scanAged.failureReason, '扫描没出文件')
  await prisma.serviceOrder.update({ where: { id: scanAgeRow.id }, data: { retryUntil: new Date(Date.now() - 1000) } })
  await serviceOrders.sweep()
  const scanExpired = await loadOrder(scanAgeRow.id)
  assert.equal(scanExpired.status, 'refunded')
  assert.equal(scanExpired.refundReason, '免费再试已过期')
  fx.scanMode = 'throw'
  const scanThrowRow = await paidOrder(scanSession, 'scan', 'sbx_txn_scan_throw')
  expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, scanSession, scanThrowRow.id)), 500, '扫描创建失败')
  assert.equal((await loadOrder(scanThrowRow.id)).status, 'paid')
  expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, scanSession, scanThrowRow.id)), 500, '扫描再试失败')
  assert.equal((await loadOrder(scanThrowRow.id)).status, 'refunded')
  assert.equal((await loadOrder(scanThrowRow.id)).refundReason, '扫描没出文件')
  fx.scanMode = 'ok'
  pass('扫描没出文件可再试，窗口过了或再失败才退；出了文件不退')

  const cancelSession = await openKiosk(TERM_CHARGE, chargeToken)
  const cancelPending = await call('POST', '/api/v1/kiosk/service-orders', {
    serviceKey: 'resume_optimize', kioskSessionId: cancelSession,
  }, termHeaders(TERM_CHARGE, chargeToken))
  const cancelPendingId = String(cancelPending.json.data?.['id'])
  const closedByUser = await call('POST', `/api/v1/kiosk/service-orders/${cancelPendingId}/close`, undefined, termHeaders(TERM_CHARGE, chargeToken, cancelSession))
  expectStatus(closedByUser, 200, '取消未付')
  assert.equal((await loadOrder(cancelPendingId)).status, 'closed')
  assert.equal((await loadOrder(cancelPendingId)).closeReason, 'user_cancelled')
  const cancelPaid = await paidOrder(cancelSession, 'mock_interview', 'sbx_txn_cancel_paid')
  const closedPaid = await call('POST', `/api/v1/kiosk/service-orders/${cancelPaid.id}/close`, undefined, termHeaders(TERM_CHARGE, chargeToken, cancelSession))
  expectStatus(closedPaid, 200, '取消已付未用')
  assert.equal((await loadOrder(cancelPaid.id)).status, 'refunded')
  assert.equal((await loadOrder(cancelPaid.id)).refundReason, '用户取消，这一次还没用')
  const inUse = await call('POST', `/api/v1/kiosk/service-orders/${createdRow.id}/close`, undefined, termHeaders(TERM_CHARGE, chargeToken, chargeSession))
  expectStatus(inUse, 409, '已经开始不能取消')
  assert.equal(inUse.json.error?.code, 'SERVICE_ORDER_IN_USE')
  pass('用户取消：未付关闭，付了没用退款，已经开始不能取消')

  const expireSession = await openKiosk(TERM_CHARGE, chargeToken)
  const expireCreated = await call('POST', '/api/v1/kiosk/service-orders', {
    serviceKey: 'scan', kioskSessionId: expireSession,
  }, termHeaders(TERM_CHARGE, chargeToken))
  const expireId = String(expireCreated.json.data?.['id'])
  await prisma.serviceOrder.update({ where: { id: expireId }, data: { expiresAt: new Date(Date.now() - 1000) } })
  await serviceOrders.sweep()
  const expired = await loadOrder(expireId)
  assert.equal(expired.status, 'closed')
  assert.equal(expired.closeReason, 'expired')
  const late = await callback(expired, 'success', 'sbx_txn_late')
  expectStatus(late, 200, '关闭后才付')
  const lateRow = await loadOrder(expireId)
  assert.equal(lateRow.status, 'refunded')
  assert.equal(lateRow.refundReason, '付款时这一单已经关闭')
  pass('超时未付关闭；关掉之后才付到的钱按原路退回')

  const leaveSession = await openKiosk(TERM_CHARGE, chargeToken)
  const leavePending = await call('POST', '/api/v1/kiosk/service-orders', {
    serviceKey: 'scan', kioskSessionId: leaveSession,
  }, termHeaders(TERM_CHARGE, chargeToken))
  const leavePendingId = String(leavePending.json.data?.['id'])
  const leavePaid = await paidOrder(leaveSession, 'scan', 'sbx_txn_leave_paid')
  expectStatus(await endKiosk(TERM_CHARGE, chargeToken, leaveSession), 200, '清场')
  assert.equal((await loadOrder(leavePendingId)).status, 'closed')
  assert.equal((await loadOrder(leavePendingId)).closeReason, 'session_ended')
  assert.equal((await loadOrder(leavePaid.id)).status, 'refunded')
  assert.equal((await loadOrder(leavePaid.id)).refundReason, '人已离开，这一次还没用')
  pass('清场关掉未付的单，并退掉付了还没用的')

  const refundSession = await openKiosk(TERM_CHARGE, chargeToken)
  const refundRow = await paidOrder(refundSession, 'mock_interview', 'sbx_txn_refund_fail')
  fx.refundMode = 'throw'
  const callsBefore = fx.refundCalls
  expectStatus(await endKiosk(TERM_CHARGE, chargeToken, refundSession), 200, '清场触发退款失败')
  const refunding = await loadOrder(refundRow.id)
  assert.equal(refunding.status, 'refunding')
  assert.equal(refunding.refundAttempts, 1)
  assert.equal(refunding.refundNo, `svc-rfd-${refundRow.id}`)
  assert.equal(fx.refundCalls, callsBefore + 1)
  await serviceOrders.sweep()
  assert.equal(fx.refundCalls, callsBefore + 1, '没到间隔不能连着退')
  assert.equal((await loadOrder(refundRow.id)).refundAttempts, 1)
  await prisma.serviceOrder.update({ where: { id: refundRow.id }, data: { nextRefundAt: new Date(Date.now() - 1000) } })
  await serviceOrders.sweep()
  const retriedRefund = await loadOrder(refundRow.id)
  assert.equal(retriedRefund.status, 'refunding')
  assert.equal(retriedRefund.refundAttempts, 2)
  assert.equal(retriedRefund.refundNo, refunding.refundNo)
  fx.refundMode = 'ok'
  await prisma.serviceOrder.update({ where: { id: refundRow.id }, data: { nextRefundAt: new Date(Date.now() - 1000) } })
  await serviceOrders.sweep()
  const refundedLater = await loadOrder(refundRow.id)
  assert.equal(refundedLater.status, 'refunded')
  assert.equal(refundedLater.refundAttempts, 2, '退成之后不再把失败次数清零，也不再加')
  const callsAfterSuccess = fx.refundCalls
  await serviceOrders.sweep()
  assert.equal(fx.refundCalls, callsAfterSuccess, '已经退成的单不能再打一次渠道')
  pass('退款失败留在退款中并重试，不会标成已退，也不会退两次')

  const manualSession = await openKiosk(TERM_CHARGE, chargeToken)
  const manualRow = await paidOrder(manualSession, 'scan', 'sbx_txn_manual_refund')
  fx.refundMode = 'throw'
  expectStatus(await endKiosk(TERM_CHARGE, chargeToken, manualSession), 200, '手动重试前先失败一次')
  const adminHeaders = { authorization: `Bearer ${adminToken}` }
  const listed = await call('GET', '/api/v1/admin/orders?recordKind=service&type=scan&serviceStatus=refunding', undefined, adminHeaders)
  expectStatus(listed, 200, '后台筛服务单')
  const listedItem = (listed.json.items ?? []).find((item) => item['id'] === manualRow.id)
  assert.ok(listedItem, '退款中的扫描单要出现在后台')
  assert.equal(listedItem?.['serviceKey'], 'scan')
  assert.equal(listedItem?.['serviceName'], '扫描')
  assert.equal(listedItem?.['amountCents'], 100)
  assert.equal(listedItem?.['serviceStatus'], 'refunding')
  assert.equal(listedItem?.['terminalCode'], 'ZYD-SN-01')
  assert.equal(listedItem?.['locationLabel'], '市南 · 香港中路')
  assert.equal(listedItem?.['refundReason'], '人已离开，这一次还没用')
  const emptyStatus = await call('GET', '/api/v1/admin/orders?recordKind=service&serviceStatus=paying', undefined, adminHeaders)
  expectStatus(emptyStatus, 200, '不认识的服务单状态')
  assert.equal(emptyStatus.json.pagination?.total, 0)
  const manualTry = await call('POST', `/api/v1/admin/orders/${manualRow.id}/retry-service-refund`, {}, adminHeaders)
  expectStatus(manualTry, 200, '退款中再试一次')
  assert.equal(manualTry.json['serviceStatus'], 'refunding')
  assert.equal((await loadOrder(manualRow.id)).refundAttempts, 2)
  const retryAudit = await prisma.auditLog.count({ where: { action: 'service_order.refund_retry', targetId: manualRow.id, actorId: ADMIN } })
  assert.equal(retryAudit, 1)
  fx.refundMode = 'ok'
  const manualDone = await call('POST', `/api/v1/admin/orders/${manualRow.id}/retry-service-refund`, {}, adminHeaders)
  expectStatus(manualDone, 200, '手动重试退成')
  assert.equal(manualDone.json['serviceStatus'], 'refunded')
  assert.equal(typeof manualDone.json['refundedAt'], 'string')
  const notRefunding = await call('POST', `/api/v1/admin/orders/${manualRow.id}/retry-service-refund`, {}, adminHeaders)
  expectStatus(notRefunding, 409, '已退的不能再试')
  assert.equal(notRefunding.json.error?.code, 'SERVICE_REFUND_NOT_RETRYABLE')
  pass('后台能筛服务单，退款中可以再试一次')

  const freeCallsBefore = fx.optimizeCalls
  const freeRun = await call('GET', '/api/v1/resume/records/task-free/optimize', undefined, termHeaders(TERM_FREE, freeToken, freeSession, createdRow.id))
  expectStatus(freeRun, 200, '不收费机器开始改写')
  assert.equal(freeRun.json['status'], 'completed')
  assert.equal(await prisma.serviceOrder.count({ where: { terminalId: TERM_FREE } }), 0)
  assert.equal((await loadOrder(createdRow.id)).attemptsUsed, 1, '不收费机器忽略别人的单号')
  assert.ok(fx.optimizeCalls > freeCallsBefore)
  const publicInterview = await call('POST', '/api/v1/mock-interviews/iv-public/start', {}, termHeaders(TERM_PUBLIC, publicToken))
  expectStatus(publicInterview, 201, '公共点位面试不拦付款')
  const orgScan = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_ORG }, termHeaders(TERM_ORG, orgToken))
  expectStatus(orgScan, 201, '机构承担扫描不拦付款')
  pass('不收费的机器行为与加收费之前一样')

  const realGetResumeOptimize = AiService.prototype.getResumeOptimize
  const m6Self = Object.create(AiService.prototype) as {
    optimizeLock: RedisInflightLock
    loadAuthorizedResult: () => Promise<null>
    computeResumeOptimize: (taskId: string, requester: unknown, identity: unknown, req: unknown, beforeGenerate?: () => Promise<boolean>) => Promise<{ taskId: string; status: string }>
  }
  m6Self.optimizeLock = new RedisInflightLock(undefined)
  m6Self.loadAuthorizedResult = async () => null
  m6Self.computeResumeOptimize = async (taskId, _requester, _identity, _req, beforeGenerate) => {
    await beforeGenerate?.()
    return { taskId, status: 'completed' }
  }
  const stubOptimize = ai.getResumeOptimize
  ai.getResumeOptimize = function m6Get(...args: unknown[]) {
    return realGetResumeOptimize.apply(m6Self, args as never)
  }
  const m6Missing = await call('GET', '/api/v1/resume/records/m6-missing/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, chargeSession))
  expectStatus(m6Missing, 402, 'M6 没单')
  assert.equal(m6Missing.json.error?.code, 'SERVICE_PAYMENT_REQUIRED')
  const m6Session = await openKiosk(TERM_CHARGE, chargeToken)
  const m6Row = await paidOrder(m6Session, 'resume_optimize', 'sbx_txn_m6')
  const m6Run = await call('GET', '/api/v1/resume/records/m6-ok/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, m6Session, m6Row.id))
  expectStatus(m6Run, 200, 'M6 有单')
  const m6Used = await loadOrder(m6Row.id)
  assert.equal(m6Used.status, 'consumed')
  assert.equal(m6Used.consumedRef, 'm6-ok')
  ai.getResumeOptimize = stubOptimize
  pass('M6 真实改写入口：没单 402，有单后占用')

  const m7Session = await openKiosk(TERM_CHARGE, chargeToken)
  const m7Row = await paidOrder(m7Session, 'scan', 'sbx_txn_m7')
  const m7Before = await loadOrder(m7Row.id)
  const m7Run = await call('GET', '/api/v1/resume/records/m7-cross/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, m7Session, m7Row.id))
  expectStatus(m7Run, 402, 'M7 扫描单不能改写')
  assert.equal(m7Run.json.error?.code, 'SERVICE_PAYMENT_REQUIRED')
  const m7After = await loadOrder(m7Row.id)
  assert.equal(m7After.status, m7Before.status)
  assert.equal(m7After.attemptsUsed, m7Before.attemptsUsed)
  assert.equal(m7After.serviceKey, 'scan')
  assert.equal(m7After.consumedAt, m7Before.consumedAt)
  pass('M7 扫描单拿去改写仍要付款，扫描单不变')
  return createdRow.id
}
