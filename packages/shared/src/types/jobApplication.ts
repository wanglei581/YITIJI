/**
 * 我的求职进度契约（SSOT，前端消费方以本文件为准）。
 *
 * 合规依据：docs/compliance/compliance-boundary.md §4.4A（2026-09-02 具名授权）。
 *
 * **这不是平台内投递。** 判定原则是「合法性由谁写的决定，不由字段名决定」：
 * 用户自己手填的「已投递」是个人求职记事本；由企业、来源平台或本平台写入的同名
 * 状态才是招聘闭环数据 —— 那个需要人力资源服务许可证，与本契约无关。
 *
 * 因此本契约刻意**不包含**：任何第三方回流字段、任何企业侧可读结构、
 * 任何简历与投递的关联，以及任何按岗位 / 企业聚合的统计形状
 * （逐条不回传但按企业出漏斗，等于重建候选人池，§4.4A 明令禁止）。
 *
 * 后端本地副本：services/api/src/job-applications/job-application.types.ts。
 * 任何字段变更必须同时改两处，并同步门禁 verify:job-application-track。
 */

/**
 * 投递渠道。
 *
 * 无证期唯一合法取值是 `external_self_reported`；取得人力资源服务许可证后才会
 * 新增 `platform`（平台内投递）。这是**前向兼容槽位，不是开关** —— 前端不得传值，
 * 服务端恒定写入，白名单由 `verify:job-application-track` 断言。
 */
export type JobApplicationChannel = 'external_self_reported'

/** 状态来源。无证期唯一合法取值 `self_reported`；`employer_feedback` 属拿证后。 */
export type JobApplicationStatusSource = 'self_reported'

/**
 * 进度状态。与小程序 `apps/miniapp/pages/job-tracker/` 的五列看板逐字一致 ——
 * 第 3 刀要把小程序本地存储对齐到同一后端表，取值不一致会在那时变成迁移债。
 */
export type JobApplicationStatus =
  | 'intention'
  | 'applied'
  | 'interviewing'
  | 'offered'
  | 'rejected'

export const JOB_APPLICATION_STATUSES: readonly JobApplicationStatus[] = [
  'intention',
  'applied',
  'interviewing',
  'offered',
  'rejected',
] as const

/**
 * 状态展示名。**主语必须是用户**，不得出现暗示平台参与投递的措辞
 * （§4.4A 禁止项第 5 条），并继续遵守合规禁词清单。
 */
export const JOB_APPLICATION_STATUS_LABELS: Record<JobApplicationStatus, string> = {
  intention: '意向',
  applied: '已投递',
  interviewing: '面试中',
  offered: '已拿Offer',
  rejected: '已拒绝',
}

export interface JobApplicationItem {
  id: string
  channel: JobApplicationChannel
  /** 关联本站岗位时非空；用户手填的站外岗位为 null。 */
  jobId: string | null
  companyName: string
  positionTitle: string
  sourceName: string | null
  status: JobApplicationStatus
  statusSource: JobApplicationStatusSource
  note: string | null
  /** 用户自述的投递时间（ISO 字符串），不是系统观测到的事实。 */
  selfReportedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * 新建入参。
 *
 * 刻意**不含** `channel` / `statusSource` —— 它们由服务端恒定写入，
 * 前端传了会被全局 ValidationPipe（whitelist + forbidNonWhitelisted）直接 400。
 * 也不含 `resumeFileId` / `consentId`：无证期它们没有写入路径。
 */
export interface CreateJobApplicationInput {
  /** 关联本站岗位时传；服务端会据此从「已审核已发布」岗位派生展示快照。 */
  jobId?: string
  /** jobId 为空时必填（用户自述的站外岗位）。 */
  companyName?: string
  positionTitle?: string
  status?: JobApplicationStatus
  note?: string
  selfReportedAt?: string
}

/** 更新入参。只允许改用户自己写的东西，不允许改 jobId 与派生快照。 */
export interface UpdateJobApplicationInput {
  status?: JobApplicationStatus
  note?: string
  selfReportedAt?: string | null
  companyName?: string
  positionTitle?: string
}
