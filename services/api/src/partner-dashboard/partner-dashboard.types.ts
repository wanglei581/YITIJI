// ============================================================
// 合作机构运营数据看板返回契约（Sprint 1 / Task 5）。
//
// 这是**合作机构数据运营概览**，不是企业招聘端。统计对象只允许：
//   岗位信息 / 招聘会信息 / 数据源 / 同步日志 / 审核状态 / 发布状态。
// 严禁统计：候选人 / 简历 / 投递 / 面试 / Offer / 企业筛选 / 收简历。
//
// 所有数据只看当前 partner 的 orgId（Job/JobFair 用 sourceOrgId，JobSource/SyncLog 用 orgId）。
// 不返回任何假增长率 / 假趋势 / 假访问量；updatedAt 是本次快照的真实计算时刻。
// ============================================================

export interface PartnerDashboardStats {
  jobCount: number
  jobFairCount: number
  publishedJobCount: number
  publishedFairCount: number
  /** 待审核（岗位 + 招聘会，reviewStatus='pending'）。 */
  pendingReviewCount: number
  /** 已拒绝（岗位 + 招聘会，reviewStatus='rejected'）。 */
  rejectedCount: number
  syncSourceCount: number
  /** 最近一次同步时间（取本机构最新 SyncLog.createdAt；无则 null）。 */
  lastSyncTime: string | null
}

export interface PartnerDashboardSyncLog {
  id: string
  sourceName: string | null
  dataType: string
  status: string
  successCount: number
  failCount: number
  createdAt: string
}

export interface PartnerDashboardJob {
  id: string
  title: string
  sourceName: string | null
  reviewStatus: string
  publishStatus: string
  syncTime: string | null
}

export interface PartnerDashboardJobFair {
  id: string
  title: string
  sourceName: string | null
  reviewStatus: string
  publishStatus: string
  startTime: string | null
}

export interface PartnerDashboard {
  org: { id: string; name: string }
  stats: PartnerDashboardStats
  recentSyncLogs: PartnerDashboardSyncLog[]
  recentJobs: PartnerDashboardJob[]
  recentJobFairs: PartnerDashboardJobFair[]
  /** 数据快照计算时刻（服务端 now，ISO）。 */
  updatedAt: string
}
