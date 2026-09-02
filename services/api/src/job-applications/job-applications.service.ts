import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { buildMemberPage, memberPageArgs, type MemberPageQuery } from '../common/utils/member-page'
import {
  SELF_REPORTED_CHANNEL,
  SELF_REPORTED_STATUS_SOURCE,
  type CreateJobApplicationInput,
  type JobApplicationItem,
  type JobApplicationStatus,
  type UpdateJobApplicationInput,
} from './job-application.types'

// ============================================================
// 我的求职进度服务（compliance-boundary.md §4.4A，2026-09-02 具名授权）。
//
// ## 这个服务是什么，不是什么
//
// 是：用户**本人**的求职记事本。他在第三方平台投完，回本终端记一笔。
// 不是：平台内投递。我方不收简历、不转交、不撮合，不构成职业中介。
//
// 判定原则是「合法性由**谁写的**决定，不由字段名决定」。因此本服务最重要的性质
// 不是它做了什么，而是它**没有**什么：
//
//   - 没有任何第三方写入入口（没有 webhook、没有同步任务、没有 admin 写接口）
//   - 没有任何对外读取接口（企业侧、Partner 侧都读不到本表）
//   - 没有按岗位 / 企业 / 来源机构的聚合方法 —— 逐条不回传但按企业出
//     「投了多少人、几个到面试」等于重建候选人漏斗，§4.4A 明令禁止
//   - 没有 channel / statusSource 的写入参数 —— 它们由服务端恒定写入
//
// 以上每一条都由 verify:job-application-track 断言，不是靠这段注释。
//
// ## 越权防线
//
// 与 member-favorites 同一写法：所有读写都以 EndUserAuthGuard 注入的 endUserId
// 为唯一过滤维度，service 永远拿不到任意用户 id → 跨用户越权天然不可能。
// ============================================================

@Injectable()
export class JobApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 本行是否由服务端从站内岗位派生快照（派生的快照不允许用户改写）。 */
  private isJobLinked(row: { jobId: string | null }): boolean {
    return row.jobId !== null
  }

  /**
   * 从「已审核 + 已发布」岗位派生展示快照。
   *
   * 与 member-favorites 的 resolvePublishedTitle 同口径：快照由服务端补齐，
   * 前端传什么都不算数 —— 否则用户可以伪造一条指向不存在岗位的记录，
   * 或把别的公司名挂到某个岗位 id 上。
   */
  private async resolveJobSnapshot(jobId: string): Promise<{
    companyName: string
    positionTitle: string
    sourceName: string | null
  }> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, reviewStatus: 'approved', publishStatus: 'published' },
      select: { company: true, title: true, sourceName: true },
    })
    if (!job) {
      throw new NotFoundException({
        error: { code: 'JOB_APPLICATION_JOB_NOT_FOUND', message: '岗位不存在或未发布' },
      })
    }
    return { companyName: job.company, positionTitle: job.title, sourceName: job.sourceName }
  }

  private toItem(row: {
    id: string
    channel: string
    jobId: string | null
    companyName: string
    positionTitle: string
    sourceName: string | null
    status: string
    statusSource: string
    note: string | null
    appliedAt: Date | null
    createdAt: Date
    updatedAt: Date
  }): JobApplicationItem {
    return {
      id: row.id,
      channel: row.channel as JobApplicationItem['channel'],
      jobId: row.jobId,
      companyName: row.companyName,
      positionTitle: row.positionTitle,
      sourceName: row.sourceName,
      status: row.status as JobApplicationStatus,
      statusSource: row.statusSource as JobApplicationItem['statusSource'],
      note: row.note,
      appliedAt: row.appliedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  private static readonly SELECT = {
    id: true,
    channel: true,
    jobId: true,
    companyName: true,
    positionTitle: true,
    sourceName: true,
    status: true,
    statusSource: true,
    note: true,
    appliedAt: true,
    createdAt: true,
    updatedAt: true,
  } as const

  /** 我的求职进度列表（本人，可选按状态过滤），游标分页。 */
  async list(
    endUserId: string,
    page: MemberPageQuery,
    status?: JobApplicationStatus,
  ): Promise<{ items: JobApplicationItem[]; nextCursor: string | null; total: number }> {
    const where = { endUserId, ...(status ? { status } : {}) }
    const total = await this.prisma.jobApplication.count({ where })
    const rows = await this.prisma.jobApplication.findMany({
      where,
      select: JobApplicationsService.SELECT,
      ...memberPageArgs(page),
    })
    return buildMemberPage(rows, page, total, (r) => this.toItem(r))
  }


  /**
   * 新建一条求职进度。
   *
   * 两种形态二选一：
   *   - 传 jobId：关联本站已发布岗位，展示快照由服务端派生
   *   - 不传 jobId：用户自述的站外岗位，公司名与岗位名必填
   *
   * `channel` / `statusSource` 恒定由服务端写入，不从 input 取 —— input 的类型里
   * 根本没有这两个字段，DTO 白名单也拒收，两层都挡住。
   */
  async create(endUserId: string, input: CreateJobApplicationInput): Promise<JobApplicationItem> {
    let companyName: string
    let positionTitle: string
    let sourceName: string | null = null

    if (input.jobId) {
      const snap = await this.resolveJobSnapshot(input.jobId)
      companyName = snap.companyName
      positionTitle = snap.positionTitle
      sourceName = snap.sourceName
    } else {
      const company = input.companyName?.trim()
      const position = input.positionTitle?.trim()
      if (!company || !position) {
        throw new BadRequestException({
          error: {
            code: 'JOB_APPLICATION_MISSING_FIELDS',
            message: '未关联本站岗位时，公司名称与岗位名称必填',
          },
        })
      }
      companyName = company
      positionTitle = position
    }

    const row = await this.prisma.jobApplication.create({
      data: {
        endUserId,
        // 恒定值，不接受任何外部输入。无证期这是唯一合法取值。
        channel: SELF_REPORTED_CHANNEL,
        statusSource: SELF_REPORTED_STATUS_SOURCE,
        jobId: input.jobId ?? null,
        companyName,
        positionTitle,
        sourceName,
        status: input.status ?? 'intention',
        note: input.note?.trim() || null,
        appliedAt: input.appliedAt ? new Date(input.appliedAt) : null,
        // resumeFileId / consentId 刻意不写：无证期恒为 null，无任何写入路径。
      },
      select: JobApplicationsService.SELECT,
    })
    return this.toItem(row)
  }

  /**
   * 更新本人的一条求职进度。
   *
   * 这里**必须**先查后改，不能像 remove() 那样一条 updateMany 了事：下面的
   * 「已关联岗位的快照只读」判定需要先知道这行的 jobId，而 Prisma 的 update
   * 也要回写后的行。
   *
   * 越权防线因此落在**第一次查询**上：`findFirst({ where: { id, endUserId } })`
   * 查不到就 404，后面的 `update({ where: { id: existing.id } })` 只可能落在
   * 本人的行上。**改这个方法时不要把那次 findFirst 优化掉** —— 一旦直接
   * `update({ where: { id } })`，任何人拿到别人的 id 就能改别人的记录。
   */
  async update(
    endUserId: string,
    id: string,
    input: UpdateJobApplicationInput,
  ): Promise<JobApplicationItem> {
    const existing = await this.prisma.jobApplication.findFirst({
      where: { id, endUserId },
      select: { id: true, jobId: true },
    })
    if (!existing) {
      throw new NotFoundException({
        error: { code: 'JOB_APPLICATION_NOT_FOUND', message: '求职进度记录不存在' },
      })
    }

    // 已关联站内岗位的条目，展示快照是服务端派生的事实，不允许用户改写 ——
    // 否则「关联了岗位 A，公司名却写成 B」这种自相矛盾的记录就能存在。
    if (this.isJobLinked(existing) && (input.companyName !== undefined || input.positionTitle !== undefined)) {
      throw new BadRequestException({
        error: {
          code: 'JOB_APPLICATION_SNAPSHOT_READONLY',
          message: '已关联本站岗位的记录，公司名称与岗位名称由系统按岗位信息填写，不可修改',
        },
      })
    }

    const data: Record<string, unknown> = {}
    if (input.status !== undefined) data['status'] = input.status
    if (input.note !== undefined) data['note'] = input.note?.trim() || null
    if (input.appliedAt !== undefined) {
      data['appliedAt'] = input.appliedAt === null ? null : new Date(input.appliedAt)
    }
    if (input.companyName !== undefined) data['companyName'] = input.companyName.trim()
    if (input.positionTitle !== undefined) data['positionTitle'] = input.positionTitle.trim()

    // statusSource 不随 status 变化 —— 无论用户改成哪个状态，来源都还是「用户自填」。
    // 只有拿证后接入企业反馈才会出现第二种取值，那要走许可证闸门。

    const row = await this.prisma.jobApplication.update({
      where: { id: existing.id },
      data,
      select: JobApplicationsService.SELECT,
    })
    return this.toItem(row)
  }

  /** 删除本人的一条记录（幂等）。deleteMany 限定 endUserId → 绝不可能删到他人记录。 */
  async remove(endUserId: string, id: string): Promise<{ removed: boolean }> {
    const res = await this.prisma.jobApplication.deleteMany({ where: { id, endUserId } })
    return { removed: res.count > 0 }
  }
}
