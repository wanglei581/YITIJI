import { API_MODE } from './client'
import { partnerMockAdapter } from './partnerMockAdapter'
import { partnerHttpAdapter } from './partnerHttpAdapter'
import type {
  PartnerJobRecord,
  PartnerJobQualitySummary,
  PartnerFairRecord,
  PartnerSyncLog,
  ImportJobItem,
  ImportFairItem,
  ImportResult,
  UpdatePartnerJobInput,
  UpdatePartnerFairInput,
  JobCategory,
  JobFairStatus,
  ReviewStatus,
  PublishStatus,
  SyncDataType,
  SyncResult,
  ExcelPreviewResult,
  ExcelConfirmResult,
  FieldMappingRuleResult,
} from './types'

export type {
  PartnerJobRecord,
  PartnerJobQualitySummary,
  PartnerFairRecord,
  PartnerSyncLog,
  ImportJobItem,
  ImportFairItem,
  ImportResult,
  UpdatePartnerJobInput,
  UpdatePartnerFairInput,
  JobCategory,
  JobFairStatus,
  ReviewStatus,
  PublishStatus,
  SyncDataType,
  SyncResult,
  ExcelPreviewResult,
  ExcelConfirmResult,
  FieldMappingRuleResult,
}

export interface PartnerContentServiceInterface {
  getPartnerJobs(): Promise<PartnerJobRecord[]>
  getPartnerJobQualitySummary(): Promise<PartnerJobQualitySummary[]>
  unpublishPartnerJob(id: string): Promise<PartnerJobRecord>
  // 阶段1C:编辑本机构数据(后端强制回 pending+draft 重审)
  updatePartnerJob(id: string, input: UpdatePartnerJobInput): Promise<PartnerJobRecord>
  // sourceOrgId / sourceName 由后端从 JWT 推断，不再由前端传入
  importPartnerJobs(items: ImportJobItem[]): Promise<ImportResult<PartnerJobRecord>>

  getPartnerFairs(): Promise<PartnerFairRecord[]>
  unpublishPartnerFair(id: string): Promise<PartnerFairRecord>
  updatePartnerFair(id: string, input: UpdatePartnerFairInput): Promise<PartnerFairRecord>
  importPartnerFairs(items: ImportFairItem[]): Promise<ImportResult<PartnerFairRecord>>

  getSyncLogs(): Promise<PartnerSyncLog[]>

  parseExcel(file: File): Promise<{ columns: string[]; sampleRows: Record<string, string>[] }>
  previewExcel(
    file: File,
    sourceId: string,
    dataType: 'job' | 'fair',
    fieldMapping: Record<string, string>,
  ): Promise<ExcelPreviewResult>
  confirmExcelImport(batchId: string): Promise<ExcelConfirmResult>
  cancelExcelImport(batchId: string): Promise<{ success: boolean }>
  getMappingRule(sourceId: string, dataType: 'job' | 'fair'): Promise<FieldMappingRuleResult>
}

const adapter: PartnerContentServiceInterface =
  API_MODE === 'http' ? partnerHttpAdapter : partnerMockAdapter

export const getPartnerJobs      = ()              => adapter.getPartnerJobs()
export const getPartnerJobQualitySummary = () => adapter.getPartnerJobQualitySummary()
export const unpublishPartnerJob = (id: string)    => adapter.unpublishPartnerJob(id)
export const updatePartnerJob    = (id: string, input: UpdatePartnerJobInput) =>
  adapter.updatePartnerJob(id, input)
export const importPartnerJobs   = (items: ImportJobItem[]) =>
  adapter.importPartnerJobs(items)

export const getPartnerFairs      = ()              => adapter.getPartnerFairs()
export const unpublishPartnerFair = (id: string)    => adapter.unpublishPartnerFair(id)
export const updatePartnerFair    = (id: string, input: UpdatePartnerFairInput) =>
  adapter.updatePartnerFair(id, input)
export const importPartnerFairs   = (items: ImportFairItem[]) =>
  adapter.importPartnerFairs(items)

export const getSyncLogs = () => adapter.getSyncLogs()

export const parseExcel = (file: File) => adapter.parseExcel(file)
export const previewExcel = (
  file: File,
  sourceId: string,
  dataType: 'job' | 'fair',
  fieldMapping: Record<string, string>,
) => adapter.previewExcel(file, sourceId, dataType, fieldMapping)
export const confirmExcelImport = (batchId: string) => adapter.confirmExcelImport(batchId)
export const cancelExcelImport  = (batchId: string) => adapter.cancelExcelImport(batchId)
export const getMappingRule = (sourceId: string, dataType: 'job' | 'fair') =>
  adapter.getMappingRule(sourceId, dataType)
