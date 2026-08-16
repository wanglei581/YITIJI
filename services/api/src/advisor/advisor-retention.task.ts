import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'

// ============================================================
// S3-3 · P26 顾问作业面的留存清理。
//
// 为什么必须有这个文件：AdvisorSession / AdvisorPin / AdvisorArtifact 三张表
// 落的是**用户本人写的原话**——
//   - AdvisorSession.topic     用户原始诉求正文（≤600 字，未脱敏）
//   - AdvisorSession.slotsJson 用户逐项填进输入槽的内容（可能含姓名/经历/联系方式）
//   - AdvisorPin.content       用户钉住的条目
//   - AdvisorArtifact.payloadJson 成稿 / 比对表（由上面几项派生）
//
// 三张表都声明了 expiresAt，但在本文件之前**没有任何代码物理删除它们**：
// 过期只在读取时被 loadOwned() 挡掉（advisor.service.ts），行本身永久留在库里。
// 结果是「用户看不到、也删不掉，但明文一直在」——比不留存更糟，因为它是隐形的。
//
// CLAUDE.md §11 要求敏感数据「设置有效期 / 支持自动清理 / 删除后保留删除日志」，
// 本任务把 advisor 拉齐到项目里既有的同类口径：
//   AiResultCleanupTask（AiResumeResult / JobAiSession / AiServiceLog）
//   MockInterviewService.cleanupExpired（MockInterviewSession → 级联 turns/report）
//   ActivityService.cleanupExpired（BrowseLog / ExternalJumpLog）
//
// 【为什么删除是安全的、对功能零影响】
// advisor 的每一条读路径都先过 AdvisorService.loadOwned()，其中
//   `if (!row || row.expiresAt.getTime() < Date.now()) throw notFound()`
// 也就是说：会话一旦过期，它自己、它的 pins、它的 artifacts 就已经**永久不可达**了
// （artifact 的 GET/print 都是 sessionId 作用域的）。本任务删掉的正是这批已经
// 不可达的死行，用户可见行为完全不变。
//
// 【为什么不会删掉「我的文档」里的东西】
// 产物打印后生成的是独立的 FileObject（走 files 链路，有自己的 retentionPolicy）。
// 删 AdvisorArtifact 行不动 FileObject，会员在「我的文档」里已保存的 PDF 不受影响。
//
// 【日志与审计口径】
// 只记条数，绝不记 topic / slots / pin 内容 / 产物正文。审计 payload 同理。
// ============================================================

@Injectable()
export class AdvisorRetentionTask {
  private readonly logger = new Logger(AdvisorRetentionTask.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourly(): Promise<void> {
    await this.cleanupExpired('cron')
  }

  /**
   * 物理删除过期的顾问会话与过期产物。
   *
   * 两步而不是一步：
   *  1. 删过期会话 → 级联删掉它的 pins 与 artifacts（onDelete: Cascade）。
   *  2. 再删「会话还活着、但自己 TTL 已到」的产物。ADVISOR_ARTIFACT_TTL_HOURS 是
   *     从产物生成时刻起算的独立窗口，可以早于或晚于会话窗口；只做第 1 步会让
   *     这批产物一直留着。它们同样已被读路径的 `expiresAt: { gt: now }` 挡掉。
   */
  async cleanupExpired(triggeredBy: 'manual' | 'cron'): Promise<{
    deletedSessions: number
    deletedArtifacts: number
  }> {
    const now = new Date()
    let deletedSessions = 0
    let deletedArtifacts = 0

    try {
      deletedSessions = (
        await this.prisma.advisorSession.deleteMany({ where: { expiresAt: { lt: now } } })
      ).count
      deletedArtifacts = (
        await this.prisma.advisorArtifact.deleteMany({ where: { expiresAt: { lt: now } } })
      ).count
    } catch (err) {
      // 清理失败不能拖垮 cron 里的其它任务；只记错误类型，不记 where 之外的任何内容。
      this.logger.error(`advisor.cleanup_failed reason=${(err as Error).name}`)
      return { deletedSessions, deletedArtifacts }
    }

    if (deletedSessions === 0 && deletedArtifacts === 0) {
      return { deletedSessions: 0, deletedArtifacts: 0 }
    }

    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'advisor_session.cleanup_expired',
      targetType: 'advisor_session',
      targetId: null,
      // 仅元数据：不含用户诉求正文 / 输入槽 / 钉住条目 / 产物内容
      payload: { triggeredBy, deletedSessions, deletedArtifacts },
      ipAddress: null,
      userAgent: null,
      requestId: null,
    })
    this.logger.log(
      `advisor.cleanup sessions=${deletedSessions} artifacts=${deletedArtifacts}`,
    )
    return { deletedSessions, deletedArtifacts }
  }
}
