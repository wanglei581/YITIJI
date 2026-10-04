import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { readClosureRetentionYears } from './member-closure-retention'

/**
 * 个人信息到期清理（《个人信息保护法》第十九条：保存期限为实现处理目的所必要的最短时间）。
 *
 * 三组，全部**默认不清理**——年限待律师确认（律师清单第 31–33、56 问），配置了才动：
 * - 审计日志 `AUDIT_LOG_RETENTION_DAYS`：网络安全法要求网络日志不少于六个月，配置值低于 180 天一律拒绝执行。
 *   `AUDIT_LOG_RETENTION_MODE=scrub`（缺省）只去掉 IP、浏览器标识和打码手机号，保留「谁在什么时候做了什么」；
 *   `delete` 整行删除。
 * - 注销后保留的同意记录 `CLOSURE_RETAINED_CONSENT_YEARS`：已匿名化账号、匿名化满 N 年后删除。
 * - 注销后保留的订单与账务流水 `CLOSURE_RETAINED_ORDER_YEARS`：已匿名化账号、匿名化满 N 年后删除订单及其明细、
 *   支付、退款、打印任务与状态流水、提交流水、核销流水。
 * 只碰已匿名化（注销完成）的账号壳；在用账号的任何记录都不受影响。
 */
export const AUDIT_LOG_MIN_RETENTION_DAYS = 180
const BATCH = 500
const MAX_BATCHES = 20
const DAY_MS = 24 * 3600_000
const YEAR_MS = 365 * DAY_MS

export interface AuditRetentionConfig { days: number; mode: 'scrub' | 'delete' }

/** 未配置返回 null；配置了但不合法（含低于 180 天）抛错，调用方不得执行任何删除。 */
export function readAuditRetention(env: NodeJS.ProcessEnv = process.env): AuditRetentionConfig | null {
  const raw = env['AUDIT_LOG_RETENTION_DAYS']?.trim()
  if (!raw) return null
  const days = Number(raw)
  if (!Number.isSafeInteger(days) || days < AUDIT_LOG_MIN_RETENTION_DAYS) throw new Error('INVALID_AUDIT_LOG_RETENTION_DAYS')
  const mode = (env['AUDIT_LOG_RETENTION_MODE']?.trim() || 'scrub').toLowerCase()
  if (mode !== 'scrub' && mode !== 'delete') throw new Error('INVALID_AUDIT_LOG_RETENTION_MODE')
  return { days, mode }
}

const MASKED_PHONE_RE = /(?<!\d)1[3-9]\d\*{4}\d{4}(?!\d)/gu
const FULL_PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/gu
export function scrubAuditPayload(payloadJson: string): string {
  return payloadJson.replace(MASKED_PHONE_RE, '[已清除]').replace(FULL_PHONE_RE, '[已清除]')
}

export interface RetentionSweepResult {
  audit: { scrubbed: number; deleted: number; skipped?: string }
  consents: { deleted: number }
  orders: { orders: number; printTasks: number; ledgers: number; redemptions: number }
  /** 某一组达到单轮上限、还有没清完的；下一天的任务接着清。 */
  truncated: boolean
}

export async function sweepPersonalDataRetention(prisma: PrismaService, now = new Date()): Promise<RetentionSweepResult> {
  const result: RetentionSweepResult = {
    audit: { scrubbed: 0, deleted: 0 }, consents: { deleted: 0 },
    orders: { orders: 0, printTasks: 0, ledgers: 0, redemptions: 0 }, truncated: false,
  }
  let audit: AuditRetentionConfig | null = null
  try {
    audit = readAuditRetention()
  } catch (error) {
    result.audit.skipped = (error as Error).message
  }
  if (audit) result.truncated = (await sweepAuditLogs(prisma, audit, now, result)) || result.truncated
  const years = readClosureRetentionYears()
  if (years.consents) result.truncated = (await sweepConsents(prisma, years.consents, now, result)) || result.truncated
  if (years.orders) result.truncated = (await sweepOrders(prisma, years.orders, now, result)) || result.truncated
  return result
}

async function sweepAuditLogs(prisma: PrismaService, cfg: AuditRetentionConfig, now: Date, result: RetentionSweepResult): Promise<boolean> {
  const cutoff = new Date(now.getTime() - cfg.days * DAY_MS)
  let cursor: string | null = null
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    if (cfg.mode === 'delete') {
      const rows = await prisma.auditLog.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take: BATCH })
      if (rows.length) result.audit.deleted += (await prisma.auditLog.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } })).count
      if (rows.length < BATCH) return false
      continue
    }
    // 只取还可能带身份痕迹的行，按 id 游标往前走：payload 里有「****」但不是手机号的行（例如打码的证件号）
    // 本轮只看一次、不会被反复取到；没有变化的行不写。
    const rows: Array<{ id: string; payloadJson: string; ipAddress: string | null; userAgent: string | null }> = await prisma.auditLog.findMany({
      where: { createdAt: { lt: cutoff }, ...(cursor ? { id: { gt: cursor } } : {}),
        OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }, { payloadJson: { contains: '****' } }] },
      select: { id: true, payloadJson: true, ipAddress: true, userAgent: true }, take: BATCH, orderBy: { id: 'asc' },
    })
    for (const row of rows) {
      const payloadJson = scrubAuditPayload(row.payloadJson)
      if (row.ipAddress === null && row.userAgent === null && payloadJson === row.payloadJson) continue
      await prisma.auditLog.update({ where: { id: row.id }, data: { ipAddress: null, userAgent: null, payloadJson } })
      result.audit.scrubbed++
    }
    cursor = rows.at(-1)?.id ?? cursor
    if (rows.length < BATCH) return false
  }
  return true
}

/** 匿名化满 N 年的账号壳 id；只取已完成注销的账号。 */
async function expiredShells(prisma: PrismaService, years: number, now: Date, skip: number): Promise<string[]> {
  const rows = await prisma.endUser.findMany({
    where: { status: 'anonymized', anonymizedAt: { lt: new Date(now.getTime() - years * YEAR_MS) } },
    select: { id: true }, orderBy: { id: 'asc' }, take: BATCH, skip,
  })
  return rows.map((row) => row.id)
}

async function sweepConsents(prisma: PrismaService, years: number, now: Date, result: RetentionSweepResult): Promise<boolean> {
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const ids = await expiredShells(prisma, years, now, batch * BATCH)
    if (ids.length) {
      result.consents.deleted += (await prisma.memberLegalConsent.deleteMany({ where: { endUserId: { in: ids } } })).count
      result.consents.deleted += (await prisma.userAiConsent.deleteMany({ where: { endUserId: { in: ids } } })).count
    }
    if (ids.length < BATCH) return false
  }
  return true
}

async function sweepOrders(prisma: PrismaService, years: number, now: Date, result: RetentionSweepResult): Promise<boolean> {
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const ids = await expiredShells(prisma, years, now, batch * BATCH)
    if (ids.length) {
      await prisma.$transaction(async (tx) => {
        const orders = await tx.order.findMany({ where: { endUserId: { in: ids } }, select: { id: true, printTaskId: true } })
        const orderIds = orders.map((row) => row.id)
        const tasks = await tx.printTask.findMany({
          where: { OR: [{ endUserId: { in: ids } }, { orderId: { in: orderIds } }, { id: { in: orders.flatMap((row) => (row.printTaskId ? [row.printTaskId] : [])) } }] },
          select: { id: true },
        })
        const taskIds = tasks.map((row) => row.id)
        // 外键是限制删除的：先删引用方，再删订单，最后删打印任务。订单明细随订单级联。
        await tx.refund.deleteMany({ where: { orderId: { in: orderIds } } })
        await tx.paymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } })
        result.orders.orders += (await tx.order.deleteMany({ where: { id: { in: orderIds } } })).count
        await tx.printTaskStatusLog.deleteMany({ where: { taskId: { in: taskIds } } })
        result.orders.printTasks += (await tx.printTask.deleteMany({ where: { id: { in: taskIds } } })).count
        result.orders.ledgers += (await tx.orderSubmissionLedger.deleteMany({ where: { endUserId: { in: ids } } })).count
        result.orders.redemptions += (await tx.redemptionRecord.deleteMany({ where: { endUserId: { in: ids } } })).count
      })
    }
    if (ids.length < BATCH) return false
  }
  return true
}

@Injectable()
export class PersonalDataRetentionTask {
  private readonly logger = new Logger(PersonalDataRetentionTask.name)
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleDaily(): Promise<RetentionSweepResult | null> {
    try {
      const result = await sweepPersonalDataRetention(this.prisma)
      if (result.audit.skipped) this.logger.error(`personal data retention: audit cleanup skipped (${result.audit.skipped})`)
      const changed = result.audit.scrubbed + result.audit.deleted + result.consents.deleted + result.orders.orders + result.orders.printTasks
        + result.orders.ledgers + result.orders.redemptions
      if (changed > 0 || result.audit.skipped) {
        // 删除后保留删除日志（CLAUDE.md §11）：只记条数，不记任何内容。
        await this.audit.write({ actorId: null, actorRole: 'system', action: 'personal_data.retention_sweep', targetType: 'system', targetId: null, payload: { ...result } })
      }
      return result
    } catch (error) {
      this.logger.error(`personal data retention failed: ${(error as Error).message}`)
      return null
    }
  }
}
