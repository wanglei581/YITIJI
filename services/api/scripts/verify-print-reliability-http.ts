/**
 * 打印可靠性走真实 HTTP 的用例。
 *
 * verify-print-queue-timeout / verify-print-completion-evidence 直接调服务方法、自己 new 校验管道。
 * 这里起真服务（全局入参校验、全局错误过滤器、角色守卫都在），补上只有过了 HTTP 层和真实
 * 重新提交路径才看得出的部分：
 *   A. 心跳带打印完成判据：不带、带合法值、带非法值、带服务端不认识的字段。
 *   B. 后台改排队等待上限：鉴权、范围、类型。
 *   C. 付费单排队超时 → 状态接口给新错误码 → 待退款标记 → 管理员重试清标记 → 能再领。
 *   D. 免费单排队超时 → 会员在一体机重新提交 → 能再领。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated node -r @swc-node/register scripts/verify-print-reliability-http.ts
 */
import assert from 'node:assert/strict'
import { issueInternalToken, startHarness, type HarnessEnv } from './support/content-pipeline-harness'

const SCREEN = '这单等了太久没有打印，没有出纸，可以重新提交打印。'
const STALE_MS = 3 * 60 * 60_000 // 比可配上限（120 分钟）还久，别的用例把上限改成多少都算超时

interface Reply {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

function pass(line: string): void {
  console.log(`  PASS ${line}`)
}

async function main(): Promise<void> {
  const h: HarnessEnv = await startHarness(0)
  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { PrintJobsService } = await import('../src/print-jobs/print-jobs.service')
  const { PAID_UNFULFILLED_PENDING_REFUND_REASON } = await import('../src/payment/pending-refund-signal')
  const { signFileUrl } = await import('../src/files/signing')
  const {
    PRINT_QUEUE_TIMEOUT,
    PRINT_QUEUE_TIMEOUT_SETTING_AUDIT,
    PRINT_QUEUE_TIMEOUT_SETTING_KEY,
    expireQueuedPrintTasks,
  } = await import('../src/print-jobs/print-queue-timeout')
  const prisma = h.api.app.get(PrismaService)
  const jobs = h.api.app.get(PrintJobsService)

  const run = h.run
  const termId = `g1http-term-${run}`
  const agentToken = `g1http-agent-token-${run}`
  const adminName = `g1http-admin-${run}`
  const partnerName = `g1http-partner-${run}`
  const orgId = `g1http-org-${run}`
  const memberId = `g1http-member-${run}`
  const fileId = `g1http-file-${run}`
  const taskIds: string[] = []
  const orderIds: string[] = []
  const savedSetting = await prisma.platformSetting.findUnique({ where: { key: PRINT_QUEUE_TIMEOUT_SETTING_KEY } })

  async function call(
    method: string,
    path: string,
    opts: { bearer?: string; json?: unknown } = {},
  ): Promise<Reply> {
    const headers: Record<string, string> = {}
    if (opts.bearer) headers['Authorization'] = `Bearer ${opts.bearer}`
    if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetch(`${h.api.base}${path}`, {
      method,
      headers,
      body: opts.json === undefined ? undefined : JSON.stringify(opts.json),
    })
    const raw = await res.text()
    try {
      return { status: res.status, body: JSON.parse(raw) }
    } catch {
      return { status: res.status, body: { raw } }
    }
  }

  const heartbeat = (extra: Record<string, unknown>) => call('PUT', `/terminals/${termId}/heartbeat`, {
    bearer: agentToken,
    json: { status: 'online', printerStatus: 'idle', agentVersion: '0.4.23', localTaskDatabaseAvailable: true, ...extra },
  })
  const latestEvidence = async () => (await prisma.terminalHeartbeat.findFirst({
    where: { terminalId: termId },
    orderBy: { createdAt: 'desc' },
    select: { printCompletionEvidence: true },
  }))?.printCompletionEvidence
  const claim = async (): Promise<Array<{ taskId: string }>> => {
    const res = await call('POST', `/terminals/${termId}/tasks/claim`, { bearer: agentToken, json: { maxTasks: 1 } })
    assert.ok(res.status === 200 || res.status === 201, `领单接口应成功，实际 ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`)
    const list = Array.isArray(res.body) ? res.body : res.body?.data
    assert.ok(Array.isArray(list), `领单返回应是数组：${JSON.stringify(res.body).slice(0, 200)}`)
    return list
  }

  let seq = 0
  /** 一张已付、排着队的单：缺省三小时没人领；fresh 为真时是刚提交的。金额大于 0 就是付费单。 */
  async function seedStaleJob(input: { amountCents: number; endUserId?: string; fresh?: boolean }): Promise<{ taskId: string; orderId: string }> {
    seq += 1
    const taskId = `g1http-task-${run}-${seq}`
    const orderId = `g1http-order-${run}-${seq}`
    const stale = input.fresh ? new Date() : new Date(Date.now() - STALE_MS)
    await prisma.printTask.create({
      data: {
        id: taskId,
        terminalId: termId,
        endUserId: input.endUserId ?? null,
        fileId,
        fileUrl: signFileUrl(fileId, 30 * 60_000).url,
        fileMd5: 'g1http',
        paramsJson: JSON.stringify({ copies: 1 }),
        status: 'pending',
      },
    })
    await prisma.order.create({
      data: {
        id: orderId,
        orderNo: `G1H${run}${seq}`,
        printTaskId: taskId,
        terminalId: termId,
        endUserId: input.endUserId ?? null,
        amountCents: input.amountCents,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: input.amountCents > 0 ? 'offline' : 'free',
        paidAt: stale,
        taskStatus: 'pending',
        billablePages: 2,
        printParamsJson: JSON.stringify({ copies: 1 }),
        channel: 'kiosk',
        pickupStatus: 'none',
      },
    })
    // updatedAt 由 Prisma 自动写成现在，只能用原始语句拨回过去（PrismaService 只在事务里给原始语句）。
    await prisma.$transaction((tx) => tx.$executeRaw`UPDATE "PrintTask" SET "updatedAt" = ${stale} WHERE "id" = ${taskId}`)
    const aged = await prisma.printTask.findUnique({ where: { id: taskId }, select: { updatedAt: true } })
    assert.ok(aged && Math.abs(aged.updatedAt.getTime() - stale.getTime()) < 2000, 'updatedAt 没有拨回过去')
    taskIds.push(taskId)
    orderIds.push(orderId)
    return { taskId, orderId }
  }

  async function cleanup(): Promise<void> {
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: taskIds } } })
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } })
    await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.fileObject.deleteMany({ where: { id: fileId } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: termId } })
    await prisma.terminal.deleteMany({ where: { id: termId } })
    await prisma.endUser.deleteMany({ where: { id: memberId } })
    await prisma.user.deleteMany({ where: { username: { in: [adminName, partnerName] } } })
    await prisma.organization.deleteMany({ where: { id: orgId } })
    if (savedSetting) {
      await prisma.platformSetting.update({ where: { key: savedSetting.key }, data: { value: savedSetting.value } })
    } else {
      await prisma.platformSetting.deleteMany({ where: { key: PRINT_QUEUE_TIMEOUT_SETTING_KEY } })
    }
  }

  try {
    await prisma.organization.create({ data: { id: orgId, name: `打印可靠性用例机构 ${run}`, type: 'public_employment_service' } })
    await prisma.user.create({ data: { username: adminName, passwordHash: 'not-used', name: '打印可靠性用例管理员', role: 'admin' } })
    await prisma.user.create({ data: { username: partnerName, passwordHash: 'not-used', name: '打印可靠性用例机构账号', role: 'partner', orgId } })
    await prisma.terminal.create({
      data: {
        id: termId,
        terminalCode: `G1H-${run}`,
        displayName: '打印可靠性用例终端',
        agentToken,
        deviceFingerprint: `fp-${run}`,
        credentialGeneration: 0,
        enabled: true,
        lifecycleStatus: 'active',
      },
    })
    await prisma.endUser.create({ data: { id: memberId, phoneHash: `hash-${memberId}`, phoneEnc: `enc-${memberId}` } })
    await prisma.fileObject.create({
      data: {
        id: fileId,
        storageKey: `g1http/${run}.pdf`,
        filename: '求职材料.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        sha256: '',
        purpose: 'print_source',
        bucket: 'local',
      },
    })
    const admin = await issueInternalToken(h, adminName)
    const partner = await issueInternalToken(h, partnerName)
    const adminTerminal = async () => {
      const res = await call('GET', '/admin/terminals', { bearer: admin })
      assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200))
      const row = (res.body.data.terminals as Array<{ id: string; printCompletionEvidence: unknown }>).find((t) => t.id === termId)
      assert.ok(row, '后台终端列表里应有这台终端')
      return row
    }

    console.log('\n[A] 心跳里的打印完成判据（真实入参校验）')
    {
      const legacy = await heartbeat({})
      assert.equal(legacy.status, 200, `老版本终端程序不带这一项，心跳应照常收下：${JSON.stringify(legacy.body).slice(0, 200)}`)
      assert.equal(await latestEvidence(), null)
      assert.equal((await adminTerminal()).printCompletionEvidence, null)
      pass('不带这一项：心跳照常收下，库里是 null，后台读到「未上报」')

      assert.equal((await heartbeat({ printCompletionEvidence: 'unavailable' })).status, 200)
      assert.equal(await latestEvidence(), 'unavailable')
      assert.equal((await adminTerminal()).printCompletionEvidence, 'unavailable')
      assert.equal((await heartbeat({ printCompletionEvidence: 'available' })).status, 200)
      assert.equal((await adminTerminal()).printCompletionEvidence, 'available')
      pass('带 unavailable / available：心跳收下，后台终端列表读到同一个值')

      const badValue = await heartbeat({ printCompletionEvidence: 'healthy' })
      assert.equal(badValue.status, 400)
      assert.equal(badValue.body?.error?.code, 'VALIDATION_FAILED')
      const unknownField = await heartbeat({ printCompletionEvidence: 'available', printCompletionDetail: 'x' })
      assert.equal(unknownField.status, 400)
      assert.equal(unknownField.body?.error?.code, 'VALIDATION_FAILED')
      assert.equal(await latestEvidence(), 'available', '被拒收的心跳不应写库')
      const wrongToken = await call('PUT', `/terminals/${termId}/heartbeat`, { bearer: 'not-this-terminal', json: { status: 'online' } })
      assert.equal(wrongToken.status, 401)
      pass('非法取值、服务端不认识的字段：整条心跳 400 拒收且不写库（所以必须后端先上线）；令牌不对 401')
    }

    console.log('\n[B] 后台改排队等待上限（真实鉴权与入参校验）')
    {
      await prisma.platformSetting.deleteMany({ where: { key: PRINT_QUEUE_TIMEOUT_SETTING_KEY } })
      assert.equal((await call('GET', '/admin/print-queue-timeout')).status, 401)
      assert.equal((await call('GET', '/admin/print-queue-timeout', { bearer: partner })).status, 403)
      assert.equal((await call('PUT', '/admin/print-queue-timeout', { bearer: partner, json: { minutes: 30 } })).status, 403)
      const initial = await call('GET', '/admin/print-queue-timeout', { bearer: admin })
      assert.equal(initial.status, 200)
      assert.equal(initial.body.data.minutes, 15)
      pass('没登录 401；机构账号读、改都是 403；管理员读到缺省 15 分钟')

      const saved = await call('PUT', '/admin/print-queue-timeout', { bearer: admin, json: { minutes: 20 } })
      assert.equal(saved.status, 200, JSON.stringify(saved.body).slice(0, 200))
      assert.equal(saved.body.data.minutes, 20)
      const audit = await prisma.auditLog.findFirst({
        where: { action: PRINT_QUEUE_TIMEOUT_SETTING_AUDIT },
        orderBy: { createdAt: 'desc' },
      })
      assert.deepEqual(JSON.parse(audit?.payloadJson ?? '{}'), { before: 15, after: 20 })
      for (const minutes of [4, 121, 7.5, '20', null]) {
        const rejected = await call('PUT', '/admin/print-queue-timeout', { bearer: admin, json: { minutes } })
        assert.equal(rejected.status, 400, `minutes=${JSON.stringify(minutes)} 应被拒，实际 ${rejected.status}`)
      }
      assert.equal((await call('PUT', '/admin/print-queue-timeout', { bearer: admin, json: { minutes: 30, note: 'x' } })).status, 400)
      assert.equal((await call('GET', '/admin/print-queue-timeout', { bearer: admin })).body.data.minutes, 20)
      pass('管理员改成 20 生效并写审计（改前 15、改后 20）；4、121、小数、字符串、空值、多余字段都是 400，值不变')
    }

    console.log('\n[C] 付费单排队超时：新错误码、待退款标记、管理员重试后能再领')
    {
      const paid = await seedStaleJob({ amountCents: 100 })
      const fresh = await seedStaleJob({ amountCents: 0, fresh: true })
      const first = await claim()
      assert.equal(first.length, 1, '过期的单排在前面，也不能挡住后面没过期的单')
      assert.equal(first[0]?.taskId, fresh.taskId)
      assert.deepEqual(await claim(), [], '过期的单即使还没被清扫也领不走')
      const expired = await expireQueuedPrintTasks(prisma)
      assert.ok(expired >= 1)
      const status = await call('GET', `/print/jobs/${paid.taskId}`)
      assert.equal(status.status, 200, JSON.stringify(status.body).slice(0, 200))
      const view = status.body?.data ?? status.body
      assert.equal(view.status, 'failed', JSON.stringify(status.body).slice(0, 300))
      assert.equal(view.errorCode, PRINT_QUEUE_TIMEOUT)
      assert.equal(view.failureReasonForUser, SCREEN)
      assert.equal(JSON.stringify(status.body).includes('工作人员'), false)
      const flagged = await prisma.order.findUnique({ where: { id: paid.orderId } })
      assert.equal(flagged?.taskStatus, 'failed')
      assert.equal(flagged?.payStatus, 'paid', '超时不动付款状态，不自动退款')
      assert.equal(flagged?.refundReason, PAID_UNFULFILLED_PENDING_REFUND_REASON)
      assert.equal(await prisma.refund.count({ where: { orderId: paid.orderId } }), 0, '只打待退款标记，不建退款单')
      assert.equal(await expireQueuedPrintTasks(prisma), 0, '已经判失败的单不会被再判一次')
      pass('清扫前过期单领不走、也不挡后面的新单；清扫后状态接口给 PRINT_QUEUE_TIMEOUT 和对用户的那句话；付款状态不变、只打待退款标记')

      const retry = await call('POST', `/admin/print-scan/tasks/print/${paid.taskId}/actions`, { bearer: admin, json: { action: 'retry' } })
      assert.ok(retry.status === 200 || retry.status === 201, `管理员重试应成功：${retry.status} ${JSON.stringify(retry.body).slice(0, 300)}`)
      const requeued = await prisma.order.findUnique({ where: { id: paid.orderId } })
      assert.equal(requeued?.taskStatus, 'pending')
      assert.equal(requeued?.refundReason, null, '重新排队后待退款标记必须清掉，否则领不走')
      const claimed = await claim()
      assert.equal(claimed.length, 1)
      assert.equal(claimed[0]?.taskId, paid.taskId)
      pass('管理员重试（真实接口）：待退款标记清掉，终端领到这一单')
    }

    console.log('\n[D] 免费单排队超时：会员在一体机重新提交后能再领')
    {
      const free = await seedStaleJob({ amountCents: 0, endUserId: memberId })
      assert.ok((await expireQueuedPrintTasks(prisma)) >= 1)
      const failed = await prisma.order.findUnique({ where: { id: free.orderId } })
      assert.equal(failed?.taskStatus, 'failed')
      assert.equal(failed?.refundReason, null, '免费单没有钱可退，不打待退款标记')
      const result = await jobs.retryPaidFailedJob(free.taskId, { endUserId: memberId })
      assert.equal(result.status, 'pending')
      const again = await prisma.printTask.findUnique({ where: { id: free.taskId } })
      assert.equal(again?.status, 'pending')
      assert.equal(again?.errorCode, null)
      const claimed = await claim()
      assert.equal(claimed.length, 1)
      assert.equal(claimed[0]?.taskId, free.taskId)
      pass('免费单超时不打待退款标记；会员重新提交（真实服务方法）后回到排队，终端领到这一单')

      const paid = await seedStaleJob({ amountCents: 100, endUserId: memberId })
      assert.ok((await expireQueuedPrintTasks(prisma)) >= 1)
      assert.equal((await prisma.order.findUnique({ where: { id: paid.orderId } }))?.refundReason, PAID_UNFULFILLED_PENDING_REFUND_REASON)
      assert.equal((await jobs.retryPaidFailedJob(paid.taskId, { endUserId: memberId })).status, 'pending')
      const requeued = await prisma.order.findUnique({ where: { id: paid.orderId } })
      assert.equal(requeued?.refundReason, null, '会员重新提交后待退款标记必须清掉，否则领不走')
      assert.equal(requeued?.payStatus, 'paid', '重新提交不重复收款，也不改付款状态')
      const claimedPaid = await claim()
      assert.equal(claimedPaid.length, 1)
      assert.equal(claimedPaid[0]?.taskId, paid.taskId)
      pass('付费单超时后会员重新提交：待退款标记清掉、付款状态不变，终端领到这一单')
    }
  } finally {
    await cleanup().catch((error: unknown) => console.error('清理夹具失败', error))
    await h.close()
  }
  console.log('\nverify:print-reliability-http PASS')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
