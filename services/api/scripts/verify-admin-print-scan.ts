/**
 * Task 10 — Admin 打印扫描统一任务中心 + 终端能力开关验证。
 *
 * 覆盖：
 *   1. 能力开关：非法键/状态 400；upsert 创建与更新（含 oldStatus 供审计）；
 *      list 返回全部能力键且未配置 configured=false；DB 脏状态 fail-closed 归 not_verified。
 *   2. 统一任务中心诚实性：未上线类型 implemented=false 且 items 恒空（不伪造行）；
 *      print 行不含 fileUrl/fileMd5/errorMessage/paramsJson 原文；损坏 paramsJson → 字段 null 不抛错。
 *   3. 类型感知动作：print.retry 仅 failed（联动 Order.taskStatus + 写状态日志）；
 *      scan.cancel 仅 waiting；其余组合 400；非法状态 409。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:admin-print-scan
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalCapabilitiesService, setPrintScanCapabilityModeForTest } from '../src/terminals/terminal-capabilities.service'
import { AdminPrintScanService } from '../src/admin-print-scan/admin-print-scan.service'
import { ScanTasksService } from '../src/scan-tasks/scan-tasks.service'
import { signFileUrl } from '../src/files/signing'
import { AuditService } from '../src/audit/audit.service'
import { OnlinePaymentService } from '../src/payment/online-payment.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { createPaymentSessionToken } from '../src/payment/payment-session-token'
import { PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import { SandboxPaymentProvider } from '../src/payment/providers/sandbox-payment.provider'
import { readFileSync } from 'fs'
import { join } from 'path'
import * as apiContract from '../src/terminals/terminal-capabilities.types'
import * as sharedContract from '../../../packages/shared/src/types/printScanCapability'

const { PRINT_SCAN_CAPABILITY_KEYS } = apiContract

function assertDeepEqual(a: unknown, b: unknown, label: string): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`  FAIL 契约镜像漂移：${label} 在 shared 与 API 副本间不一致`)
    process.exit(1)
  }
}

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

async function expectHttpError(fn: () => Promise<unknown>, status: number, label: string): Promise<void> {
  try {
    await fn()
  } catch (e) {
    const got = (e as { getStatus?: () => number }).getStatus?.()
    if (got === status) { pass(label); return }
    fail(`${label} — 期望 HTTP ${status}，实际 ${String(got ?? e)}`)
  }
  fail(`${label} — 期望抛出 HTTP ${status}，实际未抛错`)
}

/** 精确断言 HTTP 状态 + 业务错误码（防止任意同状态错误蒙混过关）。 */
async function expectHttpErrorCode(
  fn: () => Promise<unknown>,
  status: number,
  code: string,
  label: string,
): Promise<void> {
  try {
    await fn()
  } catch (e) {
    const got = (e as { getStatus?: () => number }).getStatus?.()
    const body = (e as { getResponse?: () => unknown }).getResponse?.() as
      | { error?: { code?: string } }
      | undefined
    const gotCode = body?.error?.code
    if (got === status && gotCode === code) { pass(label); return }
    fail(`${label} — 期望 HTTP ${status}+${code}，实际 ${String(got)}+${String(gotCode)}`)
  }
  fail(`${label} — 期望抛出 HTTP ${status}（${code}），实际未抛错`)
}

async function main() {
  console.log('\n=== Task 10 Admin print-scan 任务中心 + 能力开关验证 ===')

  // ── 0. 契约镜像防漂移（W-6）：shared SSOT 与 API 本地镜像必须结构一致 ──────
  assertDeepEqual(apiContract.PRINT_SCAN_CAPABILITY_KEYS, sharedContract.PRINT_SCAN_CAPABILITY_KEYS, '能力键列表')
  assertDeepEqual(apiContract.PRINT_SCAN_CAPABILITY_STATUSES, sharedContract.PRINT_SCAN_CAPABILITY_STATUSES, '能力状态列表')
  assertDeepEqual(
    apiContract.IMPLEMENTED_PRINT_SCAN_TASK_TYPES,
    sharedContract.IMPLEMENTED_PRINT_SCAN_TASK_TYPES,
    '已上线任务类型列表',
  )
  for (const st of apiContract.PRINT_SCAN_CAPABILITY_STATUSES) {
    if (apiContract.canCreateFormalPrintScanTask(st) !== sharedContract.canCreateFormalPrintScanTask(st)) {
      fail(`canCreateFormalPrintScanTask 在 shared 与 API 镜像间行为不一致（status=${st}）`)
    }
  }
  pass('契约镜像防漂移：shared SSOT 与 API 本地镜像结构与语义一致')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const capabilities = new TerminalCapabilitiesService(prisma)
  const printScan = new AdminPrintScanService(prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `term_vps_${suffix}`
  const createdPrintTaskIds: string[] = []
  const createdScanTaskIds: string[] = []
  const createdOrderIds: string[] = []
  const createdPaymentAttemptIds: string[] = []

  try {
    await prisma.terminal.create({
      data: { id: terminalId, terminalCode: `VPS-${suffix}`, agentToken: `tok_vps_${suffix}`, deviceFingerprint: 'fp' },
    })

    // ── 1. 能力开关 ──────────────────────────────────────────────────────────
    await expectHttpError(
      () => capabilities.upsert(terminalId, 'teleport', 'available', undefined, 'admin_1'),
      400, '非法能力键 → 400',
    )
    await expectHttpError(
      () => capabilities.upsert(terminalId, 'scan', 'enabled', undefined, 'admin_1'),
      400, '非法能力状态 → 400（不接受枚举外取值）',
    )
    await expectHttpError(
      () => capabilities.upsert(`missing_${suffix}`, 'scan', 'available', undefined, 'admin_1'),
      404, '不存在的终端 → 404',
    )

    const created = await capabilities.upsert(terminalId, 'scan', 'available', ' 真机已验收 ', 'admin_1')
    if (created.oldStatus !== null) fail('首次 upsert 的 oldStatus 应为 null（供审计区分创建/更新）')
    if (created.capability.status !== 'available' || created.capability.note !== '真机已验收') {
      fail('upsert 应保存状态并 trim 备注')
    }
    pass('upsert 创建能力配置（oldStatus=null，备注已 trim）')

    const updated = await capabilities.upsert(terminalId, 'scan', 'maintenance', undefined, 'admin_2')
    if (updated.oldStatus !== 'available') fail('二次 upsert 的 oldStatus 应为上一次的状态')
    if (updated.capability.note !== null) fail('未传备注时应清空为 null，不残留旧备注')
    pass('upsert 更新能力配置（oldStatus=available，备注清空）')

    const listed = await capabilities.listForTerminal(terminalId)
    if (listed.capabilities.length !== PRINT_SCAN_CAPABILITY_KEYS.length) {
      fail(`list 应返回全部 ${PRINT_SCAN_CAPABILITY_KEYS.length} 个能力键`)
    }
    const scanCap = listed.capabilities.find((c) => c.capabilityKey === 'scan')
    const usbCap = listed.capabilities.find((c) => c.capabilityKey === 'usb_import')
    if (!scanCap?.configured || scanCap.status !== 'maintenance') fail('已配置键应 configured=true 且状态正确')
    if (usbCap?.configured !== false || usbCap.status !== 'not_verified') {
      fail('未配置键应 configured=false 且状态为 not_verified（保守默认）')
    }
    pass('list 返回全部能力键，未配置键 configured=false / not_verified')

    // DB 出现枚举外脏值 → fail-closed 归 not_verified，不放大成可用
    await prisma.terminalCapability.update({
      where: { terminalId_capabilityKey: { terminalId, capabilityKey: 'scan' } },
      data: { status: 'totally_bogus' },
    })
    const dirty = await capabilities.listForTerminal(terminalId)
    if (dirty.capabilities.find((c) => c.capabilityKey === 'scan')?.status !== 'not_verified') {
      fail('DB 脏状态必须 fail-closed 归入 not_verified')
    }
    pass('DB 脏状态 fail-closed 归 not_verified（不放大成可用）')

    // ── 2. 统一任务中心诚实性 ────────────────────────────────────────────────
    for (const notImplemented of ['copy', 'photo', 'material_pack', 'format_conversion', 'signature_stamp']) {
      const page = await printScan.listTasks({ type: notImplemented, page: 1, pageSize: 20 })
      if (page.implemented !== false || page.items.length !== 0 || page.pagination.total !== 0) {
        fail(`未上线类型 ${notImplemented} 必须 implemented=false 且 items 恒空`)
      }
    }
    pass('五个未上线任务类型全部 implemented=false 且不伪造行数据')

    await expectHttpError(() => printScan.listTasks({ type: 'warp_drive', page: 1, pageSize: 20 }), 400, '未知任务类型 → 400')

    const failedTaskId = `pt_vps_fail_${suffix}`
    const corruptTaskId = `pt_vps_corrupt_${suffix}`
    createdPrintTaskIds.push(failedTaskId, corruptTaskId)
    // 真实 FileObject + 真实签名 URL：重试链路要求文件存在且能重签
    const fileId = `file_vps_${suffix}`
    await prisma.fileObject.create({
      data: {
        id: fileId, storageKey: `verify/${fileId}.pdf`, filename: '验证文件.pdf',
        mimeType: 'application/pdf', sizeBytes: 3, sha256: '', purpose: 'print_doc',
      },
    })
    const originalSignedUrl = signFileUrl(fileId, 60_000).url
    await prisma.printTask.createMany({
      data: [
        {
          id: failedTaskId, terminalId, fileUrl: originalSignedUrl, fileMd5: 'deadbeef',
          paramsJson: JSON.stringify({ fileName: '验证文件.pdf', copies: 2, colorMode: 'black_white', paperSize: 'A4' }),
          status: 'failed', errorCode: 'printer_offline', errorMessage: 'C:\\secret\\path stack trace',
          completedAt: new Date(),
        },
        {
          id: corruptTaskId, terminalId, fileUrl: 'https://internal/secret-url-2', fileMd5: 'cafebabe',
          paramsJson: '{not-json', status: 'pending',
        },
      ],
    })
    const orderId = `order_vps_${suffix}`
    createdOrderIds.push(orderId)
    await prisma.order.create({
      data: {
        id: orderId, orderNo: `NO-VPS-${suffix}`, type: 'print', printTaskId: failedTaskId,
        payStatus: 'paid', taskStatus: 'failed', amountCents: 100,
      },
    })

    const printPage = await printScan.listTasks({ type: 'print', terminalId, page: 1, pageSize: 20 })
    if (printPage.items.length !== 2 || printPage.pagination.total !== 2) fail('print 列表应返回该终端 2 条任务')
    const serialized = JSON.stringify(printPage)
    for (const secret of ['secret-url', 'deadbeef', 'cafebabe', 'stack trace', 'paramsJson', '/files/', 'sig=', fileId]) {
      if (serialized.includes(secret)) fail(`print 列表不得泄露敏感字段：${secret}`)
    }
    const failedRow = printPage.items.find((i) => i.taskId === failedTaskId)
    if (failedRow?.type !== 'print' || failedRow.fileName !== '验证文件.pdf' || failedRow.errorCode !== 'printer_offline') {
      fail('print 行应含安全摘要（fileName/errorCode）')
    }
    const corruptRow = printPage.items.find((i) => i.taskId === corruptTaskId)
    if (corruptRow?.type !== 'print' || corruptRow.fileName !== null) fail('损坏 paramsJson → 摘要字段 null 且不抛错')
    pass('print 列表：安全摘要正确，敏感字段零泄露，损坏 params 不抛错')

    const detail = await printScan.getTaskDetail('print', failedTaskId)
    if (detail.type !== 'print' || detail.orderNo !== `NO-VPS-${suffix}`) fail('print 详情应关联订单号')
    const detailSerialized = JSON.stringify(detail)
    for (const secret of ['secret-url', 'deadbeef', 'stack trace', '/files/', 'sig=', fileId]) {
      if (detailSerialized.includes(secret)) fail(`print 详情不得泄露敏感字段：${secret}`)
    }
    pass('print 详情：关联订单 + 无敏感泄露（fileUrl/fileMd5/错误原文全覆盖）')

    // ── 3. 类型感知动作 ─────────────────────────────────────────────────────
    await expectHttpError(() => printScan.applyAction('print', failedTaskId, 'cancel'), 400, 'print.cancel → 400（不支持的组合）')
    await expectHttpError(() => printScan.applyAction('scan', failedTaskId, 'retry'), 400, 'scan.retry → 400（不支持的组合）')
    await expectHttpError(() => printScan.applyAction('document_process', failedTaskId, 'retry'), 400, 'document_process 动作 → 400')
    await expectHttpError(() => printScan.applyAction('print', corruptTaskId, 'retry'), 409, '非 failed 状态 print.retry → 409')
    await expectHttpError(() => printScan.applyAction('print', `missing_${suffix}`, 'retry'), 404, '不存在任务 retry → 404')

    const retried = await printScan.applyAction('print', failedTaskId, 'retry')
    if (retried.fromStatus !== 'failed' || retried.toStatus !== 'pending') fail('retry 应 failed → pending')
    const afterRetry = await prisma.printTask.findUnique({ where: { id: failedTaskId } })
    if (afterRetry?.status !== 'pending' || afterRetry.errorCode !== null || afterRetry.claimExpiry !== null) {
      fail('retry 后任务应回 pending 且清空 claim/错误字段')
    }
    if (afterRetry.completedAt !== null) fail('retry 必须清空 failed 时写入的 completedAt')
    if (afterRetry.fileUrl === originalSignedUrl) fail('retry 必须重新签发 fileUrl（原签名多半已过期）')
    const freshExpires = new URL(afterRetry.fileUrl, 'http://internal.local').searchParams.get('expires')
    if (!freshExpires || Number(freshExpires) < Date.now() + 20 * 60 * 1000) {
      fail('重签后的 fileUrl 应带 ≥20 分钟有效期，供 Agent claim 后下载')
    }
    const orderAfter = await prisma.order.findUnique({ where: { id: orderId } })
    if (orderAfter?.taskStatus !== 'pending') fail('retry 应联动 Order.taskStatus → pending')
    const log = await prisma.printTaskStatusLog.findFirst({
      where: { taskId: failedTaskId, fromStatus: 'failed', toStatus: 'pending' },
    })
    if (!log || log.errorCode !== 'admin_retry') fail('retry 应写 PrintTaskStatusLog（errorCode=admin_retry）')
    pass('print.retry：failed→pending + Order 联动 + 状态日志')

    await expectHttpError(() => printScan.applyAction('print', failedTaskId, 'retry'), 409, '重复 retry（已 pending）→ 409')

    // 退款订单拒绝重试（防"退了钱还出纸"）
    const refundedTaskId = `pt_vps_refund_${suffix}`
    createdPrintTaskIds.push(refundedTaskId)
    await prisma.printTask.create({
      data: { id: refundedTaskId, terminalId, fileUrl: signFileUrl(fileId, 60_000).url, fileMd5: 'x', status: 'failed' },
    })
    const refundedOrderId = `order_vps_refund_${suffix}`
    createdOrderIds.push(refundedOrderId)
    await prisma.order.create({
      data: {
        id: refundedOrderId, orderNo: `NO-VPSR-${suffix}`, type: 'print', printTaskId: refundedTaskId,
        payStatus: 'refunded', taskStatus: 'failed', amountCents: 100,
      },
    })
    await expectHttpError(() => printScan.applyAction('print', refundedTaskId, 'retry'), 409, '已退款订单的任务 retry → 409')

    // 文件已按隐私策略清理 → 拒绝重试
    const gonefileTaskId = `pt_vps_gone_${suffix}`
    createdPrintTaskIds.push(gonefileTaskId)
    const goneFileId = `file_vps_gone_${suffix}`
    await prisma.fileObject.create({
      data: {
        id: goneFileId, storageKey: `verify/${goneFileId}.pdf`, filename: 'g.pdf',
        mimeType: 'application/pdf', sizeBytes: 3, sha256: '', purpose: 'print_doc', deletedAt: new Date(),
      },
    })
    await prisma.printTask.create({
      data: { id: gonefileTaskId, terminalId, fileUrl: signFileUrl(goneFileId, 60_000).url, fileMd5: 'x', status: 'failed' },
    })
    await expectHttpError(() => printScan.applyAction('print', gonefileTaskId, 'retry'), 409, '文件已清理的任务 retry → 409')
    await prisma.fileObject.delete({ where: { id: goneFileId } }).catch(() => undefined)

    // 真实并发 CAS：两个 retry 同时打同一 failed 任务，只允许一个成功
    const raceTaskId = `pt_vps_race_${suffix}`
    createdPrintTaskIds.push(raceTaskId)
    await prisma.printTask.create({
      data: { id: raceTaskId, terminalId, fileUrl: signFileUrl(fileId, 60_000).url, fileMd5: 'x', status: 'failed' },
    })
    const raceResults = await Promise.allSettled([
      printScan.applyAction('print', raceTaskId, 'retry'),
      printScan.applyAction('print', raceTaskId, 'retry'),
    ])
    const raceOk = raceResults.filter((r) => r.status === 'fulfilled').length
    if (raceOk !== 1) fail(`并发 retry 应恰好一个成功，实际成功 ${raceOk} 个`)
    pass('并发 retry CAS：两个并发请求恰好一个成功')

    // ── 4. Admin 受控关闭未付款打印任务（独立于 scan.cancel）───────────────
    const closeOperatorId = `admin_close_${suffix}`
    await prisma.user.create({
      data: {
        id: closeOperatorId,
        username: `close-admin-${suffix}`,
        passwordHash: 'verify',
        name: '受控关闭验证管理员',
        role: 'admin',
      },
    })

    async function createCloseFixture(
      name: string,
      options: {
        taskStatus?: string
        claimedAt?: Date | null
        claimExpiry?: Date | null
        order?: false | { payStatus?: string; taskStatus?: string; amountCents?: number }
        paymentAttemptStatus?: 'created' | 'pending' | 'expired' | 'success' | 'failed'
      } = {},
    ) {
      const taskId = `pt_close_${name}_${suffix}`
      createdPrintTaskIds.push(taskId)
      const task = await prisma.printTask.create({
        data: {
          id: taskId,
          terminalId,
          fileUrl: `internal://close-${name}`,
          fileMd5: name,
          status: options.taskStatus ?? 'pending',
          claimedAt: options.claimedAt,
          claimExpiry: options.claimExpiry,
        },
      })
      if (options.order !== false) {
        const orderId = `order_close_${name}_${suffix}`
        createdOrderIds.push(orderId)
        await prisma.order.create({
          data: {
            id: orderId,
            orderNo: `NO-CLOSE-${name}-${suffix}`,
            type: 'print',
            printTaskId: taskId,
            terminalId,
            payStatus: options.order?.payStatus ?? 'unpaid',
            taskStatus: options.order?.taskStatus ?? 'pending',
            amountCents: options.order?.amountCents ?? 137,
          },
        })
        if (options.paymentAttemptStatus) {
          await prisma.paymentAttempt.create({
            data: {
              orderId,
              channel: 'sandbox',
              amountCents: options.order?.amountCents ?? 137,
              status: options.paymentAttemptStatus,
            },
          })
        }
      }
      return task
    }

    const closeCandidate = await createCloseFixture('success')
    const closeDetail = await printScan.getTaskDetail('print', closeCandidate.id)
    if (
      closeDetail.type !== 'print' ||
      closeDetail.closeUnpaidEligible !== true ||
      closeDetail.closeUnpaidBlockReason !== null
    ) fail('合格未付款 pending 任务详情必须明确 closeUnpaidEligible=true 且不泄露阻断细节')
    const closed = await printScan.closeUnpaidPrintTask(
      closeCandidate.id,
      { reason: '管理员核对后关闭未付款且未领取的测试打印任务', expectedUpdatedAt: closeCandidate.updatedAt.toISOString() },
      { actorId: closeOperatorId, actorRole: 'admin' },
    )
    if (closed.idempotent || closed.toStatus !== 'cancelled') fail('首次受控关闭必须返回 pending→cancelled 且非幂等')
    const [closeAfterTask, closeAfterOrder, closeLogs, closeAudits] = await Promise.all([
      prisma.printTask.findUnique({ where: { id: closeCandidate.id } }),
      prisma.order.findUnique({ where: { printTaskId: closeCandidate.id } }),
      prisma.printTaskStatusLog.count({ where: { taskId: closeCandidate.id, errorCode: 'ADMIN_UNPAID_PRINT_TASK_CLOSED' } }),
      prisma.auditLog.count({ where: { targetId: closeCandidate.id, action: 'print_task.admin_unpaid_closed' } }),
    ])
    if (
      closeAfterTask?.status !== 'cancelled' ||
      closeAfterTask.errorCode !== 'ADMIN_UNPAID_PRINT_TASK_CLOSED' ||
      closeAfterOrder?.payStatus !== 'closed' ||
      closeAfterOrder.taskStatus !== 'cancelled' ||
      closeAfterOrder.amountCents !== 137 ||
      closeLogs !== 1 ||
      closeAudits !== 1
    ) fail('成功关闭必须同事务写任务/订单/状态日志/审计，且保留订单金额来源')
    pass('受控关闭：pending→cancelled，unpaid→closed，日志与审计同事务且金额快照不变')

    const idempotent = await printScan.closeUnpaidPrintTask(
      closeCandidate.id,
      { reason: '相同关闭请求重试，不得重复状态日志或审计记录', expectedUpdatedAt: closeCandidate.updatedAt.toISOString() },
      { actorId: closeOperatorId, actorRole: 'admin' },
    )
    const [logsAfterIdempotent, auditsAfterIdempotent] = await Promise.all([
      prisma.printTaskStatusLog.count({ where: { taskId: closeCandidate.id, errorCode: 'ADMIN_UNPAID_PRINT_TASK_CLOSED' } }),
      prisma.auditLog.count({ where: { targetId: closeCandidate.id, action: 'print_task.admin_unpaid_closed' } }),
    ])
    if (!idempotent.idempotent || logsAfterIdempotent !== 1 || auditsAfterIdempotent !== 1) {
      fail('同一固定关闭终态只允许幂等返回，不得重复日志或审计')
    }
    pass('固定关闭终态幂等返回且无重复副作用')

    const noOrder = await createCloseFixture('no-order', { order: false })
    await expectHttpErrorCode(
      () => printScan.closeUnpaidPrintTask(noOrder.id, { reason: '太短', expectedUpdatedAt: noOrder.updatedAt.toISOString() }, { actorId: closeOperatorId, actorRole: 'admin' }),
      400, 'ADMIN_UNPAID_CLOSE_REASON_INVALID', '关闭原因少于 10 字符 → 400',
    )
    await expectHttpErrorCode(
      () => printScan.closeUnpaidPrintTask(noOrder.id, { reason: '严格 ISO 版本戳格式不合法时不得进入关闭事务', expectedUpdatedAt: '2026-07-13' }, { actorId: closeOperatorId, actorRole: 'admin' }),
      400, 'ADMIN_UNPAID_CLOSE_EXPECTED_UPDATED_AT_INVALID', 'expectedUpdatedAt 非 canonical 严格 ISO → 400',
    )
    await expectHttpErrorCode(
      () => printScan.closeUnpaidPrintTask(noOrder.id, { reason: '任务无关联订单，必须拒绝关闭操作', expectedUpdatedAt: noOrder.updatedAt.toISOString() }, { actorId: closeOperatorId, actorRole: 'admin' }),
      409, 'ADMIN_UNPAID_CLOSE_NOT_ELIGIBLE', '无关联订单 → 拒绝关闭',
    )
    for (const [name, options] of [
      ['paid', { order: { payStatus: 'paid' } }],
      ['paying', { order: { payStatus: 'paying' } }],
      ['claimed', { claimedAt: new Date(), claimExpiry: null }],
      ['claim-expiry', { claimedAt: null, claimExpiry: new Date(Date.now() + 60_000) }],
      ['attempt-created', { paymentAttemptStatus: 'created' as const }],
      ['attempt-pending', { paymentAttemptStatus: 'pending' as const }],
      ['attempt-expired', { paymentAttemptStatus: 'expired' as const }],
      ['attempt-success', { paymentAttemptStatus: 'success' as const }],
      ['attempt-failed', { paymentAttemptStatus: 'failed' as const }],
    ] as const) {
      const fixture = await createCloseFixture(name, options)
      const detail = await printScan.getTaskDetail('print', fixture.id)
      if (detail.type !== 'print' || detail.closeUnpaidEligible !== false || !detail.closeUnpaidBlockReason) {
        fail(`${name} 不合格详情必须返回安全阻断原因`)
      }
      await expectHttpErrorCode(
        () => printScan.closeUnpaidPrintTask(fixture.id, { reason: `验证 ${name} 不允许关闭未付款打印任务的安全阻断`, expectedUpdatedAt: fixture.updatedAt.toISOString() }, { actorId: closeOperatorId, actorRole: 'admin' }),
        409, 'ADMIN_UNPAID_CLOSE_NOT_ELIGIBLE', `${name} → 拒绝关闭`,
      )
    }
    pass('无订单、paid/paying、任一 claim 字段、任意状态支付尝试均拒绝关闭')

    const stale = await createCloseFixture('stale')
    await prisma.printTask.update({
      where: { id: stale.id },
      data: { errorMessage: '更新后的安全占位错误', updatedAt: new Date(stale.updatedAt.getTime() + 1_000) },
    })
    await expectHttpErrorCode(
      () => printScan.closeUnpaidPrintTask(stale.id, { reason: '验证过期版本戳必须阻断受控关闭请求', expectedUpdatedAt: stale.updatedAt.toISOString() }, { actorId: closeOperatorId, actorRole: 'admin' }),
      409, 'ADMIN_UNPAID_CLOSE_STALE', 'expectedUpdatedAt 过期 → 409',
    )

    const closeRace = await createCloseFixture('race')
    const closeRaceResults = await Promise.allSettled([
      printScan.closeUnpaidPrintTask(closeRace.id, { reason: '并发关闭请求一号必须只有一个能提交状态迁移', expectedUpdatedAt: closeRace.updatedAt.toISOString() }, { actorId: closeOperatorId, actorRole: 'admin' }),
      printScan.closeUnpaidPrintTask(closeRace.id, { reason: '并发关闭请求二号应得到幂等而非重复状态变更', expectedUpdatedAt: closeRace.updatedAt.toISOString() }, { actorId: closeOperatorId, actorRole: 'admin' }),
    ])
    const closeRaceSuccesses = closeRaceResults.filter((result) => result.status === 'fulfilled').length
    if (closeRaceSuccesses < 1 || closeRaceSuccesses > 2) fail('并发关闭至少一个成功，另一请求仅可幂等或 CAS 冲突')
    const closeRaceLogs = await prisma.printTaskStatusLog.count({ where: { taskId: closeRace.id, errorCode: 'ADMIN_UNPAID_PRINT_TASK_CLOSED' } })
    if (closeRaceLogs !== 1) fail('并发关闭仅允许一条有效状态日志')
    pass('并发关闭：仅一条有效状态迁移，另一请求幂等返回')

    const claimRace = await createCloseFixture('claim-race')
    await Promise.allSettled([
      printScan.closeUnpaidPrintTask(claimRace.id, { reason: '管理员关闭与 Agent 领取竞态不得覆盖对方状态', expectedUpdatedAt: claimRace.updatedAt.toISOString() }, { actorId: closeOperatorId, actorRole: 'admin' }),
      prisma.printTask.updateMany({
        where: { id: claimRace.id, status: 'pending', claimedAt: null, claimExpiry: null },
        data: { status: 'claimed', claimedAt: new Date(), claimExpiry: new Date(Date.now() + 60_000) },
      }),
    ])
    const claimRaceAfter = await prisma.printTask.findUnique({ where: { id: claimRace.id } })
    const claimRaceOrder = await prisma.order.findUnique({ where: { printTaskId: claimRace.id } })
    const claimWon = claimRaceAfter?.status === 'claimed' && claimRaceOrder?.payStatus === 'unpaid' && claimRaceOrder.taskStatus === 'pending'
    const closeWon = claimRaceAfter?.status === 'cancelled' && claimRaceOrder?.payStatus === 'closed' && claimRaceOrder.taskStatus === 'cancelled'
    if (!claimWon && !closeWon) fail('Agent claim 与关闭竞态后只能保留一个一致的终态')
    pass('Agent claim 与关闭竞态由 PrintTask CAS 保持一致')

    const auditRollback = await createCloseFixture('audit-rollback')
    try {
      await printScan.closeUnpaidPrintTask(
        auditRollback.id,
        { reason: '审计外键失败时必须整体回滚受控关闭事务', expectedUpdatedAt: auditRollback.updatedAt.toISOString() },
        { actorId: `missing_admin_${suffix}`, actorRole: 'admin' },
      )
      fail('tx.auditLog.create 失败必须拒绝并触发回滚')
    } catch {
      pass('tx.auditLog.create 失败 → 拒绝关闭')
    }
    const [rollbackTask, rollbackOrder] = await Promise.all([
      prisma.printTask.findUnique({ where: { id: auditRollback.id } }),
      prisma.order.findUnique({ where: { printTaskId: auditRollback.id } }),
    ])
    if (rollbackTask?.status !== 'pending' || rollbackOrder?.payStatus !== 'unpaid' || rollbackOrder.taskStatus !== 'pending') {
      fail('审计失败不得留下半完成的关闭状态')
    }
    pass('tx.auditLog.create 失败会回滚任务和订单更新')

    const orderStatus = new OrderStatusService(prisma, new AuditService(prisma))
    await expectHttpError(
      () => orderStatus.markPaid(closeAfterOrder!.id, { paymentSource: 'offline' }),
      400, 'closed 订单既有 markPaid 路径不能继续付款',
    )
    process.env['PAYMENT_SESSION_SECRET'] ||= 'verify-admin-print-scan-payment-session-secret-0123456789'
    const payment = new OnlinePaymentService(
      prisma,
      new AuditService(prisma),
      orderStatus,
      new PaymentProviderRegistry([new SandboxPaymentProvider('verify-admin-print-scan-sandbox-secret-0123456789')]),
    )
    const paymentRace = await createCloseFixture('payment-race')
    const paymentRaceOrder = await prisma.order.findUniqueOrThrow({ where: { printTaskId: paymentRace.id } })
    const paymentRaceToken = createPaymentSessionToken({
      orderId: paymentRaceOrder.id,
      orderNo: paymentRaceOrder.orderNo,
      terminalId: paymentRaceOrder.terminalId,
      amountCents: paymentRaceOrder.amountCents,
      printTaskId: paymentRace.id,
    })
    await Promise.allSettled([
      printScan.closeUnpaidPrintTask(paymentRace.id, { reason: '管理员关闭与支付出码竞态不得产生付款后取消', expectedUpdatedAt: paymentRace.updatedAt.toISOString() }, { actorId: closeOperatorId, actorRole: 'admin' }),
      payment.createPayAttempt(paymentRaceOrder.id, paymentRaceToken),
    ])
    const [paymentRaceTask, paymentRaceAfterOrder, paymentRaceAttempts] = await Promise.all([
      prisma.printTask.findUnique({ where: { id: paymentRace.id } }),
      prisma.order.findUnique({ where: { id: paymentRaceOrder.id } }),
      prisma.paymentAttempt.findMany({ where: { orderId: paymentRaceOrder.id }, select: { id: true } }),
    ])
    createdPaymentAttemptIds.push(...paymentRaceAttempts.map((attempt) => attempt.id))
    const paymentWon = paymentRaceTask?.status === 'pending' && paymentRaceAfterOrder?.payStatus === 'paying' && paymentRaceAttempts.length === 1
    const closeWonPaymentRace = paymentRaceTask?.status === 'cancelled' && paymentRaceAfterOrder?.payStatus === 'closed' && paymentRaceAttempts.length === 0
    if (!paymentWon && !closeWonPaymentRace) fail('支付出码与关闭竞态后不得出现付款中且任务已取消')
    pass('支付出码与关闭竞态由 Order CAS 保持一致')
    const closedPaymentToken = createPaymentSessionToken({
      orderId: closeAfterOrder!.id,
      orderNo: closeAfterOrder!.orderNo,
      terminalId: closeAfterOrder!.terminalId,
      amountCents: closeAfterOrder!.amountCents,
      printTaskId: closeCandidate.id,
    })
    await expectHttpError(
      () => payment.createPayAttempt(closeAfterOrder!.id, closedPaymentToken),
      400, 'closed 订单既有 create payment 路径不能继续出码',
    )
    pass('关闭后的订单既有 mark-paid/create payment 路径均不能继续付款')

    // ── 5. 服务端能力门禁（C-1 + Task 11 模式语义）──────────────────────────
    // 显式钉住模式再断言：不读运行机器的 .env（在合法配置为 strict 的机器上
    // 跑本脚本不得误报），用例间用测试专用开关切换，结束后还原。
    setPrintScanCapabilityModeForTest('managed')
    await capabilities.assertUserTaskAllowed(terminalId, 'document_print')
    pass('未配置能力 + managed 模式 → 门禁放行（保持既有闭环不断服）')
    setPrintScanCapabilityModeForTest('strict')
    await expectHttpErrorCode(
      () => capabilities.assertUserTaskAllowed(terminalId, 'document_print'),
      403, 'CAPABILITY_NOT_CONFIGURED',
      '未配置能力 + strict 模式 → 门禁 fail-closed 403（错误码精确断言）',
    )
    setPrintScanCapabilityModeForTest('managed')
    await capabilities.upsert(terminalId, 'document_print', 'maintenance', '维护', 'admin_1')
    await expectHttpError(() => capabilities.assertUserTaskAllowed(terminalId, 'document_print'), 403, '配置为 maintenance → 门禁 403')
    await prisma.terminalCapability.update({
      where: { terminalId_capabilityKey: { terminalId, capabilityKey: 'document_print' } },
      data: { status: 'weird_dirty_value' },
    })
    await expectHttpError(() => capabilities.assertUserTaskAllowed(terminalId, 'document_print'), 403, 'DB 脏状态 → 门禁 fail-closed 403')
    await capabilities.upsert(terminalId, 'document_print', 'available', undefined, 'admin_1')
    setPrintScanCapabilityModeForTest('managed')
    await capabilities.assertUserTaskAllowed(terminalId, 'document_print')
    setPrintScanCapabilityModeForTest('strict')
    await capabilities.assertUserTaskAllowed(terminalId, 'document_print')
    setPrintScanCapabilityModeForTest('managed')
    pass('配置为 available → managed/strict 两种模式下门禁均放行')

    // 真实集成：ScanTasksService.create 在 scan 配为非 available 时拒绝
    await capabilities.upsert(terminalId, 'scan', 'maintenance', '扫描仪送修', 'admin_1')
    const scanSvc = new ScanTasksService(prisma, null as never, capabilities)
    await expectHttpError(
      () => scanSvc.create({ terminalId, scanType: 'document' } as never, null),
      403, 'ScanTasksService.create 被能力门禁拦截（maintenance → 403）',
    )
    // PrintJobsService 依赖较重，不在本脚本实例化；用源码断言证明创建边界已接线
    const printJobsSource = readFileSync(join(__dirname, '../src/print-jobs/print-jobs.service.ts'), 'utf-8')
    if (!printJobsSource.includes("assertUserTaskAllowed(targetTerminalId, 'document_print')")) {
      fail('PrintJobsService.create 必须接入能力门禁 assertUserTaskAllowed')
    }
    pass('PrintJobsService.create 已接入能力门禁（源码断言 + 门禁语义已直测）')

    const scanTask = await prisma.scanTask.create({
      data: {
        terminalId, scanType: 'document', status: 'waiting',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    })
    createdScanTaskIds.push(scanTask.id)
    const cancelled = await printScan.applyAction('scan', scanTask.id, 'cancel')
    if (cancelled.fromStatus !== 'waiting' || cancelled.toStatus !== 'cancelled') fail('scan.cancel 应 waiting → cancelled')
    const afterCancel = await prisma.scanTask.findUnique({ where: { id: scanTask.id } })
    if (afterCancel?.status !== 'cancelled') fail('scan.cancel 后 DB 状态应为 cancelled')
    pass('scan.cancel：waiting→cancelled（CAS）')

    await expectHttpError(() => printScan.applyAction('scan', scanTask.id, 'cancel'), 409, '重复 cancel（已 cancelled）→ 409')

    console.log('\n✅ ALL PASS — Task 10 admin print-scan invariants hold')
  } finally {
    setPrintScanCapabilityModeForTest(null)
    // 清理本脚本创建的数据（依赖 Terminal onDelete: Cascade 清 capability/scan/print）
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [...createdPrintTaskIds, ...createdPaymentAttemptIds] } } }).catch(() => undefined)
    await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: createdOrderIds } } }).catch(() => undefined)
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => undefined)
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: createdPrintTaskIds } } }).catch(() => undefined)
    await prisma.printTask.deleteMany({ where: { id: { in: createdPrintTaskIds } } }).catch(() => undefined)
    await prisma.scanTask.deleteMany({ where: { id: { in: createdScanTaskIds } } }).catch(() => undefined)
    await prisma.fileObject.deleteMany({ where: { id: { in: [`file_vps_${suffix}`, `file_vps_gone_${suffix}`] } } }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: terminalId } }).catch(() => undefined)
    await prisma.user.deleteMany({ where: { id: { startsWith: `admin_close_${suffix}` } } }).catch(() => undefined)
    await prisma.onModuleDestroy()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
