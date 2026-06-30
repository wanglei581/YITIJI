import type {
  JobMaterialGenerateInput,
  JobMaterialGenerateResponse,
  JobMaterialDocumentTemplate,
  JobMaterialTemplate,
  ResumeTemplate,
} from '@ai-job-print/shared'
import {
  JOB_MATERIAL_TEMPLATES,
  isJobMaterialDocumentTemplate,
  isResumeTemplate,
} from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL, API_MODE } from './client'
import { ApiHttpError } from './httpAdapter'

interface Envelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string }
  message?: string | string[]
}

function extractError(body: Envelope<unknown>, fallback: string): { code: string; message: string } {
  const message = Array.isArray(body.message)
    ? body.message.join('；')
    : typeof body.message === 'string'
      ? body.message
      : undefined
  return {
    code: body.error?.code ?? 'UNKNOWN_ERROR',
    message: body.error?.message ?? message ?? fallback,
  }
}

async function parseEnvelope<T>(res: Response, token?: string | null): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as Envelope<T>
  if (!res.ok) {
    const error = extractError(body, `HTTP ${res.status}`)
    if (isMemberSessionInvalidError(res.status, error.code, Boolean(token))) notifyMemberSessionExpired(token ?? undefined)
    throw new ApiHttpError(error.code, error.message, res.status)
  }
  if (body.success === false) {
    const error = extractError(body, '求职材料接口返回失败')
    throw new ApiHttpError(error.code, error.message, res.status)
  }
  if (!body.data) throw new ApiHttpError('JOB_MATERIAL_EMPTY', '求职材料接口返回数据为空', res.status)
  return body.data
}

async function request<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })
  return parseEnvelope<T>(res, token)
}

async function getPublishedTemplates(): Promise<JobMaterialTemplate[]> {
  if (API_MODE !== 'http') {
    await new Promise((resolve) => setTimeout(resolve, 120))
    return JOB_MATERIAL_TEMPLATES.filter((template) => template.status === 'published')
  }
  return request<JobMaterialTemplate[]>('/job-materials/templates')
}

export async function getResumeTemplates(): Promise<ResumeTemplate[]> {
  const templates = await getPublishedTemplates()
  return templates.filter(isResumeTemplate)
}

export async function getJobMaterialTemplates(): Promise<JobMaterialDocumentTemplate[]> {
  const templates = await getPublishedTemplates()
  return templates.filter(isJobMaterialDocumentTemplate)
}

export async function generateJobMaterial(
  input: JobMaterialGenerateInput,
  token: string | null | undefined,
): Promise<JobMaterialGenerateResponse> {
  if (!token) {
    throw new ApiHttpError('MEMBER_MISSING_TOKEN', '请先登录后生成可保存的求职材料', 401)
  }

  if (API_MODE !== 'http') {
    await new Promise((resolve) => setTimeout(resolve, 600))
    const template =
      JOB_MATERIAL_TEMPLATES.filter(isJobMaterialDocumentTemplate).find((item) => item.id === input.templateId) ??
      JOB_MATERIAL_TEMPLATES.filter(isJobMaterialDocumentTemplate)[0]
    if (!template) {
      throw new ApiHttpError('JOB_MATERIAL_TEMPLATE_NOT_FOUND', '求职材料模板不存在或未发布', 404)
    }
    const fileId = `mock-job-material-${template.id}`
    return {
      templateId: template.id,
      templateTitle: template.title,
      documentType: template.type,
      fileId,
      filename: template.outputFilename,
      mimeType: 'application/pdf',
      sizeBytes: 128 * 1024,
      pageCount: 1,
      signedUrl: 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrCg==',
      signedUrlExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      fileExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      previewUrlPath: `/files/${fileId}/preview-url`,
      downloadUrlPath: `/files/${fileId}/download-url`,
    }
  }

  return request<JobMaterialGenerateResponse>(
    '/job-materials/generate',
    { method: 'POST', body: JSON.stringify(input) },
    token,
  )
}
