import { API_MODE } from './client'
import { adminAiMockAdapter } from './adminAiMockAdapter'
import { adminAiHttpAdapter } from './adminAiHttpAdapter'
import type { AdminAiUsage, AdminAiLogsQuery, AdminAiLogsResult, AdminAiLogEntry, AiOperation, AiLogStatus, JobSourceQualitySummary } from './types'

export type { AdminAiUsage, AdminAiLogsQuery, AdminAiLogsResult, AdminAiLogEntry, AiOperation, AiLogStatus, JobSourceQualitySummary }

interface AdminAiServiceInterface {
  getAiUsage(): Promise<AdminAiUsage>
  getAiLogs(query?: AdminAiLogsQuery): Promise<AdminAiLogsResult>
  getAdminJobQualitySummary(): Promise<JobSourceQualitySummary[]>
}

const adapter: AdminAiServiceInterface =
  API_MODE === 'http' ? adminAiHttpAdapter : adminAiMockAdapter

export const getAiUsage = (): Promise<AdminAiUsage>       => adapter.getAiUsage()
/** 筛选一律传给后端；不要再在页面里对整页结果做 filter（低频能力会被截断成空）。 */
export const getAiLogs  = (query?: AdminAiLogsQuery): Promise<AdminAiLogsResult> => adapter.getAiLogs(query)
export const getAdminJobQualitySummary = (): Promise<JobSourceQualitySummary[]> => adapter.getAdminJobQualitySummary()
