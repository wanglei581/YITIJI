import type {
  JobAiSessionListItem,
  JobExplainResponse,
  JobRecommendationRequest,
  JobRecommendationResponse,
  MemberAssetPage,
} from '@ai-job-print/shared'
import { API_MODE } from './client'
import { ApiHttpError } from './httpAdapter'
import { jobAiHttpAdapter, type JobAiConsentStatus, type JobAiMatchResponse, type JobAiPageOpts } from './jobAiHttpAdapter'

export type { JobAiConsentStatus, JobAiMatchResponse }

export interface JobAiServiceInterface {
  getJobAiConsentStatus(token: string): Promise<JobAiConsentStatus[]>
  grantJobAiConsent(token: string): Promise<JobAiConsentStatus>
  getJobAiRecommendations(token: string, input: JobRecommendationRequest): Promise<JobRecommendationResponse>
  explainJobWithAi(token: string, jobId: string): Promise<JobExplainResponse>
  matchJobWithAi(token: string, jobId: string, resumeTaskId: string): Promise<JobAiMatchResponse>
  listMyJobAiSessions(token: string, opts?: JobAiPageOpts): Promise<MemberAssetPage<JobAiSessionListItem>>
  deleteMyJobAiSession(token: string, sessionId: string): Promise<{ deleted: true }>
  revokeJobAiConsent(token: string, scope?: 'job_ai'): Promise<JobAiConsentStatus>
}

export const EMPTY_JOB_AI_SESSION_PAGE: MemberAssetPage<JobAiSessionListItem> = { items: [], nextCursor: null, total: 0 }

// JOB_AI_MOCK_DISABLED：岗位 AI 不提供本地假推荐，避免 mock 结果被误认为商用验收通过。
const disabledAdapter: JobAiServiceInterface = {
  getJobAiConsentStatus: rejectMock,
  grantJobAiConsent: rejectMock,
  getJobAiRecommendations: rejectMock,
  explainJobWithAi: rejectMock,
  matchJobWithAi: rejectMock,
  listMyJobAiSessions: async () => EMPTY_JOB_AI_SESSION_PAGE,
  deleteMyJobAiSession: rejectMock,
  revokeJobAiConsent: rejectMock,
}

const adapter: JobAiServiceInterface = API_MODE === 'http' ? jobAiHttpAdapter : disabledAdapter

function rejectMock<T>(): Promise<T> {
  return Promise.reject(new ApiHttpError(
    'JOB_AI_MOCK_DISABLED',
    '岗位 AI 需要连接真实后端服务后使用',
    503,
  ))
}

export const getJobAiConsentStatus = (token: string) => adapter.getJobAiConsentStatus(token)

export const grantJobAiConsent = (token: string) => adapter.grantJobAiConsent(token)

export const getJobAiRecommendations = (token: string, input: JobRecommendationRequest) =>
  adapter.getJobAiRecommendations(token, input)

export const explainJobWithAi = (token: string, jobId: string) =>
  adapter.explainJobWithAi(token, jobId)

export const matchJobWithAi = (token: string, jobId: string, resumeTaskId: string) =>
  adapter.matchJobWithAi(token, jobId, resumeTaskId)

export const listMyJobAiSessions = (
  token: string | null | undefined,
  opts?: JobAiPageOpts,
): Promise<MemberAssetPage<JobAiSessionListItem>> => {
  if (API_MODE !== 'http' || !token) return Promise.resolve(EMPTY_JOB_AI_SESSION_PAGE)
  return adapter.listMyJobAiSessions(token, opts)
}

export const deleteMyJobAiSession = (token: string, sessionId: string) =>
  adapter.deleteMyJobAiSession(token, sessionId)

export const revokeJobAiConsent = (token: string, scope: 'job_ai' = 'job_ai') =>
  adapter.revokeJobAiConsent(token, scope)
