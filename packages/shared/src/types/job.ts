export type JobReviewStatus = 'pending' | 'reviewing' | 'published' | 'rejected' | 'expired'

export type JobPublishStatus = 'draft' | 'published' | 'unpublished'

export interface ExternalJobSource {
  sourceOrgId: string
  externalId: string
  sourceName: string
  sourceUrl: string
  syncTime: string
  reviewStatus: JobReviewStatus
  publishStatus: JobPublishStatus
}
