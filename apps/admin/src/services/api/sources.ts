import { API_MODE } from './client'
import { adminMockAdapter } from './adminMockAdapter'
import { adminHttpAdapter } from './adminHttpAdapter'
import type { AdminJobSourceRecord, AdminFairSourceRecord, AdminImportBatch, JobFairStatus } from './types'
import type { ReviewAction, PublishAction } from './review-types'

export type { AdminJobSourceRecord, AdminFairSourceRecord, AdminImportBatch, JobFairStatus, ReviewAction, PublishAction }

// ─── Adapter interface (core methods aligned with backend endpoints) ───────────

export interface AdminSourceServiceInterface {
  getJobSources(): Promise<AdminJobSourceRecord[]>
  reviewJobSource(id: string, action: ReviewAction, reason?: string): Promise<AdminJobSourceRecord>
  publishJobSourceRecord(id: string, action: PublishAction): Promise<AdminJobSourceRecord>

  getFairSources(): Promise<AdminFairSourceRecord[]>
  reviewFairSource(id: string, action: ReviewAction, reason?: string): Promise<AdminFairSourceRecord>
  publishFairSourceRecord(id: string, action: PublishAction): Promise<AdminFairSourceRecord>

  getImportBatches(): Promise<AdminImportBatch[]>
}

const adapter: AdminSourceServiceInterface =
  API_MODE === 'http' ? adminHttpAdapter : adminMockAdapter

// ─── Core service functions (new, aligned with backend) ──────────────────────

export const getJobSources          = ()                                          => adapter.getJobSources()
export const reviewJobSource        = (id: string, action: ReviewAction, reason?: string) => adapter.reviewJobSource(id, action, reason)
export const publishJobSourceRecord = (id: string, action: PublishAction)         => adapter.publishJobSourceRecord(id, action)

export const getFairSources          = ()                                          => adapter.getFairSources()
export const reviewFairSource        = (id: string, action: ReviewAction, reason?: string) => adapter.reviewFairSource(id, action, reason)
export const publishFairSourceRecord = (id: string, action: PublishAction)         => adapter.publishFairSourceRecord(id, action)

// ─── Wrapper exports (preserve existing page component API, no page changes needed) ─

export const approveJobSource   = (id: string) => adapter.reviewJobSource(id, 'approve')
export const rejectJobSource    = (id: string) => adapter.reviewJobSource(id, 'reject')
export const publishJobSource   = (id: string) => adapter.publishJobSourceRecord(id, 'publish')
export const unpublishJobSource = (id: string) => adapter.publishJobSourceRecord(id, 'unpublish')

export const approveFairSource   = (id: string) => adapter.reviewFairSource(id, 'approve')
export const rejectFairSource    = (id: string) => adapter.reviewFairSource(id, 'reject')
export const publishFairSource   = (id: string) => adapter.publishFairSourceRecord(id, 'publish')
export const unpublishFairSource = (id: string) => adapter.publishFairSourceRecord(id, 'unpublish')

export const getImportBatches = () => adapter.getImportBatches()
