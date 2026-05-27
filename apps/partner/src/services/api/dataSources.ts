import { API_MODE } from './client'
import { partnerMockAdapter } from './partnerMockAdapter'
import { partnerHttpAdapter } from './partnerHttpAdapter'
import type { PartnerDataSource, ConnStatus, SyncFreq } from './types'

export type { PartnerDataSource, ConnStatus, SyncFreq }

export interface PartnerDataSourceServiceInterface {
  getDataSources(): Promise<PartnerDataSource[]>
  toggleDataSource(id: string): Promise<PartnerDataSource>
  createDataSource(name: string): Promise<PartnerDataSource>
}

const adapter: PartnerDataSourceServiceInterface =
  API_MODE === 'http' ? partnerHttpAdapter : partnerMockAdapter

export const getDataSources    = ()           => adapter.getDataSources()
export const toggleDataSource  = (id: string) => adapter.toggleDataSource(id)
export const createDataSource  = (name: string) => adapter.createDataSource(name)
