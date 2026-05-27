import { API_MODE } from './client'
import { adminAiMockAdapter } from './adminAiMockAdapter'
import { adminAiHttpAdapter } from './adminAiHttpAdapter'
import type { AdminAiUsage, AdminAiLogsResult, AdminAiLogEntry, AiOperation, AiLogStatus } from './types'

export type { AdminAiUsage, AdminAiLogsResult, AdminAiLogEntry, AiOperation, AiLogStatus }

interface AdminAiServiceInterface {
  getAiUsage(): Promise<AdminAiUsage>
  getAiLogs(limit?: number): Promise<AdminAiLogsResult>
}

const adapter: AdminAiServiceInterface =
  API_MODE === 'http' ? adminAiHttpAdapter : adminAiMockAdapter

export const getAiUsage = (): Promise<AdminAiUsage>       => adapter.getAiUsage()
export const getAiLogs  = (limit?: number): Promise<AdminAiLogsResult> => adapter.getAiLogs(limit)
