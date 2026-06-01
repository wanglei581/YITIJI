export const JOB_SYNC_QUEUE = 'job-sync'
export const JOB_SYNC_JOB_NAME = 'sync.api.source'

export interface ApiSyncJobData {
  sourceId: string
  manual: boolean
}

/**
 * JobSource.responseConfig 的 JSON 结构。
 * dataType:  同步的数据类型 ('job' | 'fair')，默认 'job'
 * rootPath:  点分路径定位 JSON 响应中的数组，如 "data.jobs"、"items"；
 *            为 null 时 auto-detect 常见 key (jobs/items/data/results/list)
 * fields:    标准字段 → 源字段名的映射，不写则与标准字段名一致，
 *            如 { "externalId":"id", "title":"position", "company":"employer" }
 */
export interface JobSourceResponseConfig {
  dataType: 'job' | 'fair'
  rootPath?: string
  fields?: Record<string, string>
}

/** Worker 内部每次同步的统计结果 */
export interface SyncStats {
  added: number
  updated: number
  dup: number
  error: number
  errorSummary?: string
}

/** syncFreq → 最小间隔（ms）；manual/realtime 不自动调度 */
export const SYNC_FREQ_THRESHOLD_MS: Record<string, number | undefined> = {
  hourly: 55 * 60 * 1000,
  daily:  23 * 60 * 60 * 1000,
  weekly:  6 * 24 * 60 * 60 * 1000,
}
