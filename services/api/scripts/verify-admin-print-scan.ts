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
import 'reflect-metadata'
import 'dotenv/config'
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-admin-print-scan-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-admin-print-scan-action-secret-0123456789'
import { randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalCapabilitiesService, setPrintScanCapabilityModeForTest } from '../src/terminals/terminal-capabilities.service'
import { AdminPrintScanService } from '../src/admin-print-scan/admin-print-scan.service'
import { ScanTasksService } from '../src/scan-tasks/scan-tasks.service'
import { signFileUrl } from '../src/files/signing'
import { AuditService } from '../src/audit/audit.service'
import { TerminalAgentService } from '../src/terminals/terminals-agent.service'
import { OnlinePaymentService } from '../src/payment/online-payment.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { createPaymentSessionToken } from '../src/payment/payment-session-token'
import { PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import { SandboxPaymentProvider } from '../src/payment/providers/sandbox-payment.provider'
import { readFileSync } from 'fs'
import { join } from 'path'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { AdminTerminalsController } from '../src/terminals/admin-terminals.controller'
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
  message?: string,
): Promise<void> {
  try {
    await fn()
  } catch (e) {
    const got = (e as { getStatus?: () => number }).getStatus?.()
    const body = (e as { getResponse?: () => unknown }).getResponse?.() as
      | { error?: { code?: string; message?: string } }
      | undefined
    const gotCode = body?.error?.code
    const gotMessage = body?.error?.message
    if (got === status && gotCode === code && (message === undefined || gotMessage === message)) {
      pass(label)
      return
    }
    fail(`${label} — 期望 HTTP ${status}+${code}${message ? `「${message}」` : ''}，实际 ${String(got)}+${String(gotCode)}「${String(gotMessage)}」`)
  }
  fail(`${label} — 期望抛出 HTTP ${status}（${code}），实际未抛错`)
}

async function main() {
  console.log('\n=== Task 10 Admin print-scan 任务中心 + 能力开关验证 ===')

  const serviceSource = readFileSync(join(__dirname, '../src/admin-print-scan/admin-print-scan.service.ts'), 'utf8')
  if (!/this\.prisma\.\$transaction[\s\S]*this\.audit\.writeRequired/s.test(serviceSource)) {
    fail('API-26：admin print-scan 写动作必须在事务内 writeRequired，审计失败不得返回 success')
  }
  pass('API-26：admin print-scan 写动作与 required audit 同事务')

  // ── 0. 契约镜像防漂移（W-6）：shared SSOT 与 API 本地镜像必须结构一致 ──────
  assertDeepEqual(apiContract.PRINT_SCAN_CAPABILITY_KEYS, sharedContract.PRINT_SCAN_CAPABILITY_KEYS, '能力键列表')
  assertDeepEqual(apiContract.PRINT_SCAN_CAPABILITY_STATUSES, sharedContract.PRINT_SCAN_CAPABILITY_STATUSES, '能力状态列表')
  assertDeepEqual(
    apiContract.IMPLEMENTED_PRINT_SCAN_TASK_TYPES,
    sharedContract.IMPLEMENTED_PRINT_SCAN_TASK_TYPES,
    '已上线任务类型列表',
  )
  assertDeepEqual(
    apiContract.DEPRECATED_CAPABILITY_ALIAS,
    sharedContract.DEPRECATED_CAPABILITY_ALIAS,
    '能力键弃用别名映射',
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
  const versionTerminalIds: string[] = []

  async function expectRetryReason(taskId: string, message: string | null, label: string): Promise<void> {
    const detail = await printScan.getTaskDetail('print', taskId)
    if (detail.type !== 'print' || detail.retryBlockedReason !== message) {
      fail(`${label} 详情 retryBlockedReason 期望 ${String(message)}，实际 ${detail.type === 'print' ? String(detail.retryBlockedReason) : detail.type}`)
    }
    const page = await printScan.listTasks({
      type: 'print',
      ...(detail.terminalId ? { terminalId: detail.terminalId } : { status: 'failed' }),
      page: 1,
      pageSize: 50,
    })
    const row = page.items.find((item) => item.taskId === taskId)
    if (!row || row.type !== 'print' || row.retryBlockedReason !== message) {
      fail(`${label} 列表 retryBlockedReason 期望 ${String(message)}，实际 ${row && row.type === 'print' ? String(row.retryBlockedReason) : '缺失'}`)
    }
  }

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `term_vps_${suffix}`
  const retiredTerminalId = `term_vps_retired_${suffix}`
  const createdPrintTaskIds: string[] = []
  const createdScanTaskIds: string[] = []
  const createdOrderIds: string[] = []
  const createdPaymentAttemptIds: string[] = []

  try {
    await prisma.terminal.create({
      data: { id: terminalId, terminalCode: `VPS-${suffix}`, agentToken: `tok_vps_${suffix}`, deviceFingerprint: 'fp' },
    })
    await prisma.terminalHeartbeat.create({
      data: { terminalId, agentVersion: '0.4.13-production' },
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

    // ── 1b. cloud_upload → phone_upload 词汇债兼容映射（2026-07-12 D4，只读兼容）──
    await capabilities.upsert(terminalId, 'cloud_upload', 'maintenance', '历史云上传送修', 'admin_1')
    const withLegacyOnly = await capabilities.listForTerminal(terminalId)
    const phoneCapViaLegacy = withLegacyOnly.capabilities.find((c) => c.capabilityKey === 'phone_upload')
    const cloudCapRaw = withLegacyOnly.capabilities.find((c) => c.capabilityKey === 'cloud_upload')
    if (!phoneCapViaLegacy?.configured || phoneCapViaLegacy.status !== 'maintenance' || phoneCapViaLegacy.note !== '历史云上传送修') {
      fail('phone_upload 未自行配置时应回退读取历史 cloud_upload 的状态/备注')
    }
    if (!cloudCapRaw?.configured || cloudCapRaw.status !== 'maintenance') {
      fail('cloud_upload 自身行应保持独立展示真实历史值，不应被兼容逻辑覆盖')
    }
    pass('list：phone_upload 未配置时按 cloud_upload 历史配置兼容展示')

    await expectHttpErrorCode(
      () => capabilities.assertUserTaskAllowed(terminalId, 'phone_upload'),
      403, 'CAPABILITY_UNAVAILABLE',
      'assertUserTaskAllowed(phone_upload)：仅有历史 cloud_upload=maintenance 时按其状态拒绝',
    )
    await capabilities.upsert(terminalId, 'cloud_upload', 'available', undefined, 'admin_1')
    await capabilities.assertUserTaskAllowed(terminalId, 'phone_upload')
    pass('assertUserTaskAllowed(phone_upload)：历史 cloud_upload=available 时按其状态放行')

    // phone_upload 一旦有自己的真实配置，应优先于 cloud_upload 兼容值（兼容仅是兜底，不是覆盖）
    await capabilities.upsert(terminalId, 'phone_upload', 'maintenance', '本机维护', 'admin_1')
    await expectHttpErrorCode(
      () => capabilities.assertUserTaskAllowed(terminalId, 'phone_upload'),
      403, 'CAPABILITY_UNAVAILABLE',
      'phone_upload 自身已配置后优先于 cloud_upload 兼容值',
    )
    const bothConfigured = await capabilities.listForTerminal(terminalId)
    const phoneCapOwn = bothConfigured.capabilities.find((c) => c.capabilityKey === 'phone_upload')
    if (phoneCapOwn?.status !== 'maintenance' || phoneCapOwn.note !== '本机维护') {
      fail('phone_upload 自身配置存在时，list 不应再回退读取 cloud_upload')
    }
    pass('list：phone_upload 自身有配置时不再回退读取 cloud_upload（兼容仅兜底不覆盖）')

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
    if (failedRow.retryBlockedReason !== null) {
      fail(`已付失败且终端版本够新时列表 retryBlockedReason 应为 null，实际 ${failedRow.retryBlockedReason}`)
    }
    const corruptRow = printPage.items.find((i) => i.taskId === corruptTaskId)
    if (corruptRow?.type !== 'print' || corruptRow.fileName !== null) fail('损坏 paramsJson → 摘要字段 null 且不抛错')
    if (corruptRow?.type === 'print' && corruptRow.retryBlockedReason !== '只有失败的打印任务可以重新提交') {
      fail(`非失败任务的列表 retryBlockedReason 不正确：${corruptRow?.type === 'print' ? corruptRow.retryBlockedReason : ''}`)
    }
    pass('print 列表：安全摘要正确，敏感字段零泄露，损坏 params 不抛错')

    const detail = await printScan.getTaskDetail('print', failedTaskId)
    if (detail.type !== 'print' || detail.orderNo !== `NO-VPS-${suffix}`) fail('print 详情应关联订单号')
    const detailSerialized = JSON.stringify(detail)
    for (const secret of ['secret-url', 'deadbeef', 'stack trace', '/files/', 'sig=', fileId]) {
      if (detailSerialized.includes(secret)) fail(`print 详情不得泄露敏感字段：${secret}`)
    }
    if (detail.type === 'print' && detail.retryBlockedReason !== null) {
      fail(`已付失败详情 retryBlockedReason 应为 null，实际 ${detail.retryBlockedReason}`)
    }
    pass('print 详情：关联订单 + 无敏感泄露（fileUrl/fileMd5/错误原文全覆盖），可重试时 retryBlockedReason 为 null')

    // ── 3. 类型感知动作 ─────────────────────────────────────────────────────
    await expectHttpError(() => printScan.applyAction('print', failedTaskId, 'cancel'), 400, 'print.cancel → 400（不支持的组合）')
    await expectHttpError(() => printScan.applyAction('scan', failedTaskId, 'retry'), 400, 'scan.retry → 400（不支持的组合）')
    await expectHttpError(() => printScan.applyAction('document_process', failedTaskId, 'retry'), 400, 'document_process 动作 → 400')
    await expectHttpErrorCode(
      () => printScan.applyAction('print', corruptTaskId, 'retry'),
      409,
      'PRINT_RETRY_INVALID_STATE',
      '非 failed 状态 print.retry → 409',
      '只有失败的打印任务可以重新提交',
    )
    await expectHttpError(() => printScan.applyAction('print', `missing_${suffix}`, 'retry'), 404, '不存在任务 retry → 404')

    // PrintTask 与 Order 以订单 taskStatus 作为共同状态序列点：任务失败但订单已不在
    // failed 时不得把订单/任务重新打开，避免与退款/领取并发时覆盖更新。
    const outOfSequenceTaskId = `pt_vps_order_not_failed_${suffix}`
    const outOfSequenceOrderId = `order_vps_order_not_failed_${suffix}`
    createdPrintTaskIds.push(outOfSequenceTaskId)
    createdOrderIds.push(outOfSequenceOrderId)
    await prisma.printTask.create({
      data: { id: outOfSequenceTaskId, terminalId, fileUrl: signFileUrl(fileId, 60_000).url, fileMd5: 'x', status: 'failed' },
    })
    await prisma.order.create({
      data: {
        id: outOfSequenceOrderId, orderNo: `NO-VPSO-${suffix}`, type: 'print', printTaskId: outOfSequenceTaskId,
        payStatus: 'paid', taskStatus: 'pending', amountCents: 100,
      },
    })
    await expectRetryReason(outOfSequenceTaskId, '任务状态已变更，请刷新后重试', '订单状态非 failed')
    await expectHttpErrorCode(
      () => printScan.applyAction('print', outOfSequenceTaskId, 'retry'),
      409,
      'PRINT_SCAN_ACTION_INVALID_STATE',
      '订单 taskStatus 非 failed 的任务 retry → 409',
      '任务状态已变更，请刷新后重试',
    )

    // PRINT_JOB_UNCONFIRMED 表示 Agent 无法确认是否已经出纸；必须在任何重签/事务写入前硬拒绝，
    // 否则一次“运维重试”可能导致同一份付费材料重复出纸。
    const unconfirmedTaskId = `pt_vps_unconfirmed_${suffix}`
    const unconfirmedOrderId = `order_vps_unconfirmed_${suffix}`
    createdPrintTaskIds.push(unconfirmedTaskId)
    createdOrderIds.push(unconfirmedOrderId)
    await prisma.printTask.create({
      data: {
        id: unconfirmedTaskId,
        terminalId,
        fileUrl: signFileUrl(fileId, 60_000).url,
        fileMd5: 'unconfirmed-md5',
        status: 'failed',
        errorCode: 'PRINT_JOB_UNCONFIRMED',
        errorMessage: 'Agent restarted before the local spool result could be confirmed',
        completedAt: new Date(),
      },
    })
    await prisma.order.create({
      data: {
        id: unconfirmedOrderId,
        orderNo: `NO-VPSU-${suffix}`,
        type: 'print',
        printTaskId: unconfirmedTaskId,
        payStatus: 'paid',
        taskStatus: 'failed',
        amountCents: 100,
      },
    })
    const [unconfirmedTaskBefore, unconfirmedOrderBefore, unconfirmedLogCountBefore, unconfirmedTaskCountBefore] = await Promise.all([
      prisma.printTask.findUniqueOrThrow({ where: { id: unconfirmedTaskId } }),
      prisma.order.findUniqueOrThrow({ where: { id: unconfirmedOrderId } }),
      prisma.printTaskStatusLog.count({ where: { taskId: unconfirmedTaskId } }),
      prisma.printTask.count(),
    ])
    await expectHttpErrorCode(
      () => printScan.applyAction('print', unconfirmedTaskId, 'retry'),
      409,
      'PRINT_RETRY_UNCONFIRMED_FORBIDDEN',
      'PRINT_JOB_UNCONFIRMED retry → 409 + 精确业务错误码',
      '这单的出纸结果还没确认，请 5 分钟后再试',
    )
    const [unconfirmedTaskAfter, unconfirmedOrderAfter, unconfirmedLogCountAfter, unconfirmedTaskCountAfter] = await Promise.all([
      prisma.printTask.findUniqueOrThrow({ where: { id: unconfirmedTaskId } }),
      prisma.order.findUniqueOrThrow({ where: { id: unconfirmedOrderId } }),
      prisma.printTaskStatusLog.count({ where: { taskId: unconfirmedTaskId } }),
      prisma.printTask.count(),
    ])
    if (
      JSON.stringify(unconfirmedTaskAfter) !== JSON.stringify(unconfirmedTaskBefore) ||
      unconfirmedOrderAfter.payStatus !== unconfirmedOrderBefore.payStatus ||
      unconfirmedOrderAfter.taskStatus !== unconfirmedOrderBefore.taskStatus ||
      unconfirmedLogCountAfter !== unconfirmedLogCountBefore ||
      unconfirmedTaskCountAfter !== unconfirmedTaskCountBefore
    ) {
      fail('PRINT_JOB_UNCONFIRMED retry 拒绝后 PrintTask、Order、状态日志和任务总数必须完全不变')
    }
    await expectRetryReason(unconfirmedTaskId, '这单的出纸结果还没确认，请 5 分钟后再试', '未确认')
    pass('PRINT_JOB_UNCONFIRMED retry 拒绝路径零副作用（任务/订单/日志/任务总数不变）')
    const unconfirmedDetail = await printScan.getTaskDetail('print', unconfirmedTaskId)
    if (unconfirmedDetail.type !== 'print' || unconfirmedDetail.printOutcome !== null) {
      fail('未核查 UNCONFIRMED 详情必须暴露 printOutcome=null')
    }
    await prisma.printTask.update({
      where: { id: unconfirmedTaskId },
      data: { printOutcome: 'printed' },
    })
    const verifiedDetail = await printScan.getTaskDetail('print', unconfirmedTaskId)
    if (verifiedDetail.type !== 'print' || verifiedDetail.printOutcome !== 'printed' || verifiedDetail.errorCode !== 'PRINT_JOB_UNCONFIRMED') {
      fail('核查后详情必须同时保留 UNCONFIRMED 与 printOutcome=printed')
    }
    await expectHttpErrorCode(
      () => printScan.applyAction('print', unconfirmedTaskId, 'retry'),
      409,
      'PRINT_RETRY_UNCONFIRMED_FORBIDDEN',
      '核查后仍禁止 retry',
      '这单的出纸结果还没确认，请 5 分钟后再试',
    )
    pass('print-scan 展示 printOutcome，核查后仍禁止重试且不改 errorCode')

    const partialTaskId = `pt_vps_partial_${suffix}`
    const partialOrderId = `order_vps_partial_${suffix}`
    createdPrintTaskIds.push(partialTaskId)
    createdOrderIds.push(partialOrderId)
    await prisma.printTask.create({
      data: {
        id: partialTaskId,
        terminalId,
        fileUrl: signFileUrl(fileId, 60_000).url,
        fileMd5: 'partial-md5',
        status: 'failed',
        errorCode: 'PARTIAL_OUTPUT',
        completedAt: new Date(),
      },
    })
    await prisma.order.create({
      data: {
        id: partialOrderId,
        orderNo: `NO-VPSP-${suffix}`,
        type: 'print',
        printTaskId: partialTaskId,
        payStatus: 'paid',
        taskStatus: 'failed',
        amountCents: 100,
      },
    })
    const [partialBefore, partialOrderBefore, partialLogsBefore] = await Promise.all([
      prisma.printTask.findUniqueOrThrow({ where: { id: partialTaskId } }),
      prisma.order.findUniqueOrThrow({ where: { id: partialOrderId } }),
      prisma.printTaskStatusLog.count({ where: { taskId: partialTaskId } }),
    ])
    await expectHttpErrorCode(
      () => printScan.applyAction('print', partialTaskId, 'retry'),
      409,
      'PRINT_RETRY_PARTIAL_OUTPUT_FORBIDDEN',
      'PARTIAL_OUTPUT retry → 409 + 精确业务错误码',
      '这单只出了一部分纸',
    )
    const [partialAfter, partialOrderAfter, partialLogsAfter] = await Promise.all([
      prisma.printTask.findUniqueOrThrow({ where: { id: partialTaskId } }),
      prisma.order.findUniqueOrThrow({ where: { id: partialOrderId } }),
      prisma.printTaskStatusLog.count({ where: { taskId: partialTaskId } }),
    ])
    if (
      partialAfter.status !== 'failed'
      || partialAfter.errorCode !== 'PARTIAL_OUTPUT'
      || JSON.stringify(partialAfter) !== JSON.stringify(partialBefore)
      || partialOrderAfter.payStatus !== partialOrderBefore.payStatus
      || partialOrderAfter.taskStatus !== partialOrderBefore.taskStatus
      || partialLogsAfter !== partialLogsBefore
    ) {
      fail('PARTIAL_OUTPUT retry 拒绝后任务、订单和状态日志必须保持不变')
    }
    await expectRetryReason(partialTaskId, '这单只出了一部分纸', '只出一部分')
    pass('管理员重试 PARTIAL_OUTPUT 被拒，任务状态不变')

    const unpaidRetryTaskId = `pt_vps_unpaid_retry_${suffix}`
    const unpaidRetryOrderId = `order_vps_unpaid_retry_${suffix}`
    createdPrintTaskIds.push(unpaidRetryTaskId)
    createdOrderIds.push(unpaidRetryOrderId)
    await prisma.printTask.create({
      data: {
        id: unpaidRetryTaskId,
        terminalId,
        fileUrl: signFileUrl(fileId, 60_000).url,
        fileMd5: 'unpaid-md5',
        status: 'failed',
        errorCode: 'printer_offline',
      },
    })
    await prisma.order.create({
      data: {
        id: unpaidRetryOrderId,
        orderNo: `NO-VPSUP-${suffix}`,
        type: 'print',
        printTaskId: unpaidRetryTaskId,
        payStatus: 'unpaid',
        taskStatus: 'failed',
        amountCents: 100,
      },
    })
    const [unpaidBefore, unpaidOrderBefore, unpaidLogsBefore] = await Promise.all([
      prisma.printTask.findUniqueOrThrow({ where: { id: unpaidRetryTaskId } }),
      prisma.order.findUniqueOrThrow({ where: { id: unpaidRetryOrderId } }),
      prisma.printTaskStatusLog.count({ where: { taskId: unpaidRetryTaskId } }),
    ])
    await expectHttpErrorCode(
      () => printScan.applyAction('print', unpaidRetryTaskId, 'retry'),
      409,
      'PRINT_RETRY_NOT_PAID',
      '未付款 retry → 409 + 精确业务错误码',
      '订单未付款，不能重试出纸',
    )
    const [unpaidAfter, unpaidOrderAfter, unpaidLogsAfter] = await Promise.all([
      prisma.printTask.findUniqueOrThrow({ where: { id: unpaidRetryTaskId } }),
      prisma.order.findUniqueOrThrow({ where: { id: unpaidRetryOrderId } }),
      prisma.printTaskStatusLog.count({ where: { taskId: unpaidRetryTaskId } }),
    ])
    if (
      unpaidAfter.status !== 'failed'
      || unpaidOrderAfter.payStatus !== 'unpaid'
      || unpaidOrderAfter.taskStatus !== 'failed'
      || unpaidOrderAfter.payStatus !== unpaidOrderBefore.payStatus
      || JSON.stringify(unpaidAfter) !== JSON.stringify(unpaidBefore)
      || unpaidLogsAfter !== unpaidLogsBefore
    ) {
      fail('未付款 retry 拒绝后任务、订单和状态日志必须保持不变')
    }
    await expectRetryReason(unpaidRetryTaskId, '订单未付款，不能重试出纸', '未付款')
    pass('管理员重试未付款被拒，任务状态不变')

    // 退役与 retry 必须争用同一 Terminal 行：已退役终端的 failed 任务不能重新进入 pending，
    // 否则凭证已吊销且 claim 门禁为 active 的终端会留下永久无法领取的任务。
    const retiredTaskId = `pt_vps_retired_${suffix}`
    const retiredOrderId = `order_vps_retired_${suffix}`
    createdPrintTaskIds.push(retiredTaskId)
    createdOrderIds.push(retiredOrderId)
    await prisma.terminal.create({
      data: {
        id: retiredTerminalId,
        terminalCode: `VPS-RETIRED-${suffix}`,
        agentToken: `tok_retired_source_${suffix}`,
        deviceFingerprint: 'fp-retired',
      },
    })
    await prisma.terminalHeartbeat.create({
      data: { terminalId: retiredTerminalId, agentVersion: '0.4.13' },
    })
    // The failed task must predate retirement. Database guards correctly reject
    // all new work attached after a terminal has become a permanent tombstone.
    await prisma.printTask.create({
      data: {
        id: retiredTaskId,
        terminalId: retiredTerminalId,
        fileUrl: signFileUrl(fileId, 60_000).url,
        fileMd5: 'retired-md5',
        status: 'failed',
        errorCode: 'printer_offline',
      },
    })
    const retiredUnconfirmedTaskId = `pt_vps_retired_unconfirmed_${suffix}`
    createdPrintTaskIds.push(retiredUnconfirmedTaskId)
    await prisma.printTask.create({
      data: {
        id: retiredUnconfirmedTaskId,
        terminalId: retiredTerminalId,
        fileUrl: signFileUrl(fileId, 60_000).url,
        fileMd5: 'retired-unconfirmed',
        status: 'failed',
        errorCode: 'PRINT_JOB_UNCONFIRMED',
      },
    })
    await prisma.terminal.update({
      where: { id: retiredTerminalId },
      data: {
        enabled: false,
        lifecycleStatus: 'retired',
        lifecycleVersion: { increment: 1 },
        credentialGeneration: { increment: 1 },
        agentToken: `cred$retired$${suffix}`,
      },
    })
    await prisma.order.create({
      data: {
        id: retiredOrderId,
        orderNo: `NO-VPS-RETIRED-${suffix}`,
        type: 'print',
        printTaskId: retiredTaskId,
        payStatus: 'paid',
        taskStatus: 'failed',
        amountCents: 100,
      },
    })
    await expectRetryReason(retiredTaskId, '终端已永久退役，不能重新排队', '退役终端')
    await expectHttpErrorCode(
      () => printScan.applyAction('print', retiredTaskId, 'retry'),
      409,
      'PRINT_SCAN_RETRY_TERMINAL_RETIRED',
      '已退役终端 failed 任务 retry → 409 + 精确业务错误码',
      '终端已永久退役，不能重新排队',
    )
    const [retiredTaskAfterRetry, retiredOrderAfterRetry, retiredRetryLogCount] = await Promise.all([
      prisma.printTask.findUniqueOrThrow({ where: { id: retiredTaskId } }),
      prisma.order.findUniqueOrThrow({ where: { id: retiredOrderId } }),
      prisma.printTaskStatusLog.count({ where: { taskId: retiredTaskId } }),
    ])
    if (
      retiredTaskAfterRetry.status !== 'failed' ||
      retiredOrderAfterRetry.taskStatus !== 'failed' ||
      retiredRetryLogCount !== 0
    ) {
      fail('已退役终端 retry 拒绝后任务、订单和状态日志必须保持不变')
    }
    pass('退役终端 retry fail-closed，且与退役共用 Terminal 行串行点')

    const retiredUnconfirmedOrderId = `order_vps_retired_unconfirmed_${suffix}`
    createdOrderIds.push(retiredUnconfirmedOrderId)
    await prisma.order.create({
      data: {
        id: retiredUnconfirmedOrderId,
        orderNo: `NO-VPS-RETIRED-U-${suffix}`,
        type: 'print',
        printTaskId: retiredUnconfirmedTaskId,
        payStatus: 'paid',
        taskStatus: 'failed',
        amountCents: 100,
      },
    })
    await expectRetryReason(
      retiredUnconfirmedTaskId,
      '这单的出纸结果还没确认，请 5 分钟后再试',
      '退役终端上的未确认仍先报未确认',
    )

    const inactiveTerminalId = `term_vps_inactive_${suffix}`
    const inactiveTaskId = `pt_vps_inactive_${suffix}`
    const inactiveOrderId = `order_vps_inactive_${suffix}`
    createdPrintTaskIds.push(inactiveTaskId)
    createdOrderIds.push(inactiveOrderId)
    await prisma.terminal.create({
      data: {
        id: inactiveTerminalId,
        terminalCode: `VPS-INACTIVE-${suffix}`,
        agentToken: `tok_inactive_${suffix}`,
        deviceFingerprint: 'fp-inactive',
      },
    })
    await prisma.terminalHeartbeat.create({
      data: { terminalId: inactiveTerminalId, agentVersion: '0.4.13' },
    })
    await prisma.printTask.create({
      data: {
        id: inactiveTaskId,
        terminalId: inactiveTerminalId,
        fileUrl: signFileUrl(fileId, 60_000).url,
        fileMd5: 'inactive-md5',
        status: 'failed',
        errorCode: 'printer_offline',
      },
    })
    await prisma.order.create({
      data: {
        id: inactiveOrderId,
        orderNo: `NO-VPS-INACTIVE-${suffix}`,
        type: 'print',
        printTaskId: inactiveTaskId,
        payStatus: 'paid',
        taskStatus: 'failed',
        amountCents: 100,
      },
    })
    await prisma.terminal.update({
      where: { id: inactiveTerminalId },
      data: { enabled: false },
    })
    await expectRetryReason(inactiveTaskId, '终端当前不在运行状态，不能重新排队', '未退役但未运行')
    await expectHttpErrorCode(
      () => printScan.applyAction('print', inactiveTaskId, 'retry'),
      409,
      'PRINT_SCAN_RETRY_TERMINAL_NOT_ACTIVE',
      '未运行终端 failed 任务 retry → 409',
      '终端当前不在运行状态，不能重新排队',
    )
    pass('列表原因与管理员动作拒绝一致：退役、未运行、订单状态不是 failed')

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

    const terminals = new TerminalAgentService(prisma, new AuditService(prisma))
    const adminClaim = await terminals.claimTasks(terminalId, { maxTasks: 1 }, `Bearer tok_vps_${suffix}`)
    const adminAttemptLogs = await prisma.printTaskStatusLog.count({
      where: { taskId: failedTaskId, fromStatus: 'failed', toStatus: 'pending' },
    })
    if (
      adminClaim.length === 1 &&
      adminClaim[0].taskId === failedTaskId &&
      adminClaim[0].attempt === 1 &&
      adminClaim[0].attempt === adminAttemptLogs &&
      adminClaim[0].fileUrl.includes('sig=') &&
      adminClaim[0].actionToken.length > 0
    ) {
      pass('管理员重试后 claim 的 attempt 为 1（failed→pending 计数，不看 errorCode），签名链接仍在')
    } else {
      fail(`管理员重试后 attempt 异常: ${JSON.stringify({
        claim: adminClaim.map((item) => ({ taskId: item.taskId, attempt: item.attempt })),
        logs: adminAttemptLogs,
      })}`)
    }

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
    await expectHttpErrorCode(
      () => printScan.applyAction('print', refundedTaskId, 'retry'),
      409,
      'PRINT_RETRY_REFUNDED',
      '已退款订单的任务 retry → 409',
      '这单已退款或正在退款，不能重新提交',
    )
    await expectRetryReason(refundedTaskId, '这单已退款或正在退款，不能重新提交', '已退款')

    const refundingTaskId = `pt_vps_refunding_${suffix}`
    const refundingOrderId = `order_vps_refunding_${suffix}`
    createdPrintTaskIds.push(refundingTaskId)
    createdOrderIds.push(refundingOrderId)
    await prisma.printTask.create({
      data: { id: refundingTaskId, terminalId, fileUrl: signFileUrl(fileId, 60_000).url, fileMd5: 'x', status: 'failed' },
    })
    await prisma.order.create({
      data: {
        id: refundingOrderId, orderNo: `NO-VPSG-${suffix}`, type: 'print', printTaskId: refundingTaskId,
        payStatus: 'refunding', taskStatus: 'failed', amountCents: 100,
      },
    })
    await expectHttpErrorCode(
      () => printScan.applyAction('print', refundingTaskId, 'retry'),
      409,
      'PRINT_RETRY_REFUNDED',
      '退款中订单的任务 retry → 409',
      '这单已退款或正在退款，不能重新提交',
    )
    await expectRetryReason(refundingTaskId, '这单已退款或正在退款，不能重新提交', '退款中')

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
    const goneOrderId = `order_vps_gone_${suffix}`
    createdOrderIds.push(goneOrderId)
    await prisma.order.create({
      data: {
        id: goneOrderId, orderNo: `NO-VPSGONE-${suffix}`, type: 'print', printTaskId: gonefileTaskId,
        payStatus: 'paid', taskStatus: 'failed', amountCents: 100,
      },
    })
    await expectHttpErrorCode(
      () => printScan.applyAction('print', gonefileTaskId, 'retry'),
      409,
      'PRINT_RETRY_FILE_UNAVAILABLE',
      '文件已清理的任务 retry → 409',
      '打印文件已过期或已清理，不能重新提交',
    )
    await expectRetryReason(gonefileTaskId, '打印文件已过期或已清理，不能重新提交', '文件已清理')
    await prisma.fileObject.delete({ where: { id: goneFileId } }).catch(() => undefined)

    // 真实并发 CAS：两个 retry 同时打同一 failed 任务，只允许一个成功
    const raceTaskId = `pt_vps_race_${suffix}`
    createdPrintTaskIds.push(raceTaskId)
    await prisma.printTask.create({
      data: { id: raceTaskId, terminalId, fileUrl: signFileUrl(fileId, 60_000).url, fileMd5: 'x', status: 'failed' },
    })
    const raceOrderId = `order_vps_race_${suffix}`
    createdOrderIds.push(raceOrderId)
    await prisma.order.create({
      data: {
        id: raceOrderId, orderNo: `NO-VPSRACE-${suffix}`, type: 'print', printTaskId: raceTaskId,
        payStatus: 'paid', taskStatus: 'failed', amountCents: 100,
      },
    })
    const raceResults = await Promise.allSettled([
      printScan.applyAction('print', raceTaskId, 'retry'),
      printScan.applyAction('print', raceTaskId, 'retry'),
    ])
    const raceOk = raceResults.filter((r) => r.status === 'fulfilled').length
    if (raceOk !== 1) fail(`并发 retry 应恰好一个成功，实际成功 ${raceOk} 个`)
    pass('并发 retry CAS：两个并发请求恰好一个成功')

    const internalTaskId = `pt_vps_internal_${suffix}`
    createdPrintTaskIds.push(internalTaskId)
    await prisma.printTask.create({
      data: {
        id: internalTaskId,
        terminalId,
        fileUrl: signFileUrl(fileId, 60_000).url,
        fileMd5: 'internal',
        status: 'failed',
        errorCode: 'printer_offline',
      },
    })
    await expectRetryReason(internalTaskId, null, '无订单')
    const internalRetried = await printScan.applyAction('print', internalTaskId, 'retry')
    if (internalRetried.toStatus !== 'pending') fail('无订单的失败任务应能重试')
    if (await prisma.order.count({ where: { printTaskId: internalTaskId } }) !== 0) {
      fail('无订单任务重试不得新建订单')
    }
    pass('无订单的失败任务不受付款条件限制，管理员仍可重试')
    await prisma.printTask.update({ where: { id: internalTaskId }, data: { status: 'cancelled' } })

    const unparsedTaskId = `pt_vps_unparsed_${suffix}`
    createdPrintTaskIds.push(unparsedTaskId)
    await prisma.printTask.create({
      data: {
        id: unparsedTaskId,
        terminalId,
        fileUrl: 'https://internal/not-a-signed-file',
        fileMd5: 'unparsed',
        status: 'failed',
        errorCode: 'printer_offline',
      },
    })
    await prisma.order.create({
      data: {
        id: `order_vps_unparsed_${suffix}`,
        orderNo: `NO-VPSUNP-${suffix}`,
        type: 'print',
        printTaskId: unparsedTaskId,
        payStatus: 'paid',
        taskStatus: 'failed',
        amountCents: 100,
      },
    })
    createdOrderIds.push(`order_vps_unparsed_${suffix}`)
    await expectHttpErrorCode(
      () => printScan.applyAction('print', unparsedTaskId, 'retry'),
      409,
      'PRINT_SCAN_RETRY_FILE_UNAVAILABLE',
      '文件链接无法解析 retry → 409',
      '打印文件链接无法解析，无法重试',
    )
    await expectRetryReason(unparsedTaskId, '打印文件链接无法解析，无法重试', '文件链接无法解析')

    const expiredFileId = `file_vps_expired_${suffix}`
    await prisma.fileObject.create({
      data: {
        id: expiredFileId,
        storageKey: `verify/${expiredFileId}.pdf`,
        filename: 'expired.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 3,
        sha256: '',
        purpose: 'print_doc',
        expiresAt: new Date(Date.now() - 60_000),
      },
    })
    const expiredTaskId = `pt_vps_expired_${suffix}`
    createdPrintTaskIds.push(expiredTaskId)
    await prisma.printTask.create({
      data: {
        id: expiredTaskId,
        terminalId,
        fileUrl: signFileUrl(expiredFileId, 60_000).url,
        fileMd5: 'expired',
        status: 'failed',
        errorCode: 'printer_offline',
      },
    })
    const expiredOrderId = `order_vps_expired_${suffix}`
    createdOrderIds.push(expiredOrderId)
    await prisma.order.create({
      data: {
        id: expiredOrderId,
        orderNo: `NO-VPSEXP-${suffix}`,
        type: 'print',
        printTaskId: expiredTaskId,
        payStatus: 'paid',
        taskStatus: 'failed',
        amountCents: 100,
      },
    })
    await expectHttpErrorCode(
      () => printScan.applyAction('print', expiredTaskId, 'retry'),
      409,
      'PRINT_RETRY_FILE_UNAVAILABLE',
      '文件已过期 retry → 409',
      '打印文件已过期或已清理，不能重新提交',
    )
    await expectRetryReason(expiredTaskId, '打印文件已过期或已清理，不能重新提交', '文件已过期')
    await prisma.fileObject.delete({ where: { id: expiredFileId } }).catch(() => undefined)

    const versionMessage = '这台终端的打印程序版本过旧，升级到 0.4.13 后才能重新提交'
    const versionCases: Array<{ label: string; version: string | null; allow: boolean }> = [
      { label: '0.4.12', version: '0.4.12', allow: false },
      { label: '0.4.13', version: '0.4.13', allow: true },
      { label: '0.4.13-production', version: '0.4.13-production', allow: true },
      { label: '0.5.0', version: '0.5.0', allow: true },
      { label: '0.4.9', version: '0.4.9', allow: false },
      { label: '没有版本', version: null, allow: false },
      { label: 'abc', version: 'abc', allow: false },
    ]
    for (const versionCase of versionCases) {
      const versionTerminalId = `term_vps_ver_${versionCase.label.replace(/[^a-z0-9]+/gi, '')}_${suffix}`
      versionTerminalIds.push(versionTerminalId)
      await prisma.terminal.create({
        data: {
          id: versionTerminalId,
          terminalCode: `VPS-VER-${versionCase.label}-${suffix}`.slice(0, 40),
          agentToken: `tok_ver_${versionCase.label}_${suffix}`,
          deviceFingerprint: 'fp-ver',
        },
      })
      if (versionCase.version !== null) {
        await prisma.terminalHeartbeat.create({
          data: { terminalId: versionTerminalId, agentVersion: versionCase.version },
        })
      }
      const versionTaskId = `pt_vps_ver_${versionCase.label.replace(/[^a-z0-9]+/gi, '')}_${suffix}`
      createdPrintTaskIds.push(versionTaskId)
      await prisma.printTask.create({
        data: {
          id: versionTaskId,
          terminalId: versionTerminalId,
          fileUrl: signFileUrl(fileId, 60_000).url,
          fileMd5: 'ver',
          status: 'failed',
          errorCode: 'printer_offline',
        },
      })
      const versionOrderId = `order_vps_ver_${versionCase.label.replace(/[^a-z0-9]+/gi, '')}_${suffix}`
      createdOrderIds.push(versionOrderId)
      await prisma.order.create({
        data: {
          id: versionOrderId,
          orderNo: `NO-VPSVER-${versionCase.label}-${suffix}`.slice(0, 40),
          type: 'print',
          printTaskId: versionTaskId,
          payStatus: 'paid',
          taskStatus: 'failed',
          amountCents: 100,
        },
      })
      if (versionCase.allow) {
        await expectRetryReason(versionTaskId, null, `管理员 ${versionCase.label}`)
        const allowed = await printScan.applyAction('print', versionTaskId, 'retry')
        if (allowed.toStatus !== 'pending') fail(`管理员 ${versionCase.label} 应允许重试`)
        pass(`管理员 ${versionCase.label} 允许重试`)
      } else {
        await expectHttpErrorCode(
          () => printScan.applyAction('print', versionTaskId, 'retry'),
          409,
          'PRINT_RETRY_AGENT_VERSION',
          `管理员 ${versionCase.label} 不许重试`,
          versionMessage,
        )
        await expectRetryReason(versionTaskId, versionMessage, `管理员 ${versionCase.label}`)
      }
    }
    const noTerminalTaskId = `pt_vps_noterm_${suffix}`
    createdPrintTaskIds.push(noTerminalTaskId)
    await prisma.printTask.create({
      data: {
        id: noTerminalTaskId,
        terminalId: null,
        fileUrl: signFileUrl(fileId, 60_000).url,
        fileMd5: 'noterm',
        status: 'failed',
        errorCode: 'printer_offline',
      },
    })
    const noTerminalOrderId = `order_vps_noterm_${suffix}`
    createdOrderIds.push(noTerminalOrderId)
    await prisma.order.create({
      data: {
        id: noTerminalOrderId,
        orderNo: `NO-VPSNT-${suffix}`,
        type: 'print',
        printTaskId: noTerminalTaskId,
        payStatus: 'paid',
        taskStatus: 'failed',
        amountCents: 100,
      },
    })
    await expectHttpErrorCode(
      () => printScan.applyAction('print', noTerminalTaskId, 'retry'),
      409,
      'PRINT_RETRY_AGENT_VERSION',
      '没有终端不许重试',
      versionMessage,
    )
    await expectRetryReason(noTerminalTaskId, versionMessage, '没有终端')

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
      {
        actorId: closeOperatorId,
        actorRole: 'admin',
        ipAddress: '203.0.113.5',
        userAgent: 'verify-admin-print-scan/close-unpaid',
        requestId: `req_close_${suffix}`,
      },
    )
    if (closed.idempotent || closed.toStatus !== 'cancelled') fail('首次受控关闭必须返回 pending→cancelled 且非幂等')
    const [closeAfterTask, closeAfterOrder, closeLogs, closeAudit] = await Promise.all([
      prisma.printTask.findUnique({ where: { id: closeCandidate.id } }),
      prisma.order.findUnique({ where: { printTaskId: closeCandidate.id } }),
      prisma.printTaskStatusLog.count({ where: { taskId: closeCandidate.id, errorCode: 'ADMIN_UNPAID_PRINT_TASK_CLOSED' } }),
      prisma.auditLog.findFirst({
        where: { targetId: closeCandidate.id, action: 'print_task.admin_unpaid_closed' },
        select: { id: true, ipAddress: true, userAgent: true, requestId: true },
      }),
    ])
    if (
      closeAfterTask?.status !== 'cancelled' ||
      closeAfterTask.errorCode !== 'ADMIN_UNPAID_PRINT_TASK_CLOSED' ||
      closeAfterOrder?.payStatus !== 'closed' ||
      closeAfterOrder.taskStatus !== 'cancelled' ||
      closeAfterOrder.amountCents !== 137 ||
      closeLogs !== 1 ||
      !closeAudit ||
      closeAudit.ipAddress !== '203.0.113.5' ||
      closeAudit.userAgent !== 'verify-admin-print-scan/close-unpaid' ||
      closeAudit.requestId !== `req_close_${suffix}`
    ) fail('成功关闭必须同事务写任务/订单/状态日志/审计，且保留订单金额来源')
    pass('受控关闭：pending→cancelled，unpaid→closed，审计同事务且请求元数据完整，金额快照不变')

    const closeServiceSource = readFileSync(join(process.cwd(), 'src/admin-print-scan/admin-print-scan.service.ts'), 'utf8')
    if (!closeServiceSource.includes('paymentAttempts: { none: {} }')) {
      fail('受控关闭订单 CAS 必须同时断言不存在任何 PaymentAttempt，避免资格检查后的支付尝试穿透')
    }
    pass('受控关闭订单 CAS 同时拒绝任何 PaymentAttempt，防止迟到回调重新入账')

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

    // D3（2026-09-28 拍板）：签名盖章是默认拒绝键 —— 未配置即关闭，不看模式；
    // 上面 document_print 在 managed 下放行是阳性对照，证明默认拒绝没有外溢到其他键。
    if (!(apiContract.DEFAULT_DENY_CAPABILITY_KEYS as readonly string[]).includes('signature_stamp')) {
      fail('signature_stamp 必须在 DEFAULT_DENY_CAPABILITY_KEYS 里（D3：试点与新机器默认关闭）')
    }
    assertDeepEqual(apiContract.DEFAULT_DENY_CAPABILITY_KEYS, sharedContract.DEFAULT_DENY_CAPABILITY_KEYS, '默认拒绝能力键')
    for (const mode of ['managed', 'strict'] as const) {
      setPrintScanCapabilityModeForTest(mode)
      await expectHttpErrorCode(
        () => capabilities.assertUserTaskAllowed(terminalId, 'signature_stamp'),
        403, 'CAPABILITY_NOT_CONFIGURED',
        `签名盖章未配置 + ${mode} 模式 → 默认关闭`,
      )
    }
    setPrintScanCapabilityModeForTest('managed')
    await capabilities.upsert(terminalId, 'signature_stamp', 'unsupported', '试点暂不开放', 'admin_1')
    await expectHttpErrorCode(
      () => capabilities.assertUserTaskAllowed(terminalId, 'signature_stamp'),
      403, 'CAPABILITY_UNAVAILABLE',
      '签名盖章配为不支持 → 拒绝',
    )
    await capabilities.upsert(terminalId, 'signature_stamp', 'available', undefined, 'admin_1')
    await capabilities.assertUserTaskAllowed(terminalId, 'signature_stamp')
    pass('签名盖章只有管理员逐台配成可用后才放行')

    // ── 5b. 清除能力配置，回到「未配置」──────────────────────────────────────
    {
      const guards = Reflect.getMetadata(GUARDS_METADATA, AdminTerminalsController) as Array<{ name?: string }> | undefined
      const guardNames = (guards ?? []).map((guard) => guard.name)
      if (!guardNames.includes('JwtAuthGuard') || !guardNames.includes('RolesGuard')) {
        fail('清除接口所在控制器必须挂 JwtAuthGuard + RolesGuard，否则非管理员不是 403')
      }
      const rolesGuard = new RolesGuard(new Reflector())
      const ctxFor = (role: 'admin' | 'partner' | 'kiosk' | null) => ({
        getHandler: () => AdminTerminalsController.prototype.clearCapability,
        getClass: () => AdminTerminalsController,
        switchToHttp: () => ({
          getRequest: () => ({ user: role ? { userId: closeOperatorId, role, orgId: null } : undefined }),
        }),
      })
      for (const role of ['partner', 'kiosk'] as const) {
        await expectHttpError(
          async () => { rolesGuard.canActivate(ctxFor(role) as never) },
          403,
          `非管理员（${role}）清除终端能力 → 403`,
        )
      }
      if (rolesGuard.canActivate(ctxFor('admin') as never) !== true) fail('管理员清除终端能力应放行')
      pass('清除接口只允许管理员')

      const controller = new AdminTerminalsController({} as never, capabilities, new AuditService(prisma))
      const adminUser = { userId: closeOperatorId, role: 'admin' as const, orgId: null }
      const auditReq = { headers: { 'user-agent': 'verify-capability-clear' }, requestId: `clear_${suffix}` }
      const terminalCode = `VPS-${suffix}`
      const piiNote = '张三 13800138000'

      await expectHttpError(
        () => controller.clearCapability(terminalId, 'teleport', adminUser, auditReq),
        400,
        '清除非法能力键 → 400',
      )
      await expectHttpError(
        () => controller.clearCapability(`missing_${suffix}`, 'scan', adminUser, auditReq),
        404,
        '清除不存在的终端 → 404',
      )

      const absent = await controller.clearCapability(terminalId, 'usb_import', adminUser, auditReq)
      if (absent.data.cleared !== false) fail('本来就没有的能力行应幂等成功且 cleared=false')
      const absentLogs = await prisma.auditLog.count({
        where: { action: 'terminal.capability.cleared', targetId: terminalCode },
      })
      if (absentLogs !== 0) fail('本来就没有的能力行不得写审计')
      pass('清除不存在的能力行：成功且不写审计')

      await capabilities.upsert(terminalId, 'document_print', 'maintenance', piiNote, closeOperatorId)
      const cleared = await controller.clearCapability(terminalId, 'document_print', adminUser, auditReq)
      if (!cleared.data.cleared || cleared.data.capabilityKey !== 'document_print' || cleared.data.terminalCode !== terminalCode) {
        fail('清除已登记的能力行应返回 cleared=true')
      }
      const rowGone = await prisma.terminalCapability.findUnique({
        where: { terminalId_capabilityKey: { terminalId, capabilityKey: 'document_print' } },
      })
      if (rowGone) fail('清除后能力行应消失')
      const listedAfter = await capabilities.listForTerminal(terminalId)
      const documentAfter = listedAfter.capabilities.find((item) => item.capabilityKey === 'document_print')
      if (documentAfter?.configured !== false) fail('清除后 list 应回到 configured=false')

      const logs = await prisma.auditLog.findMany({
        where: { action: 'terminal.capability.cleared', targetId: terminalCode },
      })
      if (logs.length !== 1) fail(`清除应只写一条审计，实际 ${logs.length}`)
      const payload = JSON.parse(logs[0]?.payloadJson ?? '{}') as Record<string, unknown>
      const payloadKeys = Object.keys(payload).sort()
      if (payloadKeys.join(',') !== 'capabilityKey,hadNote,previousStatus,terminalCode') {
        fail(`审计 payload 只能有终端号、能力键、删前状态、备注是否存在，实际 ${payloadKeys.join(',')}`)
      }
      if (payload['terminalCode'] !== terminalCode || payload['capabilityKey'] !== 'document_print') {
        fail('审计 payload 的终端号或能力键不对')
      }
      if (payload['previousStatus'] !== 'maintenance' || payload['hadNote'] !== true) {
        fail(`审计 payload 删前状态或备注标记不对：${JSON.stringify(payload)}`)
      }
      const payloadText = JSON.stringify(payload)
      if (payloadText.includes('13800138000') || payloadText.includes('张三') || payloadText.includes(piiNote)) {
        fail('审计 payload 不得带备注原文或个人信息')
      }
      pass('清除已登记能力：删行、写一条审计、payload 无个人信息')

      const again = await controller.clearCapability(terminalId, 'document_print', adminUser, auditReq)
      if (again.data.cleared !== false) fail('重复清除应幂等成功且 cleared=false')
      const logsAfterRepeat = await prisma.auditLog.count({
        where: { action: 'terminal.capability.cleared', targetId: terminalCode },
      })
      if (logsAfterRepeat !== 1) fail(`重复清除不得再写审计，实际 ${logsAfterRepeat} 条`)
      pass('重复清除幂等且只写一次审计')

      setPrintScanCapabilityModeForTest('managed')
      await capabilities.assertUserTaskAllowed(terminalId, 'document_print')
      pass('清除后 managed 模式回到未配置放行')
      setPrintScanCapabilityModeForTest('strict')
      await expectHttpErrorCode(
        () => capabilities.assertUserTaskAllowed(terminalId, 'document_print'),
        403,
        'CAPABILITY_NOT_CONFIGURED',
        '清除后 strict 模式回到未配置拒绝',
      )
      setPrintScanCapabilityModeForTest('managed')

      await capabilities.upsert(terminalId, 'signature_stamp', 'available', undefined, closeOperatorId)
      await controller.clearCapability(terminalId, 'signature_stamp', adminUser, auditReq)
      for (const mode of ['managed', 'strict'] as const) {
        setPrintScanCapabilityModeForTest(mode)
        await expectHttpErrorCode(
          () => capabilities.assertUserTaskAllowed(terminalId, 'signature_stamp'),
          403,
          'CAPABILITY_NOT_CONFIGURED',
          `清除签名盖章后 ${mode} 模式默认拒绝`,
        )
      }
      setPrintScanCapabilityModeForTest('managed')
      pass('清除 DEFAULT_DENY 键后回到未登记即拒绝')

      await capabilities.upsert(terminalId, 'color_print', 'available', '彩色已验', closeOperatorId)
      await capabilities.assertPrintParamsAllowed(terminalId, { colorMode: 'color' })
      await controller.clearCapability(terminalId, 'color_print', adminUser, auditReq)
      await expectHttpErrorCode(
        () => capabilities.assertPrintParamsAllowed(terminalId, { colorMode: 'color' }),
        403,
        'PRINT_COLOR_NOT_VERIFIED_ON_TERMINAL',
        '彩色清除后拒绝',
      )
      await capabilities.upsert(terminalId, 'duplex_print', 'available', undefined, closeOperatorId)
      await capabilities.assertPrintParamsAllowed(terminalId, { duplex: 'duplex_long_edge' })
      await controller.clearCapability(terminalId, 'duplex_print', adminUser, auditReq)
      await expectHttpErrorCode(
        () => capabilities.assertPrintParamsAllowed(terminalId, { duplex: 'duplex_long_edge' }),
        403,
        'PRINT_DUPLEX_NOT_VERIFIED_ON_TERMINAL',
        '双面清除后拒绝',
      )
      pass('彩色 / 双面清除后回到未登记即拒绝')
    }

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
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [...createdPrintTaskIds, ...createdPaymentAttemptIds, `VPS-${suffix}`] } } }).catch(() => undefined)
    await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: createdOrderIds } } }).catch(() => undefined)
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => undefined)
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: createdPrintTaskIds } } }).catch(() => undefined)
    await prisma.printTask.deleteMany({ where: { id: { in: createdPrintTaskIds } } }).catch(() => undefined)
    await prisma.scanTask.deleteMany({ where: { id: { in: createdScanTaskIds } } }).catch(() => undefined)
    await prisma.fileObject.deleteMany({ where: { id: { in: [`file_vps_${suffix}`, `file_vps_gone_${suffix}`] } } }).catch(() => undefined)
    await prisma.terminalHeartbeat.deleteMany({
      where: { terminalId: { in: [terminalId, retiredTerminalId, `term_vps_inactive_${suffix}`, ...versionTerminalIds] } },
    }).catch(() => undefined)
    await prisma.terminal.deleteMany({
      where: { id: { in: [terminalId, `term_vps_inactive_${suffix}`, ...versionTerminalIds] } },
    }).catch(() => undefined)
    // retired 行是数据库永久 tombstone，按设计不可删除；验证库使用随机编号避免冲突。
    await prisma.user.deleteMany({ where: { id: { startsWith: `admin_close_${suffix}` } } }).catch(() => undefined)
    await prisma.onModuleDestroy()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
