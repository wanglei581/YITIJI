import type {
  JobExplainResponse,
  JobFitResponse,
  JobAiSessionListItem,
  JobRecommendationRequest,
  JobRecommendationResponse,
  MemberAssetPage,
} from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { getTerminalId } from './screensaver'
import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'

export interface JobAiConsentStatus {
  scope: 'job_ai'
  consentVersion: string
  granted: boolean
  grantedAt: string | null
  revokedAt: string | null
}

export interface JobAiMatchResponse {
  session: {
    id: string
    resumeTaskId?: string | null
    operation: 'recommend' | 'explain' | 'match'
    status: 'pending' | 'completed' | 'failed'
    provider?: string | null
    terminalId?: string | null
    createdAt: string
    expiresAt?: string | null
  }
  job: JobExplainResponse['job']
  jobFit: JobFitResponse
  disclaimer: '仅供参考'
}

interface Envelope<T> {
  success: boolean
  data: T
}

export interface JobAiPageOpts {
  cursor?: string | null
  pageSize?: number
}

function pageQuery(opts?: JobAiPageOpts): string {
  const params = new URLSearchParams()
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  const query = params.toString()
  return query ? `?${query}` : ''
}

function authHeaders(token: string, withJsonBody = false): Record<string, string> {
  const terminalId = getTerminalId()
  return {
    Accept: 'application/json',
    ...(withJsonBody ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${token}`,
    ...(terminalId ? { 'x-terminal-id': terminalId } : {}),
  }
}

async function post<T>(path: string, token: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(token, true),
    credentials: 'include',
    body: JSON.stringify(body),
  })
  return unwrap<T>(res, token)
}

async function del<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: authHeaders(token),
    credentials: 'include',
  })
  return unwrap<T>(res, token)
}

async function get<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: authHeaders(token),
    credentials: 'include',
  })
  return unwrap<T>(res, token)
}

async function unwrap<T>(res: Response, token: string): Promise<T> {
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch {
      // keep defaults
    }
    if (isMemberSessionInvalidError(res.status, code, true)) notifyMemberSessionExpired(token)
    throw new ApiHttpError(code, message, res.status)
  }
  const json = (await res.json()) as Envelope<T>
  return json.data
}

export const jobAiHttpAdapter = {
  getJobAiConsentStatus(token: string): Promise<JobAiConsentStatus[]> {
    return get<JobAiConsentStatus[]>('/me/ai-consents/status', token)
  },

  grantJobAiConsent(token: string): Promise<JobAiConsentStatus> {
    return post<JobAiConsentStatus>('/me/ai-consents', token, { scope: 'job_ai' })
  },

  getJobAiRecommendations(token: string, input: JobRecommendationRequest): Promise<JobRecommendationResponse> {
    return post<JobRecommendationResponse>('/jobs/ai/recommendations', token, input)
  },

  explainJobWithAi(token: string, jobId: string): Promise<JobExplainResponse> {
    return post<JobExplainResponse>(`/jobs/${encodeURIComponent(jobId)}/ai/explain`, token)
  },

  matchJobWithAi(token: string, jobId: string, resumeTaskId: string): Promise<JobAiMatchResponse> {
    return post<JobAiMatchResponse>(`/jobs/${encodeURIComponent(jobId)}/ai/match`, token, { resumeTaskId })
  },

  listMyJobAiSessions(token: string, opts?: JobAiPageOpts): Promise<MemberAssetPage<JobAiSessionListItem>> {
    return get<MemberAssetPage<JobAiSessionListItem>>(`/me/job-ai-sessions${pageQuery(opts)}`, token)
  },

  deleteMyJobAiSession(token: string, sessionId: string): Promise<{ deleted: true }> {
    return del<{ deleted: true }>(`/me/job-ai-sessions/${encodeURIComponent(sessionId)}`, token)
  },

  revokeJobAiConsent(token: string, scope: 'job_ai' = 'job_ai'): Promise<JobAiConsentStatus> {
    return post<JobAiConsentStatus>(`/me/ai-consents/${encodeURIComponent(scope)}/revoke`, token)
  },
}
