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
import { listContentTrustedOrgIds, type OrgTrustReader } from '../common/content-trust'
import {
  bulkPublishExpiryField,
  bulkPublishNotExpiredWhere,
  bulkPublishExpiredWhere,
  isBulkPublishExpired,
  bulkPublishExpiredMessage,
} from './bulk-publish-expiry'

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

/**
 * 允许被批量发布的起始发布态。
 *
 * 注意:这里**只是发布状态机**的起点集合,不承担「过期」判定。
 * PublishStatus 枚举里虽然有 'expired',但全仓从不把它落库
 * (verify:job-validity-expiry §8 专门断言不得落库,有效期只允许读取时派生),
 * 所以过期与否必须按各内容类型自己的日期字段实时判断 ——
 * 见 ./bulk-publish-expiry.ts。
 */
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
  /** 命中筛选且合格(approved + draft/unpublished + 来源可信 + 未过期)的**总数**,可能大于 items.length */
  eligibleTotal: number
  /** 本轮候选明细,最多 batchLimit 条 */
  items: BulkPublishPreviewItem[]
  /** eligibleTotal > items.length 时为 true —— 需要多轮 */
  truncated: boolean
  /**
   * 命中筛选但被排除的条目数,按原因分列,便于操作者理解「为什么不是全部」。
   *
   * 这几个桶是**排除原因**,不是一个划分:同一条内容可以既过期又来源不可信,
   * 会同时出现在 expired 和 orgTrustInactive 里。相加没有意义,分别看才有意义。
   */
  excluded: {
    notApproved: number
    alreadyPublished: number
    /**
     * 已过审、且处于可发布态,但**已经过期**的条数。
     *
     * 判据按内容类型各自的日期字段实时算(岗位 validThrough / 招聘会 endAt),
     * 见 ./bulk-publish-expiry.ts。
     *
     * 旧实现统计的是 publishStatus === 'expired' —— 那个值全仓从不落库,
     * 于是这个数字对三种内容**恒为 0**,运营永远看不到「有 N 条已经过期了」,
     * 同时候选池也没把它们排除掉。这是本字段存在的全部理由,别再改回去。
     *
     * 政策公告没有有效期字段(PolicyPost 只有 publishedDate 发布日期),
     * 该类内容此项恒为 0 —— 这个 0 是「没有有效期概念」,不是「没算」。
     */
    expired: number
    /**
     * 来源机构未通过内容信任核验(contentTrustStatus≠active 或已归档)。
     *
     * 这些条目**在预览阶段就被排除**,不进候选列表 —— 运营点「批量发布」之前
     * 就能看见「有 N 条因为来源机构没过核验发不了」,而不是提交后才逐条报错。
     * 判据与单条发布闸门同源,见 src/common/content-trust.ts。
     */
    orgTrustInactive: number
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
  /**
   * 标题列名。三种内容**都是 title** —— JobFair 上没有 name 这一列。
   *
   * 曾经写成 'name',于是 kind='fair' 的 preview/execute 会
   * `select: { name: true }`,真 Prisma 直接抛
   * 「Invalid `prisma.jobFair.findMany()` invocation」→ 招聘会批量发布恒 500。
   * 两个既有门禁没抓住,是因为它们的假 Prisma **完全忽略 select**、
   * 且夹具给假行补了个 name 属性。
   * 现在 verify:publish-expiry-completeness 的假 Prisma 会校验 select 列是否存在。
   */
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
        titleField: 'title',
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

    // 发布闸门在预览阶段就生效:候选池只留来源机构 contentTrust=active 且未归档的条目。
    // 不这么做的话,运营会先看到一份「看起来可发」的清单,提交后才逐条 400 ——
    // 事故正是这样发生的(见 src/common/content-trust.ts 顶部)。
    const trustedOrgIds = await listContentTrustedOrgIds(this.prisma as unknown as OrgTrustReader)

    // 有效期条件同样在预览阶段生效:候选池排除已过期岗位 / 已结束招聘会。
    // 判据见 ./bulk-publish-expiry.ts(岗位复用求职者可见性用的同一个条件)。
    const now = new Date()
    const notExpired = bulkPublishNotExpiredWhere(filter.kind, now)
    const expiredWhere = bulkPublishExpiredWhere(filter.kind, now)

    // 用 AND 组合而不是对象展开:scope 里可能已经有 `sourceOrgId: '<按机构筛选>'`,
    // 直接 `{ ...scope, sourceOrgId: { in: ... } }` 会把操作者的机构筛选**悄悄覆盖掉**。
    const approvedAndPublishable = { reviewStatus: 'approved', publishStatus: { in: BULK_PUBLISHABLE_FROM } }
    const eligibleWhere = {
      AND: [
        scope,
        approvedAndPublishable,
        { sourceOrgId: { in: trustedOrgIds } },
        ...(notExpired ? [notExpired] : []),
      ],
    }

    const [eligibleTotal, notApproved, alreadyPublished, expired, orgTrustInactive, rows] = await Promise.all([
      d.count({ where: eligibleWhere }),
      d.count({ where: { ...scope, reviewStatus: { not: 'approved' } } }),
      d.count({ where: { ...scope, reviewStatus: 'approved', publishStatus: 'published' } }),
      // 「本来该能发、只差没过期」的条数。没有有效期概念的内容类型如实回 0。
      expiredWhere
        ? d.count({ where: { AND: [scope, approvedAndPublishable, expiredWhere] } })
        : Promise.resolve(0),
      // 「本来该能发、只差来源机构核验」的条数:approved + draft/unpublished,但机构不可信。
      d.count({
        where: { AND: [scope, approvedAndPublishable, { sourceOrgId: { notIn: trustedOrgIds } }] },
      }),
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
      excluded: { notApproved, alreadyPublished, expired, orgTrustInactive },
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

    // 预取标题(让失败明细能显示「是哪一条」)与有效期字段。
    // 有效期必须在 execute 再判一次:preview 与 execute 之间可能隔很久,
    // 期间条目会自然过期 —— 只在 preview 收窄候选池挡不住这条缝。
    const expiryField = bulkPublishExpiryField(kind)
    const now = new Date()
    const prefetched = await d.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        [d.titleField]: true,
        ...(expiryField ? { [expiryField]: true } : {}),
      },
    })
    const rowMap = new Map(prefetched.map((r) => [String(r.id), r]))

    const results: BulkPublishItemResult[] = []
    for (const id of ids) {
      const row = rowMap.get(id)
      const title = row ? String(row[d.titleField] ?? '') : '(已不存在)'

      // 过期条目直接计失败并给出可读原因。这里不写任何状态,
      // 只是**不把它交给**单条发布方法 —— 仍然没有第二条写路径。
      if (isBulkPublishExpired(kind, row, now)) {
        results.push({
          id,
          title,
          status: 'failed',
          errorCode: 'BULK_PUBLISH_EXPIRED',
          errorMessage: bulkPublishExpiredMessage(kind, row),
        })
        continue
      }

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
