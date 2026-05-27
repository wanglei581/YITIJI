import { API_MODE } from './client'
import { partnerMockAdapter } from './partnerMockAdapter'
import { partnerHttpAdapter } from './partnerHttpAdapter'
import type {
  PartnerJobRecord,
  PartnerFairRecord,
  PartnerSyncLog,
  ImportJobItem,
  ImportFairItem,
  ImportResult,
  JobCategory,
  JobFairStatus,
  ReviewStatus,
  PublishStatus,
  SyncDataType,
  SyncResult,
} from './types'

export type {
  PartnerJobRecord,
  PartnerFairRecord,
  PartnerSyncLog,
  ImportJobItem,
  ImportFairItem,
  ImportResult,
  JobCategory,
  JobFairStatus,
  ReviewStatus,
  PublishStatus,
  SyncDataType,
  SyncResult,
}

export interface PartnerContentServiceInterface {
  getPartnerJobs(): Promise<PartnerJobRecord[]>
  unpublishPartnerJob(id: string): Promise<PartnerJobRecord>
  importPartnerJobs(items: ImportJobItem[], sourceOrgId: string, sourceName: string): Promise<ImportResult<PartnerJobRecord>>

  getPartnerFairs(): Promise<PartnerFairRecord[]>
  unpublishPartnerFair(id: string): Promise<PartnerFairRecord>
  importPartnerFairs(items: ImportFairItem[], sourceOrgId: string, sourceName: string): Promise<ImportResult<PartnerFairRecord>>

  getSyncLogs(): Promise<PartnerSyncLog[]>
}

const adapter: PartnerContentServiceInterface =
  API_MODE === 'http' ? partnerHttpAdapter : partnerMockAdapter

export const getPartnerJobs      = ()           => adapter.getPartnerJobs()
export const unpublishPartnerJob = (id: string) => adapter.unpublishPartnerJob(id)
export const importPartnerJobs   = (items: ImportJobItem[], sourceOrgId: string, sourceName: string) =>
  adapter.importPartnerJobs(items, sourceOrgId, sourceName)

export const getPartnerFairs      = ()           => adapter.getPartnerFairs()
export const unpublishPartnerFair = (id: string) => adapter.unpublishPartnerFair(id)
export const importPartnerFairs   = (items: ImportFairItem[], sourceOrgId: string, sourceName: string) =>
  adapter.importPartnerFairs(items, sourceOrgId, sourceName)

export const getSyncLogs = () => adapter.getSyncLogs()
