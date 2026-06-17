import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { buildMemberPage, memberPageArgs, type MemberPageQuery } from '../common/utils/member-page'
import {
  ACTIVITY_TARGET_TYPES,
  JUMP_ACTION_BY_TARGET,
  type ActivityJumpAction,
  type ActivityTargetType,
  type MemberBrowseLogItem,
  type MemberJumpLogItem,
} from './activity.types'

// ============================================================
// 浏览 / 外部跳转记录服务（P1 闭环）。
//
// 边界（compliance-boundary §4.4，长期红线）：
// - 只记录本人「浏览」与「打开来源平台入口」两类行为。
// - 不记录第三方平台上的投递结果 / 预约结果 / 企业处理 / 录取通知 / 签到入场
//   等任何流程状态；本服务没有也永远不会有这类字段。
// - 仅登录会员落库（endUserId 来自已校验 token）。匿名不落服务端——共享一体机上
//   匿名浏览历史无论存服务端还是本机 localStorage 都会泄露给下一位使用者。
//
// 防伪造：targetTitle / sourceName / sourceUrl / externalId 一律由服务端从
// 「已审核 + 已发布」的目标对象快照补齐，不接受前端传入；目标不存在或未发布
// 时拒绝记录（404），不产生指向不可见内容的脏记录。
//
// 留存：TTL 短留存（ACTIVITY_LOG_TTL_DAYS，默认 30 天），cron 每小时物理清理；
// 本人可随时删除（hard delete + 审计在 controller 层）。
// ============================================================

/** 同一会员对同一目标的浏览在该窗口内去重（不重复刷行，列表不被同一岗位刷屏）。 */
const BROWSE_DEDUP_WINDOW_MS = 30 * 60 * 1000

function ttlMs(): number {
  const days = Number(process.env['ACTIVITY_LOG_TTL_DAYS'] ?? '30')
  return (Number.isFinite(days) && days > 0 ? days : 30) * 24 * 60 * 60 * 1000
}

interface TargetSnapshot {
  targetTitle: string
  sourceName: string | null
  sourceUrl: string | null
  externalId: string | null
}

function assertTargetType(value: string): asserts value is ActivityTargetType {
  if (!(ACTIVITY_TARGET_TYPES as readonly string[]).includes(value)) {
    throw new BadRequestException({
      error: { code: 'ACTIVITY_INVALID_INPUT', message: '不支持的记录目标类型' },
    })
  }
}

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name)

  constructor(private readonly prisma: PrismaService) {}

  /** 只认「已审核 + 已发布」目标；未发布 / 不存在 → null（调用方拒绝记录）。 */
  private async loadPublishedTarget(
    targetType: ActivityTargetType,
    targetId: string,
  ): Promise<TargetSnapshot | null> {
    const published = { reviewStatus: 'approved', publishStatus: 'published' }
    if (targetType === 'job') {
      const job = await this.prisma.job.findFirst({
        where: { id: targetId, ...published },
        select: { title: true, sourceName: true, sourceUrl: true, externalId: true },
      })
      return job && { targetTitle: job.title, sourceName: job.sourceName, sourceUrl: job.sourceUrl, externalId: job.externalId }
    }
    if (targetType === 'job_fair') {
      const fair = await this.prisma.jobFair.findFirst({
        where: { id: targetId, ...published },
        select: { title: true, sourceName: true, sourceUrl: true, externalId: true },
      })
      return fair && { targetTitle: fair.title, sourceName: fair.sourceName, sourceUrl: fair.sourceUrl, externalId: fair.externalId }
    }
    if (targetType === 'company_profile') {
      const company = await this.prisma.companyProfile.findFirst({
        where: { id: targetId, ...published },
        select: { name: true, sourceName: true, sourceUrl: true, externalId: true },
      })
      // 企业来源页可能未提供(手工录入条目),如实存 null
      return company && { targetTitle: company.name, sourceName: company.sourceName, sourceUrl: company.sourceUrl, externalId: company.externalId }
    }
    if (targetType === 'fair_company') {
      const company = await this.prisma.fairCompany.findFirst({
        where: {
          id: targetId,
          jobFair: published,
        },
        select: {
          id: true,
          name: true,
          sourceUrl: true,
          jobFair: { select: { sourceName: true, sourceUrl: true, externalId: true } },
        },
      })
      return company && {
        targetTitle: company.name,
        sourceName: company.jobFair.sourceName,
        sourceUrl: company.sourceUrl ?? company.jobFair.sourceUrl,
        externalId: company.jobFair.externalId ? `${company.jobFair.externalId}:${company.id}` : company.id,
      }
    }
    const policy = await this.prisma.policyPost.findFirst({
      where: { id: targetId, ...published },
      select: { title: true, sourceName: true, externalUrl: true },
    })
    // 政策无外部编号；官方入口可能未提供（info-only 条目），如实存 null
    return policy && { targetTitle: policy.title, sourceName: policy.sourceName, sourceUrl: policy.externalUrl, externalId: null }
  }

  /** 记录一次浏览（30 分钟窗口内同目标去重，返回既有行）。 */
  async recordBrowse(
    endUserId: string,
    targetTypeRaw: string,
    targetId: string,
    terminalId: string | null,
  ): Promise<{ recorded: true; id: string; deduped: boolean }> {
    assertTargetType(targetTypeRaw)
    const targetType = targetTypeRaw
    const snapshot = await this.loadPublishedTarget(targetType, targetId)
    if (!snapshot) {
      throw new NotFoundException({
        error: { code: 'ACTIVITY_TARGET_NOT_FOUND', message: '记录目标不存在或未发布' },
      })
    }
    const recent = await this.prisma.browseLog.findFirst({
      where: {
        endUserId,
        targetType,
        targetId,
        createdAt: { gt: new Date(Date.now() - BROWSE_DEDUP_WINDOW_MS) },
      },
      select: { id: true },
    })
    if (recent) return { recorded: true, id: recent.id, deduped: true }
    const row = await this.prisma.browseLog.create({
      data: {
        endUserId,
        targetType,
        targetId,
        ...snapshot,
        terminalId,
        expiresAt: new Date(Date.now() + ttlMs()),
      },
      select: { id: true },
    })
    return { recorded: true, id: row.id, deduped: false }
  }

  /** 记录一次「打开来源平台 / 官方入口」跳转（每次点击都记录；不记录任何办理结果）。 */
  async recordJump(
    endUserId: string,
    targetTypeRaw: string,
    targetId: string,
    actionRaw: string,
    terminalId: string | null,
  ): Promise<{ recorded: true; id: string }> {
    assertTargetType(targetTypeRaw)
    const targetType = targetTypeRaw
    if (JUMP_ACTION_BY_TARGET[targetType] !== actionRaw) {
      throw new BadRequestException({
        error: { code: 'ACTIVITY_INVALID_INPUT', message: '跳转动作与目标类型不匹配' },
      })
    }
    const snapshot = await this.loadPublishedTarget(targetType, targetId)
    if (!snapshot) {
      throw new NotFoundException({
        error: { code: 'ACTIVITY_TARGET_NOT_FOUND', message: '记录目标不存在或未发布' },
      })
    }
    const row = await this.prisma.externalJumpLog.create({
      data: {
        endUserId,
        targetType,
        targetId,
        action: actionRaw,
        ...snapshot,
        terminalId,
        expiresAt: new Date(Date.now() + ttlMs()),
      },
      select: { id: true },
    })
    return { recorded: true, id: row.id }
  }

  /** 本人浏览记录（仅未过期；可按目标类型过滤；游标分页）。 */
  async listBrowse(endUserId: string, page: MemberPageQuery, targetType?: string) {
    if (targetType !== undefined) assertTargetType(targetType)
    const where = { endUserId, expiresAt: { gt: new Date() }, ...(targetType ? { targetType } : {}) }
    const total = await this.prisma.browseLog.count({ where })
    const rows = await this.prisma.browseLog.findMany({
      where,
      select: {
        id: true, targetType: true, targetId: true, targetTitle: true,
        sourceName: true, sourceUrl: true, externalId: true, createdAt: true,
      },
      ...memberPageArgs(page),
    })
    return buildMemberPage(rows, page, total, (r): MemberBrowseLogItem => ({
      id: r.id,
      targetType: r.targetType as ActivityTargetType,
      targetId: r.targetId,
      targetTitle: r.targetTitle,
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl,
      externalId: r.externalId,
      createdAt: r.createdAt.toISOString(),
    }))
  }

  /** 本人外部跳转记录（仅未过期；可按目标类型过滤；游标分页）。 */
  async listJumps(endUserId: string, page: MemberPageQuery, targetType?: string) {
    if (targetType !== undefined) assertTargetType(targetType)
    const where = { endUserId, expiresAt: { gt: new Date() }, ...(targetType ? { targetType } : {}) }
    const total = await this.prisma.externalJumpLog.count({ where })
    const rows = await this.prisma.externalJumpLog.findMany({
      where,
      select: {
        id: true, targetType: true, targetId: true, action: true, targetTitle: true,
        sourceName: true, sourceUrl: true, externalId: true, createdAt: true,
      },
      ...memberPageArgs(page),
    })
    return buildMemberPage(rows, page, total, (r): MemberJumpLogItem => ({
      id: r.id,
      targetType: r.targetType as ActivityTargetType,
      targetId: r.targetId,
      action: r.action as ActivityJumpAction,
      targetTitle: r.targetTitle,
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl,
      externalId: r.externalId,
      createdAt: r.createdAt.toISOString(),
    }))
  }

  /** 删除本人一条浏览记录（硬删；删他人 / 不存在统一 404，不泄露存在性）。 */
  async deleteBrowse(endUserId: string, id: string): Promise<{ deleted: true; targetType: string }> {
    const row = await this.prisma.browseLog.findFirst({ where: { id, endUserId }, select: { id: true, targetType: true } })
    if (!row) {
      throw new NotFoundException({ error: { code: 'MEMBER_RECORD_NOT_FOUND', message: '记录不存在或已删除' } })
    }
    await this.prisma.browseLog.deleteMany({ where: { id, endUserId } })
    return { deleted: true, targetType: row.targetType }
  }

  /** 删除本人一条外部跳转记录（硬删；删他人 / 不存在统一 404）。 */
  async deleteJump(endUserId: string, id: string): Promise<{ deleted: true; targetType: string }> {
    const row = await this.prisma.externalJumpLog.findFirst({ where: { id, endUserId }, select: { id: true, targetType: true } })
    if (!row) {
      throw new NotFoundException({ error: { code: 'MEMBER_RECORD_NOT_FOUND', message: '记录不存在或已删除' } })
    }
    await this.prisma.externalJumpLog.deleteMany({ where: { id, endUserId } })
    return { deleted: true, targetType: row.targetType }
  }

  /** TTL 到期物理清理（与 MockInterview / Files 同口径的小时级 cron）。 */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpired(): Promise<void> {
    const now = new Date()
    const browse = await this.prisma.browseLog.deleteMany({ where: { expiresAt: { lt: now } } })
    const jumps = await this.prisma.externalJumpLog.deleteMany({ where: { expiresAt: { lt: now } } })
    if (browse.count > 0 || jumps.count > 0) {
      this.logger.log(`activity.cleanup browse=${browse.count} jumps=${jumps.count}`)
    }
  }
}
