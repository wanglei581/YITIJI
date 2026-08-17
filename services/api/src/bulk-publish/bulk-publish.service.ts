// ============================================================
// BulkPublishService — 信息源批量发布(岗位 / 招聘会 / 政策)
//
// 设计红线(改动前请先读完):
//
//  1. **不另开状态机捷径**:execute 逐条调用与单条发布**完全相同**的服务方法
//     (JobsService.publishJobSource / publishFairSource、PoliciesService.publishPolicy)。
//     本文件不含任何 prisma.*.update({ publishStatus }) 写发布状态的代码。
//     校验(PUBLISH_REQUIRES_APPROVAL)、审计、日志因此天然与单条路径一致。
//
//  2. **不绕过审核**:preview 只把 reviewStatus='approved' 的条目列为候选;
//     execute 即便收到 pending/rejected 的 id,也会被复用的单条方法拒绝,
//     并以 failed 明细如实回报(不静默丢弃、不当成功计数)。
//
//  3. **不伪造成功**:execute 返回逐条结果 + 成功/失败计数,
//     没有任何顶层 { ok: true }。部分失败就是部分失败。
//
//  4. **不包大事务**:见 executeBulkPublish 注释。
// ============================================================

import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { JobsService } from '../jobs/jobs.service'
import { PoliciesService } from '../policies/policies.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'

export type BulkPublishKind = 'job' | 'fair' | 'policy'

/**
 * 单次 execute 请求的硬上限。
 *
 * 为什么是上限 + 前端分轮,而不是「一次提交几百条」:
 *   - 每条都要走单条发布路径(1 次 findUnique + 1 次 update + 1 次审计 INSERT),
 *     几百条串起来会顶到 HTTP / 反代超时,失败后操作者无法判断哪些已生效。
 *   - 分轮之后每轮都是独立、短小、可重放的请求;中断只影响当前这一轮。
 * 与 preview 的 batchLimit 是同一个数,保证「预览到多少就能提交多少」。
 */
export const BULK_PUBLISH_MAX_BATCH = 100

/** 允许被批量发布的起始发布态。expired 故意排除:批量动作不复活过期内容。 */
const BULK_PUBLISHABLE_FROM: readonly string[] = ['draft', 'unpublished']

export interface BulkPublishFilter {
  kind: BulkPublishKind
  sourceOrgId?: string
  syncTimeFrom?: string
  syncTimeTo?: string
}

export interface BulkPublishPreviewItem {
  id: string
  title: string
  sourceOrgId: string
  sourceName: string
  syncTime: string
  publishStatus: string
}

export interface BulkPublishPreviewResult {
  kind: BulkPublishKind
  /** 本轮实际可提交的 id 上限 */
  batchLimit: number
  /** 命中筛选且合格(approved + draft/unpublished)的**总数**,可能大于 items.length */
  eligibleTotal: number
  /** 本轮候选明细,最多 batchLimit 条 */
  items: BulkPublishPreviewItem[]
  /** eligibleTotal > items.length 时为 true —— 需要多轮 */
  truncated: boolean
  /** 命中筛选但被排除的条目数,按原因分列,便于操作者理解「为什么不是全部」 */
  excluded: {
    notApproved: number
    alreadyPublished: number
    expired: number
  }
}

export interface BulkPublishItemResult {
  id: string
  title: string
  status: 'published' | 'failed'
  toPublishStatus?: string
  errorCode?: string
  errorMessage?: string
}

export interface BulkPublishExecuteResult {
  kind: BulkPublishKind
  requested: number
  publishedCount: number
  failedCount: number
  /** 逐条结果,顺序与请求 ids 一致 */
  results: BulkPublishItemResult[]
}

interface KindDescriptor {
  /** prisma 模型访问器 */
  findMany: (args: Record<string, unknown>) => Promise<Record<string, unknown>[]>
  count: (args: Record<string, unknown>) => Promise<number>
  /** 标题列名(招聘会是 name,岗位/政策是 title) */
  titleField: string
  /** 复用的单条发布方法 —— 批量与单条的唯一执行路径 */
  publishOne: (id: string, user: AuthedUser) => Promise<unknown>
  auditTargetType: string
}

@Injectable()
export class BulkPublishService {
  private readonly logger = new Logger(BulkPublishService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly policies: PoliciesService,
  ) {}

  private descriptor(kind: BulkPublishKind): KindDescriptor {
    if (kind === 'job') {
      return {
        findMany: (args) => this.prisma.job.findMany(args as never) as unknown as Promise<Record<string, unknown>[]>,
        count: (args) => this.prisma.job.count(args as never),
        titleField: 'title',
        publishOne: (id, user) => this.jobs.publishJobSource(id, 'publish', user),
        auditTargetType: 'job',
      }
    }
    if (kind === 'fair') {
      return {
        findMany: (args) => this.prisma.jobFair.findMany(args as never) as unknown as Promise<Record<string, unknown>[]>,
        count: (args) => this.prisma.jobFair.count(args as never),
        titleField: 'name',
        publishOne: (id, user) => this.jobs.publishFairSource(id, 'publish', user),
        auditTargetType: 'fair',
      }
    }
    return {
      findMany: (args) => this.prisma.policyPost.findMany(args as never) as unknown as Promise<Record<string, unknown>[]>,
      count: (args) => this.prisma.policyPost.count(args as never),
      titleField: 'title',
      publishOne: (id, user) => this.policies.publishPolicy(id, 'publish', user),
      auditTargetType: 'policy',
    }
  }

  /** 把筛选条件翻译成 prisma where 片段(不含状态条件) */
  private scopeWhere(filter: BulkPublishFilter): Record<string, unknown> {
    const where: Record<string, unknown> = {}
    if (filter.sourceOrgId) where.sourceOrgId = filter.sourceOrgId

    const syncTime: Record<string, Date> = {}
    if (filter.syncTimeFrom) {
      const from = new Date(filter.syncTimeFrom)
      if (Number.isNaN(from.getTime())) {
        throw new BadRequestException({
          error: { code: 'INVALID_TIME_RANGE', message: 'syncTimeFrom 不是合法时间' },
        })
      }
      syncTime.gte = from
    }
    if (filter.syncTimeTo) {
      const to = new Date(filter.syncTimeTo)
      if (Number.isNaN(to.getTime())) {
        throw new BadRequestException({
          error: { code: 'INVALID_TIME_RANGE', message: 'syncTimeTo 不是合法时间' },
        })
      }
      syncTime.lte = to
    }
    if (syncTime.gte && syncTime.lte && syncTime.gte > syncTime.lte) {
      throw new BadRequestException({
        error: { code: 'INVALID_TIME_RANGE', message: 'syncTimeFrom 不能晚于 syncTimeTo' },
      })
    }
    if (Object.keys(syncTime).length > 0) where.syncTime = syncTime
    return where
  }

  /**
   * 预览:告诉操作者「这次会发布哪些、共多少条、还有多少条被排除及原因」。
   * 只读,不写任何状态。
   */
  async previewBulkPublish(filter: BulkPublishFilter): Promise<BulkPublishPreviewResult> {
    const d = this.descriptor(filter.kind)
    const scope = this.scopeWhere(filter)

    const eligibleWhere = {
      ...scope,
      reviewStatus: 'approved',
      publishStatus: { in: BULK_PUBLISHABLE_FROM },
    }

    const [eligibleTotal, notApproved, alreadyPublished, expired, rows] = await Promise.all([
      d.count({ where: eligibleWhere }),
      d.count({ where: { ...scope, reviewStatus: { not: 'approved' } } }),
      d.count({ where: { ...scope, reviewStatus: 'approved', publishStatus: 'published' } }),
      d.count({ where: { ...scope, reviewStatus: 'approved', publishStatus: 'expired' } }),
      d.findMany({
        where: eligibleWhere,
        select: {
          id: true,
          [d.titleField]: true,
          sourceOrgId: true,
          sourceName: true,
          syncTime: true,
          publishStatus: true,
        },
        // 稳定排序:分轮之间不会跳条、不会重复。
        // 已发布的条目会自动退出下一轮 eligible,所以多轮是自然推进的。
        orderBy: [{ syncTime: 'asc' }, { id: 'asc' }],
        take: BULK_PUBLISH_MAX_BATCH,
      }),
    ])

    const items: BulkPublishPreviewItem[] = rows.map((r) => ({
      id: String(r.id),
      title: String(r[d.titleField] ?? ''),
      sourceOrgId: String(r.sourceOrgId ?? ''),
      sourceName: String(r.sourceName ?? ''),
      syncTime: r.syncTime instanceof Date ? r.syncTime.toISOString() : String(r.syncTime ?? ''),
      publishStatus: String(r.publishStatus ?? ''),
    }))

    return {
      kind: filter.kind,
      batchLimit: BULK_PUBLISH_MAX_BATCH,
      eligibleTotal,
      items,
      truncated: eligibleTotal > items.length,
      excluded: { notApproved, alreadyPublished, expired },
    }
  }

  /**
   * 执行:对**显式 id 列表**逐条走单条发布路径。
   *
   * 为什么收 ids 而不是重跑筛选条件:
   *   预览与执行之间可能有新数据进来。若执行端重跑筛选,操作者没看过的条目会被
   *   一起推上线(TOCTOU)。收显式 id 保证「确认了什么就发布什么」,一条不多。
   *
   * 为什么不包一个大事务:
   *   要求是「部分成功必须可见」。整体事务意味着 217 条里 3 条失败就全部回滚,
   *   与该要求直接冲突。这里每条自成原子单元(单条方法内部的 update + 审计),
   *   第 37 条失败不会撤销前 36 条已生效的发布。
   *
   * 为什么串行而不是 Promise.all:
   *   1) 限制并发写对连接池的压力;2) 审计写入顺序确定,便于事后按时间复盘。
   */
  async executeBulkPublish(
    kind: BulkPublishKind,
    rawIds: string[],
    user: AuthedUser,
  ): Promise<BulkPublishExecuteResult> {
    const ids = [...new Set(rawIds.filter((id) => typeof id === 'string' && id.trim().length > 0))]

    if (ids.length === 0) {
      throw new BadRequestException({
        error: { code: 'BULK_IDS_REQUIRED', message: '批量发布必须提供至少 1 个 id' },
      })
    }
    if (ids.length > BULK_PUBLISH_MAX_BATCH) {
      throw new BadRequestException({
        error: {
          code: 'BULK_BATCH_TOO_LARGE',
          message: `单次批量发布最多 ${BULK_PUBLISH_MAX_BATCH} 条,本次 ${ids.length} 条;请分轮提交`,
        },
      })
    }

    const d = this.descriptor(kind)

    // 预取标题,只为让失败明细能显示「是哪一条」,不参与任何发布判定。
    const titleRows = await d.findMany({
      where: { id: { in: ids } },
      select: { id: true, [d.titleField]: true },
    })
    const titleMap = new Map(titleRows.map((r) => [String(r.id), String(r[d.titleField] ?? '')]))

    const results: BulkPublishItemResult[] = []
    for (const id of ids) {
      const title = titleMap.get(id) ?? '(已不存在)'
      try {
        // ★ 与单条发布同一条路径。校验 / 审计 / 日志全部由它负责。
        const updated = (await d.publishOne(id, user)) as { publishStatus?: string }
        // 只回报单条方法**实际返回**的状态,不兜底成 'published' —— 不替数据库下结论。
        results.push({ id, title, status: 'published', toPublishStatus: updated?.publishStatus })
      } catch (e) {
        const { code, message } = extractError(e)
        results.push({ id, title, status: 'failed', errorCode: code, errorMessage: message })
      }
    }

    const publishedCount = results.filter((r) => r.status === 'published').length
    const failedCount = results.length - publishedCount

    this.logger.log(
      `bulkPublish: kind=${kind} requested=${ids.length} published=${publishedCount} failed=${failedCount} by=${user.userId}`,
    )

    return { kind, requested: ids.length, publishedCount, failedCount, results }
  }
}

/** 把 Nest 异常里的 { error: { code, message } } 还原成逐条可展示的失败原因 */
function extractError(e: unknown): { code: string; message: string } {
  const resp = (e as { getResponse?: () => unknown })?.getResponse?.()
  const nested = (resp as { error?: { code?: unknown; message?: unknown } })?.error
  if (nested && typeof nested.code === 'string') {
    return {
      code: nested.code,
      message: typeof nested.message === 'string' ? nested.message : nested.code,
    }
  }
  const msg = (e as Error)?.message
  return { code: 'PUBLISH_FAILED', message: typeof msg === 'string' && msg ? msg : '发布失败' }
}
