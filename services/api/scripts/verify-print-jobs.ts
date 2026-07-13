/**
 * 打印链路 service 级轻量 E2E 验证（P1-B 守门）。
 *
 * 覆盖上线核心打印链路（创建 → claim → 状态回传 → 查询）的关键不变量：
 *   1. 合法签名 fileUrl + 目标终端 → 创建 PrintTask(pending)。
 *   2. 非法 fileUrl（外部地址 / 无签名 / 篡改 sig）→ 400 PRINT_INVALID_FILE_URL（SSRF 防护）。
 *   3. 终端 claim：只领取已绑定本终端的 pending 任务；错 agentToken → 401。
 *   4. 状态回传：claimed → printing → completed（含 completedAt）。
 *   5. 终态幂等：重复回传 completed / 终态后再请求 printing 都返回 ack 且不重写 DB。
 *   6. 状态查询：getStatus 反映终态；不存在任务 → 404 PRINT_TASK_NOT_FOUND。
 *
 * service 直调真库（prisma），不起 HTTP server——确定性、CI 友好，与现有 verify 一致。
 * 运行：pnpm --filter ./services/api verify:print-jobs
 */
import 'dotenv/config'
import { randomBytes } from 'crypto'

// terminals.service 在模块加载期 requireEnv 这两项；signing 在调用期读 FILE_SIGNING_SECRET。
// 测试兜底（||= 不覆盖外部已设值；CI 已注入这些测试值）。须在动态 import terminals.service 之前设好。
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-print-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-print-terminal-action-secret-0123456789'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-print-file-signing-secret-0123456789abcd'

import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { AuditService } from '../src/audit/audit.service'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { FilesService } from '../src/files/files.service'
import { signFileUrl } from '../src/files/signing'
import { OrderStatusService } from '../src/payment/order-status.service'
import { PricingService } from '../src/payment/pricing.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { StorageService } from '../src/storage/storage.service'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'
import type { CreatePrintJobDto } from '../src/print-jobs/dto/create-print-job.dto'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望抛 ${code}，但未抛`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code}，实际: ${c ?? (e as Error).message}`)
  }
}

async function main() {
  // 动态 import：terminals.service 模块级 requireEnv 必须在上面 env 设好后再加载。
  const { TerminalsService } = await import('../src/terminals/terminals.service')

  console.log('\n=== 打印链路 service 级 E2E 验证（P1-B 守门）===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const files = new FilesService(prisma, audit, storage)
  const printJobs = new PrintJobsService(
    prisma,
    audit,
    new PrintPageCountService(prisma, storage),
    new PricingService(prisma),
    new OrderStatusService(prisma, audit),
    new TerminalCapabilitiesService(prisma),
    files,
  )
  const terminals = new TerminalsService(prisma) // 不调 onModuleInit，避免 seed + 定时器

  const suffix = randomBytes(6).toString('hex')
  const terminalId = `term_vpj_${suffix}`
  const agentToken = `vpj-agent-token-${suffix}`
  const fileId = `file_vpj_${suffix}`
  const storageKey = `verify/print-jobs/${fileId}.pdf`
  const createdTaskIds: string[] = []
  // 证件照参数契约 + 建单后源删除用例 fixture id（提前声明，供 cleanup 闭包引用）。
  const idpSourceId = `file_vpj_idsrc_${suffix}`
  const idpLayoutId = `file_vpj_idlay_${suffix}`
  const idpLayoutKey = `verify/print-jobs/${idpLayoutId}.pdf`

  async function cleanup() {
    if (createdTaskIds.length) {
      const orders = await prisma.order.findMany({ where: { printTaskId: { in: createdTaskIds } }, select: { id: true } })
      await prisma.auditLog.deleteMany({ where: { targetType: 'order', targetId: { in: orders.map((o) => o.id) } } })
      await prisma.order.deleteMany({ where: { printTaskId: { in: createdTaskIds } } })
      await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: createdTaskIds } } })
      await prisma.auditLog.deleteMany({ where: { targetType: 'print_task', targetId: { in: createdTaskIds } } })
      await prisma.printTask.deleteMany({ where: { id: { in: createdTaskIds } } })
    }
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    // 计费接线后新增的真实 fixture / 价目清理。
    await prisma.fileObject.deleteMany({ where: { id: fileId } })
    await storage.deleteObject(storageKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await prisma.priceConfig.deleteMany({ where: { serviceKey: { in: ['print_bw_page', 'print_color_page'] } } })
    // 证件照参数契约 + 源删除用例 fixture 清理。
    await prisma.auditLog.deleteMany({ where: { targetType: 'file', targetId: { in: [idpSourceId, idpLayoutId] } } })
    await prisma.fileObject.deleteMany({ where: { id: { in: [idpSourceId, idpLayoutId] } } })
    await storage.deleteObject(idpLayoutKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
  }

  try {
    await cleanup()

    await prisma.terminal.create({
      data: { id: terminalId, terminalCode: `VPJ-${suffix}`, agentToken, deviceFingerprint: `fp-${suffix}` },
    })
    pass('终端夹具已创建')

    // 计费接线后 create() 需真实 FileObject + 存储内容识别页数 + PriceConfig 报价（否则 fail-closed）。
    await seedDevDefaultPriceConfig(prisma)
    const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF\n')
    await storage.putObject(storageKey, pdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: fileId,
        storageKey,
        filename: 'vpj.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdfBytes.length,
        sha256: '',
        purpose: 'print_source',
        bucket: LOCAL_BUCKET_SENTINEL,
      },
    })

    await terminals.heartbeat(
      terminalId,
      {
        status: 'agent_degraded',
        printerStatus: 'ok',
        localTaskDatabaseAvailable: false,
        agentVersion: 'verify-agent',
      },
      `Bearer ${agentToken}`,
    )
    const adminTerminals = await terminals.listTerminalsForAdmin()
    const adminTerminal = adminTerminals.terminals.find((t) => t.id === terminalId)
    if (adminTerminal?.agentStatus === 'agent_degraded' && adminTerminal.localTaskDatabaseAvailable === false) {
      pass('0. Agent 降级心跳 → Admin 终端视图可见 agent_degraded / localTaskDatabaseAvailable=false')
    } else {
      fail(`0. Agent 降级心跳未进入 Admin 视图: ${JSON.stringify(adminTerminal)}`)
    }

    // ── 1. 合法签名 fileUrl → 创建 PrintTask(pending) ──────────────────
    const signed = signFileUrl(fileId, 30 * 60 * 1000)
    const dto1: CreatePrintJobDto = { fileUrl: signed.url, fileMd5: 'sha256-vpj', fileName: '测试简历.pdf' }
    const created = await printJobs.create(dto1, {
      ipAddress: '127.0.0.1',
      userAgent: 'verify',
      endUserId: null,
      terminalId,
    })
    createdTaskIds.push(created.taskId)
    if (created.status === 'pending' && created.taskId.startsWith('ptask_')) {
      pass('1. 合法签名 fileUrl + 目标终端 → 创建任务 pending')
    } else fail(`1. 创建异常: ${JSON.stringify(created)}`)

    // ── 2. 非法 fileUrl 拦截（SSRF 防护）──────────────────────────────
    await expectCode(
      () => printJobs.create({ fileUrl: 'https://evil.example.com/secret' }, {}),
      'PRINT_INVALID_FILE_URL',
      '2a. 外部 URL → 400 PRINT_INVALID_FILE_URL',
    )
    await expectCode(
      () => printJobs.create({ fileUrl: `/api/v1/files/${fileId}/content` }, {}),
      'PRINT_INVALID_FILE_URL',
      '2b. 缺签名参数 → 400 PRINT_INVALID_FILE_URL',
    )
    const tamperedUrl = signed.url.replace(/sig=([0-9a-fA-F]+)/, (_m, s: string) => `sig=${s.split('').reverse().join('')}`)
    await expectCode(
      () => printJobs.create({ fileUrl: tamperedUrl }, {}),
      'PRINT_INVALID_FILE_URL',
      '2c. 篡改 sig → 400 PRINT_INVALID_FILE_URL',
    )

    // backdate：claim 取全局最旧 pending；把测试任务回拨到很早，保证 claim 确定命中本任务。
    await prisma.printTask.update({ where: { id: created.taskId }, data: { createdAt: new Date('2020-01-01T00:00:00.000Z') } })

    // ── 3. 终端 claim ────────────────────────────────────────────────
    await expectCode(
      () => terminals.claimTasks(terminalId, { maxTasks: 1 }, 'Bearer wrong-token'),
      'AUTH_TOKEN_INVALID',
      '3a. claim 用错 agentToken → 401 AUTH_TOKEN_INVALID',
    )
    const degradedClaim = await terminals.claimTasks(terminalId, { maxTasks: 1 }, `Bearer ${agentToken}`)
    const afterDegradedClaim = await prisma.printTask.findUnique({ where: { id: created.taskId } })
    if (degradedClaim.length === 0 && afterDegradedClaim?.status === 'pending') {
      pass('3b. Agent 降级时后端 claim 二道闸门 → 不下发任务且任务保持 pending')
    } else {
      fail(`3b. 降级 claim 闸门异常: claimed=${JSON.stringify(degradedClaim)} status=${afterDegradedClaim?.status}`)
    }

    await terminals.heartbeat(
      terminalId,
      {
        status: 'online',
        printerStatus: 'ok',
        localTaskDatabaseAvailable: true,
        agentVersion: 'verify-agent',
      },
      `Bearer ${agentToken}`,
    )
    const claimed = await terminals.claimTasks(terminalId, { maxTasks: 1 }, `Bearer ${agentToken}`)
    if (claimed.length === 1 && claimed[0].taskId === created.taskId && claimed[0].claimedBy === terminalId && !!claimed[0].fileUrl) {
      pass('3c. Agent 恢复 online 后终端 claim：本终端 pending 任务被领取（返回 fileUrl + actionToken）')
    } else fail(`3c. claim 异常: ${JSON.stringify(claimed.map((c) => c.taskId))}`)
    const afterClaim = await prisma.printTask.findUnique({ where: { id: created.taskId } })
    if (afterClaim?.status === 'claimed' && afterClaim.terminalId === terminalId) {
      pass('3d. claim 后 DB 状态为 claimed 且目标终端保持不变')
    } else fail(`3d. claim 后状态异常: ${afterClaim?.status} / ${afterClaim?.terminalId}`)

    // ── 4. 状态回传 printing → completed ──────────────────────────────
    await terminals.patchTaskStatus(created.taskId, { status: 'printing' }, `Bearer ${agentToken}`, terminalId)
    const afterPrinting = await printJobs.getStatus(created.taskId)
    if (afterPrinting.status === 'printing') pass('4a. 状态回传 → printing')
    else fail(`4a. printing 异常: ${afterPrinting.status}`)

    await terminals.patchTaskStatus(created.taskId, { status: 'completed' }, `Bearer ${agentToken}`, terminalId)
    const afterCompleted = await printJobs.getStatus(created.taskId)
    if (afterCompleted.status === 'completed' && typeof afterCompleted.completedAt === 'string') {
      pass('4b. 状态回传 → completed（含 completedAt）')
    } else fail(`4b. completed 异常: ${JSON.stringify(afterCompleted)}`)

    // ── 5. 终态幂等 ───────────────────────────────────────────────────
    const completedAt1 = afterCompleted.completedAt
    const ack = await terminals.patchTaskStatus(created.taskId, { status: 'completed' }, `Bearer ${agentToken}`, terminalId)
    const afterRepatch = await printJobs.getStatus(created.taskId)
    if (ack.acknowledged === true && afterRepatch.status === 'completed' && afterRepatch.completedAt === completedAt1) {
      pass('5a. 终态幂等：重复回传 completed → ack 且 completedAt 不变（DB 未重写）')
    } else fail(`5a. 幂等异常: ${JSON.stringify(afterRepatch)}`)

    const ack2 = await terminals.patchTaskStatus(created.taskId, { status: 'printing' }, `Bearer ${agentToken}`, terminalId)
    const afterIllegal = await printJobs.getStatus(created.taskId)
    if (ack2.acknowledged === true && afterIllegal.status === 'completed') {
      pass('5b. 终态后再请求 printing → 幂等 ack，状态仍 completed（终态保护）')
    } else fail(`5b. 终态保护异常: ${afterIllegal.status}`)

    // ── 6. 状态查询 404 ───────────────────────────────────────────────
    await expectCode(
      () => printJobs.getStatus(`ptask_nonexistent_${suffix}`),
      'PRINT_TASK_NOT_FOUND',
      '6. 查询不存在任务 → 404 PRINT_TASK_NOT_FOUND',
    )

    // ── 7. 失败原因安全口径（不泄露 Agent 原始 errorMessage）────────────
    // 前置：终端仍 online（section 3 已恢复），失败任务能被本终端 claim。

    // Agent 回传含敏感路径 / 驱动 / 主机名 / 内部堆栈的原始 errorMessage。
    const RAW_SENSITIVE_MESSAGE =
      'TWAIN driver fault 0x8007000E at C:\\Windows\\System32\\spool\\drivers\\x64\\3\\PANTUM.DLL ' +
      'on host KIOSK-PC-01\n    at PrintSpooler.dispatch (spooler.cpp:1423)\n    at Agent.run (agent.ts:88)'
    const SENSITIVE_FRAGMENTS = [
      'C:\\', 'spool', 'PANTUM.DLL', 'KIOSK-PC-01', '0x8007', 'spooler.cpp', 'agent.ts',
    ]

    // 复用 helper：创建 → backdate → claim → 回传 failed（含原始敏感 errorMessage）。
    async function createClaimAndFail(
      label: string,
      backdateIso: string,
      errorCode: string | undefined,
      errorMessage: string,
    ): Promise<string> {
      const dto: CreatePrintJobDto = {
        fileUrl:  signFileUrl(fileId, 30 * 60 * 1000).url,
        fileMd5:  'sha256-vpj-fail',
        fileName: `${label}.pdf`,
      }
      const failCreated = await printJobs.create(dto, { terminalId })
      createdTaskIds.push(failCreated.taskId)
      await prisma.printTask.update({
        where: { id: failCreated.taskId },
        data:  { createdAt: new Date(backdateIso) },
      })
      const claim = await terminals.claimTasks(terminalId, { maxTasks: 1 }, `Bearer ${agentToken}`)
      if (claim.length !== 1 || claim[0].taskId !== failCreated.taskId) {
        fail(`7 预备(${label}) — 失败任务未被本终端 claim: ${JSON.stringify(claim.map((c) => c.taskId))}`)
      }
      await terminals.patchTaskStatus(
        failCreated.taskId,
        { status: 'failed', ...(errorCode ? { errorCode } : {}), errorMessage },
        `Bearer ${agentToken}`,
        terminalId,
      )
      return failCreated.taskId
    }

    // 7a/7b/7c/7d：已知错误码（白名单）+ 敏感原始 errorMessage。
    const knownFailId = await createClaimAndFail('失败任务-已知码', '2019-01-01T00:00:00.000Z', 'PRINTER_OFFLINE', RAW_SENSITIVE_MESSAGE)

    // DB 仍完整保留 Agent 原始 errorCode/errorMessage（后台排障可用）。
    const dbFail = await prisma.printTask.findUnique({ where: { id: knownFailId } })
    if (dbFail?.status === 'failed' && dbFail.errorCode === 'PRINTER_OFFLINE' && dbFail.errorMessage === RAW_SENSITIVE_MESSAGE) {
      pass('7a. DB 仍完整保存 Agent 原始 errorCode/errorMessage（后台排障可用）')
    } else {
      fail(`7a. DB 未保留原始错误: ${JSON.stringify({ status: dbFail?.status, errorCode: dbFail?.errorCode, errorMessage: dbFail?.errorMessage })}`)
    }

    // getStatus() 只回白名单安全文案。
    const userView = await printJobs.getStatus(knownFailId)
    const safeExpected = '打印机离线，请联系工作人员检查设备'
    if (userView.failureReasonForUser === safeExpected && userView.errorMessage === safeExpected) {
      pass('7b. getStatus 已知错误码 → failureReasonForUser/errorMessage 均为白名单安全文案')
    } else {
      fail(`7b. 安全文案异常: ${JSON.stringify({ failureReasonForUser: userView.failureReasonForUser, errorMessage: userView.errorMessage })}`)
    }

    // 关键断言：用户视图**任何字段**都不得包含 Agent 原始敏感片段。
    const userBlob = JSON.stringify(userView)
    const leaked = SENSITIVE_FRAGMENTS.filter((frag) => userBlob.includes(frag))
    if (leaked.length === 0) {
      pass('7c. getStatus 返回体不含任何 Agent 原始敏感片段（路径/驱动/主机/堆栈）')
    } else {
      fail(`7c. 检测到敏感信息泄露: ${leaked.join(', ')} ; blob=${userBlob}`)
    }

    // errorCode 仍下发（供前端本地映射兜底）。
    if (userView.errorCode === 'PRINTER_OFFLINE') pass('7d. getStatus 仍返回 errorCode（前端本地映射兜底用）')
    else fail(`7d. errorCode 未返回: ${userView.errorCode}`)

    // 7e：未知错误码 → 统一默认安全文案，且不泄露原始敏感信息。
    const unknownFailId = await createClaimAndFail('失败任务-未知码', '2019-01-02T00:00:00.000Z', 'INTERNAL_SEGFAULT_0x1234', RAW_SENSITIVE_MESSAGE)
    const userView2 = await printJobs.getStatus(unknownFailId)
    const defaultExpected = '打印任务失败，请联系工作人员处理或稍后重试'
    const leaked2 = SENSITIVE_FRAGMENTS.filter((frag) => JSON.stringify(userView2).includes(frag))
    if (userView2.failureReasonForUser === defaultExpected && userView2.errorMessage === defaultExpected && leaked2.length === 0) {
      pass('7e. 未知错误码 → 默认安全兜底文案，且不泄露原始敏感信息')
    } else {
      fail(`7e. 未知错误码兜底异常: ${JSON.stringify({ failureReasonForUser: userView2.failureReasonForUser, errorMessage: userView2.errorMessage, leaked2 })}`)
    }

    // 7f/7g：完全无 errorCode，Agent 只回原始 errorMessage（最易泄露的场景——
    // 失败判定只能靠 errorMessage 命中，且映射函数拿不到任何 errorCode）。
    const noCodeFailId = await createClaimAndFail('失败任务-仅原始文本', '2019-01-03T00:00:00.000Z', undefined, RAW_SENSITIVE_MESSAGE)

    // DB 仍完整保存原始 errorMessage；errorCode 落库为空。
    const dbNoCode = await prisma.printTask.findUnique({ where: { id: noCodeFailId } })
    if (dbNoCode?.status === 'failed' && dbNoCode.errorMessage === RAW_SENSITIVE_MESSAGE && !dbNoCode.errorCode) {
      pass('7f. 仅原始 errorMessage（无 errorCode）→ DB 仍完整保存原文，errorCode 为空')
    } else {
      fail(`7f. DB 状态异常: ${JSON.stringify({ status: dbNoCode?.status, errorCode: dbNoCode?.errorCode, errorMessage: dbNoCode?.errorMessage })}`)
    }

    // getStatus() 无 errorCode 可映射 → 统一默认安全文案，且不泄露原始敏感信息。
    const userView3 = await printJobs.getStatus(noCodeFailId)
    const leaked3 = SENSITIVE_FRAGMENTS.filter((frag) => JSON.stringify(userView3).includes(frag))
    if (userView3.failureReasonForUser === defaultExpected && userView3.errorMessage === defaultExpected && leaked3.length === 0) {
      pass('7g. 仅原始 errorMessage（无 errorCode）→ getStatus 回默认安全文案，failureReasonForUser/errorMessage 一致且不泄露原文')
    } else {
      fail(`7g. 仅原始 errorMessage 兜底异常: ${JSON.stringify({ failureReasonForUser: userView3.failureReasonForUser, errorMessage: userView3.errorMessage, leaked3 })}`)
    }

    // ── 8. 证件照参数契约 + 建单后源删除（设计 §六 + §4.9 主删除路径）────────
    // fixture：id_scan 源文件 + id_photo_print 排版 PDF（sourceFileId 指回源），
    // 均为 purpose 门禁触发本次新增行为所需的最小真实 DB 状态。
    await prisma.fileObject.create({
      data: {
        id: idpSourceId,
        storageKey: `verify/print-jobs/${idpSourceId}.jpg`,
        filename: 'crop.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        sha256: '',
        purpose: 'id_scan',
        bucket: LOCAL_BUCKET_SENTINEL,
        ownerType: 'system',
        status: 'active',
      },
    })
    await storage.putObject(idpLayoutKey, pdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: idpLayoutId,
        storageKey: idpLayoutKey,
        filename: 'layout.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdfBytes.length,
        sha256: '',
        purpose: 'id_photo_print',
        sourceFileId: idpSourceId,
        bucket: LOCAL_BUCKET_SENTINEL,
        ownerType: 'system',
        status: 'active',
      },
    })
    const idpFileUrl = signFileUrl(idpLayoutId, 5 * 60 * 1000).url

    // 与 PrintJobParamsDto 字段集对齐的字面量（services/api 走 commonjs，无法直接
    // import ESM-only 的 @ai-job-print/shared，故本地复刻两组合法参数对象，
    // 而非调用 makePrintParams；字段全集以 packages/shared/src/types/print.ts 的
    // DEFAULT_PRINT_JOB_PARAMS / PrintJobParams 为准）。
    const idpNonContractParams = {
      copies: 1,
      colorMode: 'black_white' as const,
      duplex: 'simplex' as const,
      paperSize: 'A4' as const,
      orientation: 'auto' as const,
      quality: 'standard' as const,
      scale: 'fit' as const,
      pagesPerSheet: 1 as const,
    }
    const idpContractParams = {
      ...idpNonContractParams,
      colorMode: 'color' as const,
      scale: 'actual' as const,
    }

    // 8a：不满足契约（默认黑白 / fit）→ 400 PRINT_PARAMS_INVALID_FOR_ID_PHOTO
    await expectCode(
      () => printJobs.create({ fileUrl: idpFileUrl, params: idpNonContractParams }, { terminalId }),
      'PRINT_PARAMS_INVALID_FOR_ID_PHOTO',
      '8a. 证件照非契约参数（黑白/fit）建单 → 400 PRINT_PARAMS_INVALID_FOR_ID_PHOTO',
    )

    // 8b：满足契约（彩色/单面/A4/actual）→ 建单成功
    const idpCreated = await printJobs.create(
      { fileUrl: idpFileUrl, params: idpContractParams },
      { terminalId },
    )
    createdTaskIds.push(idpCreated.taskId)
    if (idpCreated.status === 'pending' && idpCreated.taskId.startsWith('ptask_')) {
      pass('8b. 证件照契约参数（彩色/单面/A4/actual）建单成功')
    } else {
      fail(`8b. 证件照契约参数建单异常: ${JSON.stringify(idpCreated)}`)
    }

    // 8c：建单后源文件（id_scan）已被服务端自动软删（设计 §4.9 主删除路径）。
    const idpSourceAfter = await prisma.fileObject.findUnique({ where: { id: idpSourceId } })
    if (idpSourceAfter?.status === 'deleted' && idpSourceAfter.deletedAt) {
      pass('8c. 建单成功后源文件已自动软删（status=deleted 且 deletedAt 已落库）')
    } else {
      fail(`8c. 源文件未被自动删除: ${JSON.stringify(idpSourceAfter)}`)
    }

    // 8d：源删除动作已留审计。
    const idpDelAudit = await prisma.auditLog.findFirst({
      where: { action: 'id_photo.source_deleted', targetId: idpSourceId },
    })
    if (idpDelAudit) {
      pass('8d. 建单后源删除审计已落库（action=id_photo.source_deleted）')
    } else {
      fail('8d. 建单后源删除审计缺失')
    }
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
