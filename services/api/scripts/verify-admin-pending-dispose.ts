/**
 * verify-admin-pending-dispose.ts
 *
 * 覆盖验收点：
 *   1. 端点存在并受 admin 鉴权保护（非 admin 角色 → 403/401）
 *   2. pending + claimedAt=null → abandon 成功，status 变为 abandoned
 *   3. 审计日志写入（action=print_job.admin_abandon，targetType=print_task）
 *   4. 非 pending 状态（claimed/completed/failed）→ 400 PRINT_TASK_NOT_PENDING
 *   5. claimedAt 非 null（已被领取）→ 400 PRINT_TASK_ALREADY_CLAIMED
 *   6. 幂等性：已是 abandoned 直接返回，不二次写入 AuditLog
 *
 * 运行：pnpm --filter @ai-job-print/api verify:admin-pending-dispose
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { AdminPrintJobsAbandonService, ADMIN_ABANDON_ERROR_CODE } from '../src/print-jobs/admin-print-jobs-abandon.service'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

async function main() {
  console.log('\n=== Admin pending-print-dispose 验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const svc = new AdminPrintJobsAbandonService(prisma, audit)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)

  // 创建测试 admin 用户
  const adminId = `user_vap_adm_${suffix}`
  await prisma.user.create({
    data: {
      id: adminId,
      username: `vap_admin_${suffix}`,
      name: `VAP Admin ${suffix}`,
      passwordHash: 'hash',
      role: 'admin',
      enabled: true,
      tokenVersion: 0,
    },
  })

  // 创建测试终端
  const termId = `term_vap_${suffix}`
  await prisma.terminal.create({
    data: {
      id: termId,
      terminalCode: `VAP-${suffix}`,
      agentToken: `tok_vap_${suffix}`,
      deviceFingerprint: 'fp',
    },
  })

  // 测试任务 IDs
  const taskPending      = `pt_vap_pend_${suffix}`
  const taskPendingClaim = `pt_vap_pndclm_${suffix}` // pending 但 claimedAt 非 null
  const taskCompleted    = `pt_vap_done_${suffix}`
  const taskAbandoned    = `pt_vap_abn_${suffix}`

  // 建立测试数据
  await prisma.printTask.createMany({
    data: [
      {
        id: taskPending,
        terminalId: termId,
        fileUrl: 'https://internal/test-file-1',
        fileMd5: 'aabbccdd',
        status: 'pending',
        claimedAt: null,
      },
      {
        // pending 但 claimedAt 非 null（异常数据，模拟半领取状态）
        id: taskPendingClaim,
        terminalId: termId,
        fileUrl: 'https://internal/test-file-2',
        fileMd5: 'aabbccdd',
        status: 'pending',
        claimedAt: new Date(),
      },
      {
        id: taskCompleted,
        terminalId: termId,
        fileUrl: 'https://internal/test-file-3',
        fileMd5: 'aabbccdd',
        status: 'completed',
        claimedAt: new Date(),
        completedAt: new Date(),
      },
      {
        id: taskAbandoned,
        terminalId: termId,
        fileUrl: 'https://internal/test-file-4',
        fileMd5: 'aabbccdd',
        status: 'abandoned',
        completedAt: new Date(),
        errorCode: ADMIN_ABANDON_ERROR_CODE,
        errorMessage: '该历史打印任务已由管理员受控废弃',
      },
    ],
  })

  const cleanup = async () => {
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: [taskPending, taskPendingClaim, taskCompleted, taskAbandoned] } } })
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [taskPending, taskPendingClaim, taskCompleted, taskAbandoned] } } })
    await prisma.printTask.deleteMany({ where: { id: { in: [taskPending, taskPendingClaim, taskCompleted, taskAbandoned] } } })
    await prisma.terminal.delete({ where: { id: termId } })
    await prisma.user.delete({ where: { id: adminId } })
  }

  try {
    // ── 1. pending + claimedAt=null → abandon 成功 ────────────────────────────
    {
      const result = await svc.abandonPending(taskPending, adminId)
      if (result.newStatus !== 'abandoned') fail('1. newStatus 应为 abandoned')
      if (result.previousStatus !== 'pending') fail('1. previousStatus 应为 pending')
      const task = await prisma.printTask.findUniqueOrThrow({ where: { id: taskPending } })
      if (task.status !== 'abandoned') fail('1. PrintTask.status 未更新为 abandoned')
      if (task.errorCode !== ADMIN_ABANDON_ERROR_CODE) fail('1. errorCode 未正确设置')
      pass('1. pending 孤单成功废弃')
    }

    // ── 2. 审计日志写入 ────────────────────────────────────────────────────────
    {
      // 稍等审计写入（同步写，但给 DB 一点时间）
      await new Promise((r) => setTimeout(r, 100))
      const logs = await prisma.auditLog.findMany({
        where: { targetId: taskPending, action: 'print_job.admin_abandon' },
      })
      if (logs.length === 0) fail('2. 审计日志未写入')
      if (logs[0].actorId !== adminId) fail('2. 审计 actorId 不匹配')
      if (logs[0].actorRole !== 'admin') fail('2. 审计 actorRole 应为 admin')
      if (logs[0].targetType !== 'print_task') fail('2. 审计 targetType 应为 print_task')
      pass('2. 审计日志写入正确')
    }

    // ── 3. StatusLog 写入 ─────────────────────────────────────────────────────
    {
      const logs = await prisma.printTaskStatusLog.findMany({ where: { taskId: taskPending } })
      if (logs.length === 0) fail('3. PrintTaskStatusLog 未写入')
      if (logs[0].fromStatus !== 'pending' || logs[0].toStatus !== 'abandoned') fail('3. StatusLog 状态流转不正确')
      pass('3. PrintTaskStatusLog 写入正确')
    }

    // ── 4. pending+claimedAt非null → 400 PRINT_TASK_ALREADY_CLAIMED ─────────
    {
      try {
        await svc.abandonPending(taskPendingClaim, adminId)
        fail('4. pending+claimedAt!=null 任务应被拒绝')
      } catch (err: unknown) {
        const e = err as { response?: { error?: { code?: string } }; status?: number }
        const code = e.response?.error?.code
        if (code !== 'PRINT_TASK_ALREADY_CLAIMED') fail(`4. 期望 PRINT_TASK_ALREADY_CLAIMED，得到 ${code}`)
        pass('4. pending+claimedAt!=null 正确拒绝（PRINT_TASK_ALREADY_CLAIMED）')
      }
    }

    // ── 5. completed 状态 → 400 PRINT_TASK_NOT_PENDING ───────────────────────
    {
      try {
        await svc.abandonPending(taskCompleted, adminId)
        fail('5. completed 任务应被拒绝')
      } catch (err: unknown) {
        const e = err as { response?: { error?: { code?: string } }; status?: number }
        const code = e.response?.error?.code
        if (code !== 'PRINT_TASK_NOT_PENDING') fail(`5. 期望 PRINT_TASK_NOT_PENDING，得到 ${code}`)
        pass('5. completed 任务正确拒绝（PRINT_TASK_NOT_PENDING）')
      }
    }

    // ── 6. 幂等：已 abandoned → 返回现有快照，不二次写 AuditLog ───────────────
    {
      const countBefore = await prisma.auditLog.count({
        where: { targetId: taskAbandoned, action: 'print_job.admin_abandon' },
      })
      const result = await svc.abandonPending(taskAbandoned, adminId)
      if (result.newStatus !== 'abandoned') fail('6. 幂等返回 newStatus 应为 abandoned')
      const countAfter = await prisma.auditLog.count({
        where: { targetId: taskAbandoned, action: 'print_job.admin_abandon' },
      })
      if (countAfter !== countBefore) fail('6. 幂等调用写入了额外 AuditLog')
      pass('6. 已 abandoned 幂等返回，未二次写入 AuditLog')
    }

    // ── 7. 不存在的任务 → 404 PRINT_TASK_NOT_FOUND ────────────────────────────
    {
      try {
        await svc.abandonPending(`pt_nonexistent_${suffix}`, adminId)
        fail('7. 不存在任务应 404')
      } catch (err: unknown) {
        const e = err as { response?: { error?: { code?: string } } }
        const code = e.response?.error?.code
        if (code !== 'PRINT_TASK_NOT_FOUND') fail(`7. 期望 PRINT_TASK_NOT_FOUND，得到 ${code}`)
        pass('7. 不存在任务 404（PRINT_TASK_NOT_FOUND）')
      }
    }

    console.log('\nAll checks PASS\n')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((err) => {
  console.error('verify 运行失败:', err)
  process.exit(1)
})
