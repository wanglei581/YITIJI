import { API_MODE } from './client'
import { adminMockAdapter } from './adminMockAdapter'
import { adminHttpAdapter } from './adminHttpAdapter'
import type {
  AdminJobSourceRecord,
  AdminFairSourceRecord,
  AdminImportBatch,
  AdminSourceListQuery,
  AdminSourcePage,
  JobFairStatus,
} from './types'
import type { ReviewAction, PublishAction } from './review-types'

export type {
  AdminJobSourceRecord,
  AdminFairSourceRecord,
  AdminImportBatch,
  AdminSourceListQuery,
  AdminSourcePage,
  JobFairStatus,
  ReviewAction,
  PublishAction,
}

export { paginateAdminSourceRows, toAdminSourceQueryString } from './sourcePaging'

// ─── Adapter interface (core methods aligned with backend endpoints) ───────────

export interface AdminSourceServiceInterface {
  getJobSources(query?: AdminSourceListQuery): Promise<AdminJobSourceRecord[] | AdminSourcePage<AdminJobSourceRecord>>
  reviewJobSource(id: string, action: ReviewAction, reason?: string): Promise<AdminJobSourceRecord>
  publishJobSourceRecord(id: string, action: PublishAction): Promise<AdminJobSourceRecord>

  getFairSources(query?: AdminSourceListQuery): Promise<AdminFairSourceRecord[] | AdminSourcePage<AdminFairSourceRecord>>
  reviewFairSource(id: string, action: ReviewAction, reason?: string): Promise<AdminFairSourceRecord>
  publishFairSourceRecord(id: string, action: PublishAction): Promise<AdminFairSourceRecord>

  getImportBatches(): Promise<AdminImportBatch[]>
}

const adapter: AdminSourceServiceInterface =
  API_MODE === 'http' ? adminHttpAdapter : adminMockAdapter

// ─── Core service functions (new, aligned with backend) ──────────────────────

export function getJobSources(): Promise<AdminJobSourceRecord[]>
export function getJobSources(query: AdminSourceListQuery): Promise<AdminJobSourceRecord[] | AdminSourcePage<AdminJobSourceRecord>>
export function getJobSources(query?: AdminSourceListQuery) {
  return query ? adapter.getJobSources(query) : adapter.getJobSources()
}
export const reviewJobSource        = (id: string, action: ReviewAction, reason?: string) => adapter.reviewJobSource(id, action, reason)
export const publishJobSourceRecord = (id: string, action: PublishAction)         => adapter.publishJobSourceRecord(id, action)

export function getFairSources(): Promise<AdminFairSourceRecord[]>
export function getFairSources(query: AdminSourceListQuery): Promise<AdminFairSourceRecord[] | AdminSourcePage<AdminFairSourceRecord>>
export function getFairSources(query?: AdminSourceListQuery) {
  return query ? adapter.getFairSources(query) : adapter.getFairSources()
}
export const reviewFairSource        = (id: string, action: ReviewAction, reason?: string) => adapter.reviewFairSource(id, action, reason)
export const publishFairSourceRecord = (id: string, action: PublishAction)         => adapter.publishFairSourceRecord(id, action)

// ─── Wrapper exports (preserve existing page component API, no page changes needed) ─

export const approveJobSource   = (id: string) => adapter.reviewJobSource(id, 'approve')
export const rejectJobSource    = (id: string, reason: string) => adapter.reviewJobSource(id, 'reject', reason)
export const publishJobSource   = (id: string) => adapter.publishJobSourceRecord(id, 'publish')
export const unpublishJobSource = (id: string) => adapter.publishJobSourceRecord(id, 'unpublish')

export const approveFairSource   = (id: string) => adapter.reviewFairSource(id, 'approve')
export const rejectFairSource    = (id: string, reason: string) => adapter.reviewFairSource(id, 'reject', reason)
export const publishFairSource   = (id: string) => adapter.publishFairSourceRecord(id, 'publish')
export const unpublishFairSource = (id: string) => adapter.publishFairSourceRecord(id, 'unpublish')

export const getImportBatches = () => adapter.getImportBatches()
