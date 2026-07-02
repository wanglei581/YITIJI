export type JobAiOperation = 'recommend' | 'explain' | 'match'
export type JobAiFitLevel = 'reference_high' | 'reference_medium' | 'reference_low'

export interface JobAiRequester {
  endUserId: string | null
  accessToken: string | null
}

export interface JobAiIntent {
  targetTitle?: string
  city?: string
  industry?: string
  keywords?: string[]
}

export interface JobAiFilters {
  city?: string
  category?: string
  skills?: string[]
  sourceOrgId?: string
}

export interface TargetJobContext {
  jobId: string
  title: string
  company: string
  sourceName: string
  sourceUrl: string
  externalId: string
  description?: string
  requirements?: string
  skills: string[]
  city: string
  category?: string
}

export interface JobAiSessionDTO {
  id: string
  resumeTaskId?: string | null
  operation: JobAiOperation
  status: 'pending' | 'completed' | 'failed'
  provider?: string | null
  terminalId?: string | null
  createdAt: string
  expiresAt?: string | null
}

export interface JobAiRecommendationDTO {
  job: TargetJobContext
  rank: number
  fitLevel: JobAiFitLevel
  summary: string
  matchPoints: string[]
  gapPoints: string[]
  actionChecklist: string[]
  createdAt: string
}

export interface JobRecommendationInput {
  resumeTaskId: string
  intent?: JobAiIntent
  filters?: JobAiFilters
  limit?: number
  terminalId?: string | null
  ipAddress?: string | null
}

export interface JobAiExplanationPayload {
  responsibilities: string[]
  mustHaveRequirements: string[]
  niceToHaveRequirements: string[]
  preparationTips: string[]
}

export interface JobAiRecommendationPayload {
  jobId: string
  fitLevel: JobAiFitLevel
  summary: string
  matchPoints: string[]
  gapPoints: string[]
  actionChecklist: string[]
}

export interface JobAiTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface JobAiRecommendationLlmResult {
  items: JobAiRecommendationPayload[]
  provider: string
  tokenUsage?: JobAiTokenUsage
}

export interface JobAiExplanationLlmResult {
  payload: JobAiExplanationPayload
  provider: string
  tokenUsage?: JobAiTokenUsage
}

export interface JobAiSessionWithRecommendations {
  session: JobAiSessionDTO
  recommendations: JobAiRecommendationDTO[]
  disclaimer: '仅供参考'
}

export interface JobAiSessionListItem {
  session: JobAiSessionDTO
  job?: TargetJobContext
  recommendationCount: number
}
