import type { JobMaterialAdminSummary, JobMaterialTemplate } from '@ai-job-print/shared'
import { JOB_MATERIAL_TEMPLATES } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

interface Envelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string }
}

async function parseError(res: Response): Promise<never> {
  let code = `HTTP_${res.status}`
  let message = res.statusText || '请求失败'
  try {
    const body = (await res.json()) as Envelope<unknown>
    code = body.error?.code ?? code
    message = body.error?.message ?? message
  } catch {
    /* keep defaults */
  }
  if (res.status === 401) {
    redirectToLogin()
    throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', res.status)
  }
  throw new ApiHttpError(code, message, res.status)
}

async function req<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: 'application/json', ...authHeader() },
    credentials: 'include',
  })
  if (!res.ok) await parseError(res)
  const body = (await res.json()) as Envelope<T>
  if (body.success === false) throw new ApiHttpError(body.error?.code ?? 'UNKNOWN_ERROR', body.error?.message ?? '请求失败', res.status)
  if (body.data === undefined) throw new ApiHttpError('EMPTY_RESPONSE', '接口返回为空', res.status)
  return body.data
}

function mockSummary(): JobMaterialAdminSummary {
  const templates = JOB_MATERIAL_TEMPLATES.map((template, index) => ({
    id: template.id,
    type: template.type,
    title: template.title,
    status: template.status,
    generatedCount: index === 0 ? 0 : 3 + index,
  }))
  return {
    templateCount: JOB_MATERIAL_TEMPLATES.length,
    publishedTemplateCount: JOB_MATERIAL_TEMPLATES.filter((template) => template.status === 'published').length,
    generatedFileCount: templates.reduce((sum, template) => sum + template.generatedCount, 0),
    activeGeneratedFileCount: templates.reduce((sum, template) => sum + template.generatedCount, 0),
    last7DaysGenerated: Array.from({ length: 7 }, (_, index) => {
      const date = new Date()
      date.setDate(date.getDate() - (6 - index))
      return { date: date.toISOString().slice(0, 10), count: index % 3 }
    }),
    templates,
  }
}

export function getJobMaterialTemplatesForAdmin(): Promise<JobMaterialTemplate[]> {
  if (API_MODE !== 'http') return Promise.resolve(JOB_MATERIAL_TEMPLATES)
  return req<JobMaterialTemplate[]>('/job-materials/templates')
}

export function getJobMaterialAdminSummary(): Promise<JobMaterialAdminSummary> {
  if (API_MODE !== 'http') return Promise.resolve(mockSummary())
  return req<JobMaterialAdminSummary>('/admin/job-materials/summary')
}
