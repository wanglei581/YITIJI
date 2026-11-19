// 每天的免费 AI 次数（管理员改简历类、小青、模拟面试）。
// GET/PUT /admin/ai/quota-limits，POST /admin/ai/quota-limits/reset。
// 页面只认服务端返回的生效值。演示模式不连后端，也不把提交说成已保存。

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type AiQuotaLimitBucketName = 'ai_resume' | 'ai_assistant' | 'ai_interview'
export type AiQuotaLimitSource = 'admin' | 'env' | 'default'

export interface AiQuotaLimitBucket {
  bucket: AiQuotaLimitBucketName
  effective: number
  source: AiQuotaLimitSource
  fallback: number
}

export interface AiQuotaLimitConfig {
  buckets: AiQuotaLimitBucket[]
}

export type AiQuotaLimitInput = Record<AiQuotaLimitBucketName, number>

export const AI_QUOTA_LIMITS_DEMO: boolean = API_MODE !== 'http'

const PATH = '/admin/ai/quota-limits'
const BUCKETS: readonly AiQuotaLimitBucketName[] = ['ai_resume', 'ai_assistant', 'ai_interview']
const SOURCES: readonly AiQuotaLimitSource[] = ['admin', 'env', 'default']

function malformed(): never {
  throw new ApiHttpError('UNEXPECTED_RESPONSE', '服务端返回的每天免费次数无法识别，请点“重新读取”核对', 200)
}

function readBucket(value: unknown): AiQuotaLimitBucket | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (!BUCKETS.includes(row.bucket as AiQuotaLimitBucketName)) return null
  if (!SOURCES.includes(row.source as AiQuotaLimitSource)) return null
  if (typeof row.effective !== 'number' || !Number.isInteger(row.effective) || row.effective < 0) return null
  if (typeof row.fallback !== 'number' || !Number.isInteger(row.fallback) || row.fallback < 0) return null
  return {
    bucket: row.bucket as AiQuotaLimitBucketName,
    effective: row.effective,
    source: row.source as AiQuotaLimitSource,
    fallback: row.fallback,
  }
}

export function aiQuotaLimitsFromResponse(body: unknown): AiQuotaLimitConfig {
  const data = body && typeof body === 'object' ? (body as { data?: unknown }).data : undefined
  const bucketsRaw = data && typeof data === 'object' ? (data as { buckets?: unknown }).buckets : undefined
  if (!Array.isArray(bucketsRaw)) malformed()
  const buckets = BUCKETS.map((bucket) => {
    const row = bucketsRaw.find((item) => readBucket(item)?.bucket === bucket)
    const parsed = readBucket(row)
    if (!parsed) malformed()
    return parsed
  })
  return { buckets }
}

async function request(method: 'GET' | 'PUT' | 'POST', body?: unknown): Promise<AiQuotaLimitConfig> {
  if (AI_QUOTA_LIMITS_DEMO) {
    throw new ApiHttpError('DEMO_MODE_NO_QUOTA_LIMITS', '演示模式不连接每天的免费次数，请连接真实后端后再改', 0)
  }
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${PATH}${method === 'POST' ? '/reset' : ''}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...authHeader() },
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请检查网络后重试', 0)
  }
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = '每天的免费次数没有改成，请稍后重试'
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } }
      if (data.error?.code) code = data.error.code
      if (data.error?.message) message = data.error.message
    } catch {
      /* 非 JSON 时保留上面的说明 */
    }
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, res.status)
  }
  try {
    return aiQuotaLimitsFromResponse(await res.json())
  } catch (error) {
    if (error instanceof ApiHttpError) throw error
    malformed()
  }
}

export function getAiQuotaLimits(): Promise<AiQuotaLimitConfig> {
  return request('GET')
}

export function updateAiQuotaLimits(input: AiQuotaLimitInput): Promise<AiQuotaLimitConfig> {
  return request('PUT', {
    ai_resume: input.ai_resume,
    ai_assistant: input.ai_assistant,
    ai_interview: input.ai_interview,
  })
}

export function resetAiQuotaLimits(): Promise<AiQuotaLimitConfig> {
  return request('POST')
}
