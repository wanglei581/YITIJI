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
import { AuditService } from '../src/audit/audit.service'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { signFileUrl } from '../src/files/signing'
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
  const printJobs = new PrintJobsService(prisma, audit)
  const terminals = new TerminalsService(prisma) // 不调 onModuleInit，避免 seed + 定时器

  const suffix = randomBytes(6).toString('hex')
  const terminalId = `term_vpj_${suffix}`
  const agentToken = `vpj-agent-token-${suffix}`
  const fileId = `file_vpj_${suffix}`
  const createdTaskIds: string[] = []

  async function cleanup() {
    if (createdTaskIds.length) {
      await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: createdTaskIds } } })
      await prisma.auditLog.deleteMany({ where: { targetType: 'print_task', targetId: { in: createdTaskIds } } })
      await prisma.printTask.deleteMany({ where: { id: { in: createdTaskIds } } })
    }
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
  }

  try {
    await cleanup()

    await prisma.terminal.create({
      data: { id: terminalId, terminalCode: `VPJ-${suffix}`, agentToken, deviceFingerprint: `fp-${suffix}` },
    })
    pass('终端夹具已创建')

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
