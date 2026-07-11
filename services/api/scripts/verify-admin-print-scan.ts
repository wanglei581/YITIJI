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
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { AdminPrintScanService } from '../src/admin-print-scan/admin-print-scan.service'
import { PRINT_SCAN_CAPABILITY_KEYS } from '../src/terminals/terminal-capabilities.types'

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

async function main() {
  console.log('\n=== Task 10 Admin print-scan 任务中心 + 能力开关验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const capabilities = new TerminalCapabilitiesService(prisma)
  const printScan = new AdminPrintScanService(prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `term_vps_${suffix}`
  const createdPrintTaskIds: string[] = []
  const createdScanTaskIds: string[] = []
  const createdOrderIds: string[] = []

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
    await prisma.printTask.createMany({
      data: [
        {
          id: failedTaskId, terminalId, fileUrl: 'https://internal/secret-url', fileMd5: 'deadbeef',
          paramsJson: JSON.stringify({ fileName: '验证文件.pdf', copies: 2, colorMode: 'black_white', paperSize: 'A4' }),
          status: 'failed', errorCode: 'printer_offline', errorMessage: 'C:\\secret\\path stack trace',
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
    for (const secret of ['secret-url', 'deadbeef', 'cafebabe', 'stack trace', 'paramsJson']) {
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
    if (JSON.stringify(detail).includes('secret-url')) fail('print 详情不得泄露 fileUrl')
    pass('print 详情：关联订单 + 无敏感泄露')

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
    const orderAfter = await prisma.order.findUnique({ where: { id: orderId } })
    if (orderAfter?.taskStatus !== 'pending') fail('retry 应联动 Order.taskStatus → pending')
    const log = await prisma.printTaskStatusLog.findFirst({
      where: { taskId: failedTaskId, fromStatus: 'failed', toStatus: 'pending' },
    })
    if (!log || log.errorCode !== 'admin_retry') fail('retry 应写 PrintTaskStatusLog（errorCode=admin_retry）')
    pass('print.retry：failed→pending + Order 联动 + 状态日志')

    await expectHttpError(() => printScan.applyAction('print', failedTaskId, 'retry'), 409, '重复 retry（已 pending）→ 409')

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
    // 清理本脚本创建的数据（依赖 Terminal onDelete: Cascade 清 capability/scan/print）
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => undefined)
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: createdPrintTaskIds } } }).catch(() => undefined)
    await prisma.printTask.deleteMany({ where: { id: { in: createdPrintTaskIds } } }).catch(() => undefined)
    await prisma.scanTask.deleteMany({ where: { id: { in: createdScanTaskIds } } }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: terminalId } }).catch(() => undefined)
    await prisma.onModuleDestroy()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
