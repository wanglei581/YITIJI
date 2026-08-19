/**
 * Admin 核查出纸结果（printOutcome）写路径。
 *
 * 覆盖：
 *   1. 仅 paid + failed + PRINT_JOB_UNCONFIRMED + printOutcome=null 可写
 *   2. 确认短语门禁；同结论幂等；不同结论冲突
 *   3. 不改 errorCode / status；事务内写 StatusLog + AuditLog
 *   4. printed 禁止退款；not_printed 仍可全额退款
 *   5. 已核查任务不再进入派生失败告警
 *
 * 运行：pnpm --filter @ai-job-print/api verify:admin-print-outcome
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { BadRequestException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { RefundService } from '../src/payment/refund.service'
import { AdminOpsService } from '../src/admin-ops/admin-ops.service'
import { AdminPrintJobsVerifyOutcomeService } from '../src/print-jobs/admin-print-jobs-verify-outcome.service'
import type { PaymentProvider } from '../src/payment/payment-provider.types'

function pass(msg: string): void { console.log(`  PASS ${msg}`) }
function fail(msg: string): never { throw new Error(msg) }

function errorCode(err: unknown): string | undefined {
  const e = err as {
    message?: string
    response?: { error?: { code?: string } }
    getResponse?: () => { error?: { code?: string } }
  }
  return e.response?.error?.code ?? e.getResponse?.()?.error?.code ?? e.message
}

function makeSandboxProvider(): Partial<PaymentProvider> & Pick<PaymentProvider, 'refund'> {
  return {
    channel: 'sandbox' as const,
    refund: async () => ({ status: 'success', channelRefundNo: null }),
  }
}

async function main(): Promise<void> {
  console.log('\n=== Admin print-outcome 核查状态机验证 ===')
  if (process.env['NODE_ENV'] === 'production') {
    console.error('  FAIL verify:admin-print-outcome 不得在 production 运行')
    process.exit(1)
  }

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const verifySvc = new AdminPrintJobsVerifyOutcomeService(prisma, audit)
  const ops = new AdminOpsService(prisma)
  const registry = { get: (channel: string) => (channel === 'sandbox' ? makeSandboxProvider() : undefined) }
  const refundService = new RefundService(prisma, audit, registry as never)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const adminId = `user_vpo_adm_${suffix}`
  const termId = `term_vpo_${suffix}`
  const taskPrinted = `pt_vpo_printed_${suffix}`
  const taskNotPrinted = `pt_vpo_notp_${suffix}`
  const taskOrdinary = `pt_vpo_off_${suffix}`
  const ordPrinted = `ord_vpo_printed_${suffix}`
  const ordNotPrinted = `ord_vpo_notp_${suffix}`
  const orderNoPrinted = `ORD-VPO-P-${suffix.toUpperCase()}`
  const orderNoNotPrinted = `ORD-VPO-N-${suffix.toUpperCase()}`

  async function cleanup(): Promise<void> {
    await prisma.refund.deleteMany({ where: { orderId: { in: [ordPrinted, ordNotPrinted] } } })
    await prisma.order.deleteMany({ where: { id: { in: [ordPrinted, ordNotPrinted] } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: [taskPrinted, taskNotPrinted, taskOrdinary] } } })
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [taskPrinted, taskNotPrinted] } } })
    await prisma.printTask.deleteMany({ where: { id: { in: [taskPrinted, taskNotPrinted, taskOrdinary] } } })
    await prisma.terminal.deleteMany({ where: { id: termId } })
    await prisma.user.deleteMany({ where: { id: adminId } })
  }

  try {
    await cleanup()
    await prisma.user.create({
      data: {
        id: adminId,
        username: `vpo_admin_${suffix}`,
        name: `VPO Admin ${suffix}`,
        passwordHash: 'hash',
        role: 'admin',
        enabled: true,
        tokenVersion: 0,
      },
    })
    await prisma.terminal.create({
      data: {
        id: termId,
        terminalCode: `VPO-${suffix}`,
        agentToken: `tok_vpo_${suffix}`,
        deviceFingerprint: 'verify-admin-print-outcome',
      },
    })
    await prisma.printTask.createMany({
      data: [
        {
          id: taskPrinted,
          terminalId: termId,
          fileUrl: 'https://internal/vpo-printed',
          fileMd5: 'vpo-printed',
          status: 'failed',
          errorCode: 'PRINT_JOB_UNCONFIRMED',
          errorMessage: 'must-not-overwrite',
        },
        {
          id: taskNotPrinted,
          terminalId: termId,
          fileUrl: 'https://internal/vpo-not-printed',
          fileMd5: 'vpo-not-printed',
          status: 'failed',
          errorCode: 'PRINT_JOB_UNCONFIRMED',
        },
        {
          id: taskOrdinary,
          terminalId: termId,
          fileUrl: 'https://internal/vpo-offline',
          fileMd5: 'vpo-offline',
          status: 'failed',
          errorCode: 'PRINTER_OFFLINE',
        },
      ],
    })
    await prisma.order.createMany({
      data: [
        {
          id: ordPrinted,
          orderNo: orderNoPrinted,
          type: 'print',
          printTaskId: taskPrinted,
          terminalId: termId,
          amountCents: 200,
          currency: 'CNY',
          payStatus: 'paid',
          taskStatus: 'failed',
          paymentSource: 'sandbox',
          discountCents: 0,
        },
        {
          id: ordNotPrinted,
          orderNo: orderNoNotPrinted,
          type: 'print',
          printTaskId: taskNotPrinted,
          terminalId: termId,
          amountCents: 150,
          currency: 'CNY',
          payStatus: 'paid',
          taskStatus: 'failed',
          paymentSource: 'sandbox',
          discountCents: 0,
        },
      ],
    })

    try {
      await verifySvc.verifyOutcome(taskPrinted, { outcome: 'printed', confirm: 'WRONG' }, adminId)
      fail('错误确认短语应被拒绝')
    } catch (err) {
      if (errorCode(err) !== 'PRINT_OUTCOME_CONFIRM_REQUIRED') fail(`期望 PRINT_OUTCOME_CONFIRM_REQUIRED，得到 ${errorCode(err)}`)
      pass('错误确认短语被 PRINT_OUTCOME_CONFIRM_REQUIRED 拒绝')
    }

    try {
      await verifySvc.verifyOutcome(taskOrdinary, { outcome: 'printed', confirm: 'VERIFY_PRINTED' }, adminId)
      fail('普通失败任务不应允许核查')
    } catch (err) {
      if (errorCode(err) !== 'PRINT_OUTCOME_NOT_UNCONFIRMED') fail(`期望 PRINT_OUTCOME_NOT_UNCONFIRMED，得到 ${errorCode(err)}`)
      pass('非 UNCONFIRMED 失败任务被拒绝')
    }

    const first = await verifySvc.verifyOutcome(taskPrinted, { outcome: 'printed', confirm: 'VERIFY_PRINTED' }, adminId)
    const printedTask = await prisma.printTask.findUniqueOrThrow({ where: { id: taskPrinted } })
    if (first.printOutcome !== 'printed' || first.idempotent !== false) fail(`首次核查返回异常：${JSON.stringify(first)}`)
    if (printedTask.printOutcome !== 'printed') fail('printOutcome 未落库 printed')
    if (printedTask.errorCode !== 'PRINT_JOB_UNCONFIRMED') fail('核查不得覆盖 errorCode')
    if (printedTask.status !== 'failed') fail('核查不得改 status')
    if (printedTask.errorMessage !== 'must-not-overwrite') fail('核查不得改 errorMessage')
    const statusLogs = await prisma.printTaskStatusLog.findMany({ where: { taskId: taskPrinted } })
    if (statusLogs.length !== 1 || statusLogs[0]?.errorCode !== 'PRINT_OUTCOME_PRINTED') {
      fail(`StatusLog 异常：${JSON.stringify(statusLogs)}`)
    }
    const audits = await prisma.auditLog.findMany({
      where: { targetId: taskPrinted, action: 'print_job.admin_verify_outcome' },
    })
    if (audits.length !== 1 || audits[0]?.actorId !== adminId) fail('首次核查未写入审计')
    pass('已核查·已出纸：落库、保留 UNCONFIRMED、写 StatusLog+Audit')

    const again = await verifySvc.verifyOutcome(taskPrinted, { outcome: 'printed', confirm: 'VERIFY_PRINTED' }, adminId)
    if (again.idempotent !== true) fail('同结论应幂等')
    const auditCount = await prisma.auditLog.count({
      where: { targetId: taskPrinted, action: 'print_job.admin_verify_outcome' },
    })
    if (auditCount !== 1) fail('幂等核查不得二次写审计')
    pass('同结论幂等，不二次写审计')

    try {
      await verifySvc.verifyOutcome(taskPrinted, { outcome: 'not_printed', confirm: 'VERIFY_NOT_PRINTED' }, adminId)
      fail('不同结论应冲突')
    } catch (err) {
      if (errorCode(err) !== 'PRINT_OUTCOME_ALREADY_VERIFIED') fail(`期望 PRINT_OUTCOME_ALREADY_VERIFIED，得到 ${errorCode(err)}`)
      pass('不同结论冲突拒绝')
    }

    try {
      await refundService.refund(ordPrinted, { reason: '已出纸不应退款', operatorId: adminId })
      fail('已确认出纸应禁止退款')
    } catch (err) {
      if (!(err instanceof BadRequestException) || err.message !== 'PRINT_REFUND_VERIFIED_PRINTED_FORBIDDEN') {
        throw err
      }
      pass('已确认出纸退款被 PRINT_REFUND_VERIFIED_PRINTED_FORBIDDEN 拒绝')
    }

    await verifySvc.verifyOutcome(taskNotPrinted, { outcome: 'not_printed', confirm: 'VERIFY_NOT_PRINTED' }, adminId)
    const refunded = await refundService.refund(ordNotPrinted, { reason: '现场确认未出纸', operatorId: adminId })
    if (refunded.refund.amountCents !== 150) fail(`未出纸退款额异常：${JSON.stringify(refunded)}`)
    const notPrintedTask = await prisma.printTask.findUniqueOrThrow({ where: { id: taskNotPrinted } })
    if (notPrintedTask.printOutcome !== 'not_printed' || notPrintedTask.errorCode !== 'PRINT_JOB_UNCONFIRMED') {
      fail('未出纸核查后任务状态被破坏')
    }
    pass('已核查·未出纸后仍可全额退款，且不改 UNCONFIRMED')

    const { data: alerts } = await ops.listDerivedAlerts()
    if (alerts.some((alert) => alert.id === `print_failed:${taskPrinted}` || alert.id === `print_failed:${taskNotPrinted}`)) {
      fail('已核查任务不得再进派生失败告警')
    }
    if (!alerts.some((alert) => alert.id === `print_failed:${taskOrdinary}`)) {
      fail('普通失败任务仍应告警')
    }
    pass('已核查任务退出告警，普通失败仍告警')

    console.log('\nALL PASS')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((error: unknown) => {
  console.error('VERIFY FAILED:', error)
  process.exit(1)
})
