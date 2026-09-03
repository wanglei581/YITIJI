/**
 * 我的求职进度契约本地副本。
 *
 * **契约源**：packages/shared/src/types/jobApplication.ts
 *
 * 为什么不直接 import @ai-job-print/shared：services/api 走 commonjs + node
 * moduleResolution，而 packages/shared 是 ESM-only、exports 直指 .ts，互操作复杂。
 * 与 member-favorites.types.ts 同一 decision：类型本地副本化，严格遵守 SSOT 注释。
 *
 * 任何字段变更必须同时改两处，并同步门禁 verify:job-application-track。
 *
 * 合规（compliance-boundary.md §4.4A）：本表只承载**用户本人自填**的求职进度。
 * 不是平台内投递，没有任何第三方写入路径，不向企业与来源机构回传。
 */

/**
 * 无证期唯一合法渠道。取得人力资源服务许可证后才会新增 'platform'。
 * 服务端恒定写入本值，**不接受前端传值**。
 */
export const SELF_REPORTED_CHANNEL = 'external_self_reported'

/** 无证期唯一合法状态来源。'employer_feedback' 属拿证后。 */
export const SELF_REPORTED_STATUS_SOURCE = 'self_reported'

export type JobApplicationChannel = typeof SELF_REPORTED_CHANNEL
export type JobApplicationStatusSource = typeof SELF_REPORTED_STATUS_SOURCE

export type JobApplicationStatus =
  | 'intention'
  | 'applied'
  | 'interviewing'
  | 'offered'
  | 'rejected'

/** 与小程序 job-tracker 五列看板逐字一致（第 3 刀要对齐到同一张表）。 */
export const JOB_APPLICATION_STATUSES: JobApplicationStatus[] = [
  'intention',
  'applied',
  'interviewing',
  'offered',
  'rejected',
]

export interface JobApplicationItem {
  id: string
  channel: JobApplicationChannel
  jobId: string | null
  companyName: string
  positionTitle: string
  sourceName: string | null
  status: JobApplicationStatus
  statusSource: JobApplicationStatusSource
  note: string | null
  selfReportedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateJobApplicationInput {
  jobId?: string
  companyName?: string
  positionTitle?: string
  status?: JobApplicationStatus
  note?: string
  selfReportedAt?: string
}

export interface UpdateJobApplicationInput {
  status?: JobApplicationStatus
  note?: string
  selfReportedAt?: string | null
  companyName?: string
  positionTitle?: string
}
