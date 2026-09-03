import { API_MODE } from './client'
import { partnerMockAdapter } from './partnerMockAdapter'
import { partnerHttpAdapter } from './partnerHttpAdapter'
import type {
  PartnerDataSource,
  PartnerDataSourceCapabilities,
  PartnerDataSourceCredentialRotationResult,
  CreateDataSourcePayload,
  RotateDataSourceCredentialPayload,
  ConnStatus,
  SyncFrequency,
  SyncFreq,
  SourceKind,
  AccessMode,
  AuthType,
  DataSourceConfig,
  FieldMappingRule,
  MappingValidationError,
  ImportBatch,
  ImportRecord,
} from './types'

export type {
  PartnerDataSource,
  PartnerDataSourceCapabilities,
  PartnerDataSourceCredentialRotationResult,
  CreateDataSourcePayload,
  RotateDataSourceCredentialPayload,
  ConnStatus,
  SyncFrequency,
  SyncFreq,
  SourceKind,
  AccessMode,
  AuthType,
  DataSourceConfig,
  FieldMappingRule,
  MappingValidationError,
  ImportBatch,
  ImportRecord,
}

export interface PartnerDataSourceServiceInterface {
  getDataSources(): Promise<PartnerDataSource[]>
  getDataSourceCapabilities(): Promise<PartnerDataSourceCapabilities>
  toggleDataSource(id: string): Promise<PartnerDataSource>
  createDataSource(payload: CreateDataSourcePayload): Promise<PartnerDataSource>
  rotateDataSourceCredential(
    id: string,
    payload: RotateDataSourceCredentialPayload,
  ): Promise<PartnerDataSourceCredentialRotationResult>
  archiveDataSource(id: string): Promise<PartnerDataSource>
  unarchiveDataSource(id: string): Promise<PartnerDataSource>
}

const adapter: PartnerDataSourceServiceInterface =
  API_MODE === 'http' ? partnerHttpAdapter : partnerMockAdapter

export const getDataSources    = ()           => adapter.getDataSources()
export const getDataSourceCapabilities = () => adapter.getDataSourceCapabilities()
export const toggleDataSource  = (id: string) => adapter.toggleDataSource(id)
export const createDataSource  = (payload: CreateDataSourcePayload) => adapter.createDataSource(payload)
export const rotateDataSourceCredential = (id: string, payload: RotateDataSourceCredentialPayload) =>
  adapter.rotateDataSourceCredential(id, payload)
export const archiveDataSource   = (id: string) => adapter.archiveDataSource(id)
export const unarchiveDataSource = (id: string) => adapter.unarchiveDataSource(id)
