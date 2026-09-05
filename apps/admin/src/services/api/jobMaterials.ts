import {
  formatDate,
  JOB_MATERIAL_TEMPLATES,
  type JobMaterialAdminSummary,
  type JobMaterialTemplate,
  type JobMaterialTemplateField,
  type JobMaterialTemplateType,
  type ResumeTemplateLayoutPreset,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

interface Envelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string }
}

/**
 * 管理员视角的模板行：公开契约 JobMaterialTemplate + 后台运营元数据
 * （sortOrder / createdAt / updatedAt / updatedByUserId，来自 GET /admin/job-materials/templates）。
 */
export interface JobMaterialTemplateAdminRow extends JobMaterialTemplate {
  sortOrder: number
  createdAt: string
  updatedAt: string
  updatedByUserId: string | null
}

/** 后台新建 / 编辑模板的写入载荷（type/title/…/fields；tags 前端以逗号分隔录入后拆分）。 */
export interface JobMaterialTemplateAdminInput {
  type: JobMaterialTemplateType
  title: string
  description: string
  tags: string[]
  recommendedFor: string
  outputFilename: string
  sortOrder: number
  fields: JobMaterialTemplateField[]
  resumeLayoutPreset?: ResumeTemplateLayoutPreset
}

export type JobMaterialTemplatePublishAction = 'publish' | 'unpublish'

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

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: 'application/json', ...authHeader() },
    credentials: 'include',
    ...init,
  })
  if (!res.ok) await parseError(res)
  const body = (await res.json()) as Envelope<T>
  if (body.success === false)
    throw new ApiHttpError(
      body.error?.code ?? 'UNKNOWN_ERROR',
      body.error?.message ?? '请求失败',
      res.status
    )
  if (body.data === undefined) throw new ApiHttpError('EMPTY_RESPONSE', '接口返回为空', res.status)
  return body.data
}

// ─── Mock adapter（API_MODE !== 'http' 时内存模拟，刷新后回到种子六条）──────────

let mockStore: JobMaterialTemplateAdminRow[] | null = null

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function ensureMockStore(): JobMaterialTemplateAdminRow[] {
  if (!mockStore) {
    const now = new Date().toISOString()
    mockStore = JOB_MATERIAL_TEMPLATES.map((template, index) => ({
      ...deepClone(template),
      sortOrder: index,
      createdAt: now,
      updatedAt: now,
      updatedByUserId: null,
    }))
  }
  return mockStore
}

function mockRowsSorted(): JobMaterialTemplateAdminRow[] {
  return [...ensureMockStore()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)
  )
}

function mockMutation(row: JobMaterialTemplateAdminRow): JobMaterialTemplateAdminRow {
  mockStore = (mockStore ?? []).map((item) => (item.id === row.id ? row : item))
  return deepClone(row)
}

function mockSummary(): JobMaterialAdminSummary {
  const templates = ensureMockStore().map((template, index) => ({
    id: template.id,
    type: template.type,
    title: template.title,
    status: template.status,
    generatedCount: index === 0 ? 0 : 3 + index,
  }))
  return {
    templateCount: templates.length,
    publishedTemplateCount: templates.filter((template) => template.status === 'published').length,
    generatedFileCount: templates.reduce((sum, template) => sum + template.generatedCount, 0),
    activeGeneratedFileCount: templates.reduce((sum, template) => sum + template.generatedCount, 0),
    last7DaysGenerated: Array.from({ length: 7 }, (_, index) => {
      const date = new Date()
      date.setDate(date.getDate() - (6 - index))
      return { date: formatDate(date), count: index % 3 }
    }),
    templates,
  }
}

/** 管理员模板目录（含未发布 / 已下架）。 */
export function getJobMaterialTemplatesForAdmin(): Promise<JobMaterialTemplateAdminRow[]> {
  if (API_MODE !== 'http') return Promise.resolve(mockRowsSorted())
  return req<JobMaterialTemplateAdminRow[]>('/admin/job-materials/templates')
}

export function getJobMaterialAdminSummary(): Promise<JobMaterialAdminSummary> {
  if (API_MODE !== 'http') return Promise.resolve(mockSummary())
  return req<JobMaterialAdminSummary>('/admin/job-materials/summary')
}

export function createJobMaterialTemplate(
  input: JobMaterialTemplateAdminInput
): Promise<JobMaterialTemplateAdminRow> {
  if (API_MODE !== 'http') {
    const now = new Date().toISOString()
    const row: JobMaterialTemplateAdminRow = {
      ...deepClone(input),
      id: `mock-template-${Date.now()}`,
      status: 'disabled',
      createdAt: now,
      updatedAt: now,
      updatedByUserId: 'mock-admin',
    }
    ensureMockStore().push(row)
    return Promise.resolve(deepClone(row))
  }
  return req<JobMaterialTemplateAdminRow>('/admin/job-materials/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function updateJobMaterialTemplate(
  id: string,
  patch: Partial<JobMaterialTemplateAdminInput>
): Promise<JobMaterialTemplateAdminRow> {
  if (API_MODE !== 'http') {
    const row = ensureMockStore().find((item) => item.id === id)
    if (!row) return Promise.reject(new ApiHttpError('TEMPLATE_NOT_FOUND', '模板不存在', 404))
    const next = {
      ...row,
      ...deepClone(patch),
      updatedAt: new Date().toISOString(),
      updatedByUserId: 'mock-admin',
    } as JobMaterialTemplateAdminRow
    return Promise.resolve(mockMutation(next))
  }
  return req<JobMaterialTemplateAdminRow>(
    `/admin/job-materials/templates/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  )
}

export function setJobMaterialTemplatePublish(
  id: string,
  action: JobMaterialTemplatePublishAction
): Promise<JobMaterialTemplateAdminRow> {
  if (API_MODE !== 'http') {
    const row = ensureMockStore().find((item) => item.id === id)
    if (!row) return Promise.reject(new ApiHttpError('TEMPLATE_NOT_FOUND', '模板不存在', 404))
    const next = {
      ...row,
      status: action === 'publish' ? 'published' : 'disabled',
      updatedAt: new Date().toISOString(),
      updatedByUserId: 'mock-admin',
    } as JobMaterialTemplateAdminRow
    return Promise.resolve(mockMutation(next))
  }
  return req<JobMaterialTemplateAdminRow>(
    `/admin/job-materials/templates/${encodeURIComponent(id)}/publish`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }
  )
}
