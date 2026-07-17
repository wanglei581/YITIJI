import { Injectable, Logger } from '@nestjs/common'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import type {
  AuditAction,
  AuditLogListQuery,
  AuditLogListResponse,
  AuditLogRecord,
  AuditTargetType,
} from './audit.types'

interface AuditWriteArgs {
  actorId: string | null
  actorRole: string
  action: AuditAction | string
  targetType: AuditTargetType | string
  targetId?: string | null
  payload?: Record<string, unknown>
  ipAddress?: string | null
  userAgent?: string | null
  requestId?: string | null
}

/**
 * 审计日志服务(BE-2)。
 *
 * 设计要点:
 *   1. **同步写入**:write() 必须等数据库 INSERT 完成再返回。
 *      Mavis 报告专家指出 R5 异步队列与"演示当天点击立即看到日志"矛盾,
 *      P0 阶段同步写,P1 流量上来再评估异步化。
 *   2. **写失败不阻塞业务**:catch 内只 log,不抛 —— 审计失败属于平台问题,
 *      不应因此把用户的正当操作回滚。但要确保 logger.error 落 ops 告警。
 *   3. **只 INSERT,绝不 UPDATE/DELETE**:本服务故意没有 update/delete 方法,
 *      防御未来的开发误用。归档与清理走独立的 ops 任务,不在业务 API 暴露。
 *   4. **payload 序列化**:写入前 JSON.stringify,长度 cap 4KB,防误把
 *      大对象(整份简历 base64)塞进 payloadJson 把表撑爆。
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)
  private static readonly PAYLOAD_MAX_BYTES = 4 * 1024

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 写一条审计。同步等数据库返回。失败只 log 不抛。
   *
   * 调用方约定:
   *   - 业务动作完成后再调(避免动作回滚但审计已落)
   *   - actor 缺失(系统级动作)允许 null,但 actorRole 必填
   *   - payload 只放"上下文摘要"(reason / 旧值 / 新值 / 计数),
   *     避免塞整份请求体
   */
  async write(args: AuditWriteArgs): Promise<string | null> {
    const payloadJson = this.safeStringify(args.payload ?? {})
    try {
      const row = await this.prisma.auditLog.create({
        data: {
          actorId: args.actorId,
          actorRole: args.actorRole,
          action: args.action,
          targetType: args.targetType,
          targetId: args.targetId ?? null,
          payloadJson,
          ipAddress: args.ipAddress ?? null,
          userAgent: args.userAgent ?? null,
          requestId: args.requestId ?? null,
        },
      })
      return row.id
    } catch (err) {
      // 审计写失败属于平台问题,记 ops 日志便于排查,
      // 但绝不抛回上游,避免业务因此回滚。
      this.logger.error(
        `Audit write failed (action=${args.action}, target=${args.targetType}:${args.targetId ?? '-'}): ${(err as Error).message}`,
      )
      return null
    }
  }

  /**
   * 在调用方事务内写必须成功的审计记录。
   *
   * 与 write() 共用同一 payload 限长规则，但不捕获数据库异常：隐私状态、
   * consent 撤回等强一致动作必须在审计失败时一起回滚。
   */
  async writeRequired(
    tx: Pick<PrismaTransactionClient, 'auditLog'>,
    args: AuditWriteArgs,
  ): Promise<string> {
    const payloadJson = this.safeStringify(args.payload ?? {})
    const row = await tx.auditLog.create({
      data: {
        actorId: args.actorId,
        actorRole: args.actorRole,
        action: args.action,
        targetType: args.targetType,
        targetId: args.targetId ?? null,
        payloadJson,
        ipAddress: args.ipAddress ?? null,
        userAgent: args.userAgent ?? null,
        requestId: args.requestId ?? null,
      },
    })
    return row.id
  }

  /** 列表查询(admin)。 */
  async list(query: AuditLogListQuery = {}): Promise<AuditLogListResponse> {
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 500)
    const offset = Math.max(Number(query.offset ?? 0), 0)

    const where: Record<string, unknown> = {}
    if (query.action) where['action'] = query.action
    if (query.actorId) where['actorId'] = query.actorId
    if (query.targetType) where['targetType'] = query.targetType
    if (query.targetId) where['targetId'] = query.targetId
    if (query.startAt || query.endAt) {
      const range: Record<string, Date> = {}
      if (query.startAt) range['gte'] = new Date(query.startAt)
      if (query.endAt) range['lt'] = new Date(query.endAt)
      where['createdAt'] = range
    }

    const [records, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditLog.count({ where }),
    ])

    return {
      items: records.map(this.toRecord),
      total,
      limit,
      offset,
    }
  }

  // ── 内部 ────────────────────────────────────────────────────────────────────

  private safeStringify(payload: Record<string, unknown>): string {
    try {
      const s = JSON.stringify(payload)
      if (s.length <= AuditService.PAYLOAD_MAX_BYTES) return s
      return JSON.stringify({ truncated: true, originalSize: s.length, head: s.slice(0, 2048) })
    } catch {
      return '{"error":"payload not serializable"}'
    }
  }

  private toRecord(r: {
    id: string
    actorId: string | null
    actorRole: string
    action: string
    targetType: string
    targetId: string | null
    payloadJson: string
    ipAddress: string | null
    userAgent: string | null
    requestId: string | null
    createdAt: Date
  }): AuditLogRecord {
    return {
      id: r.id,
      actorId: r.actorId,
      actorRole: r.actorRole,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      payloadJson: r.payloadJson,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      requestId: r.requestId,
      createdAt: r.createdAt.toISOString(),
    }
  }
}
