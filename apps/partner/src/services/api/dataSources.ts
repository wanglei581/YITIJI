import { API_MODE } from './client'
import { partnerMockAdapter } from './partnerMockAdapter'
import { partnerHttpAdapter } from './partnerHttpAdapter'
import type {
  PartnerDataSource,
  CreateDataSourcePayload,
  ConnStatus,
  SyncFreq,
  SourceKind,
  AccessMode,
} from './types'

export type { PartnerDataSource, CreateDataSourcePayload, ConnStatus, SyncFreq, SourceKind, AccessMode }

export interface PartnerDataSourceServiceInterface {
  getDataSources(): Promise<PartnerDataSource[]>
  toggleDataSource(id: string): Promise<PartnerDataSource>
  createDataSource(payload: CreateDataSourcePayload): Promise<PartnerDataSource>
}

const adapter: PartnerDataSourceServiceInterface =
  API_MODE === 'http' ? partnerHttpAdapter : partnerMockAdapter

export const getDataSources    = ()           => adapter.getDataSources()
export const toggleDataSource  = (id: string) => adapter.toggleDataSource(id)
export const createDataSource  = (payload: CreateDataSourcePayload) => adapter.createDataSource(payload)
