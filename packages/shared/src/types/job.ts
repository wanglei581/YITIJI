export type JobReviewStatus = 'pending' | 'reviewing' | 'published' | 'rejected' | 'expired'

export type JobPublishStatus = 'draft' | 'published' | 'unpublished'

export type JobFairStatus = 'upcoming' | 'ongoing' | 'ended'

export interface ExternalJobSource {
  sourceOrgId: string
  externalId: string
  sourceName: string
  sourceUrl: string
  syncTime: string
  reviewStatus: JobReviewStatus
  publishStatus: JobPublishStatus
}

export interface ExternalJob extends ExternalJobSource {
  id: string
  title: string
  company: string
  city: string
  salary?: string
  tags: string[]
  description?: string
  requirements?: string
}

export interface ExternalJobFair extends ExternalJobSource {
  id: string
  name: string
  organizer: string
  startTime: string
  endTime: string
  venue: string
  status: JobFairStatus
  description?: string
  boothCount?: number
}
