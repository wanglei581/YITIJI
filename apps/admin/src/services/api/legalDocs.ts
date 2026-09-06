// ============================================================
// Admin 法务文档版本管理 Service
//
// API_MODE=http → 真实后端 /admin/legal-doc-versions
// API_MODE=mock → 内存 mock（无后端也能走通 UI）
// ============================================================

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export interface LegalDocVersionView {
  id: string
  docType: string
  version: string
  title: string
  isActive: boolean
  publishedAt: string | null
  publishedBy: string | null
  createdAt: string
}

/** 登录页 / 公开读取：当前有效版本全文（GET /kiosk/legal/:type，无鉴权）。 */
export interface LegalDocActiveView {
  id: string
  docType: string
  version: string
  title: string
  content: string
  publishedAt: string | null
}

export interface LegalDocVersionDetail extends LegalDocVersionView {
  content: string
}

export interface CreateLegalDocVersionInput {
  docType: string
  version: string
  title: string
  content: string
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

function handleAuthFailure(status: number): void {
  if (status === 401 || status === 403) redirectToLogin()
}

async function httpList(docType?: string): Promise<LegalDocVersionView[]> {
  const url = docType
    ? `${API_BASE_URL}/admin/legal-doc-versions?docType=${encodeURIComponent(docType)}`
    : `${API_BASE_URL}/admin/legal-doc-versions`
  const res = await fetch(url, { headers: authHeader() })
  handleAuthFailure(res.status)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    throw new ApiHttpError('LIST_ERROR', body.message ?? '获取失败', res.status)
  }
  const { data } = (await res.json()) as { data: LegalDocVersionView[] }
  return data ?? []
}

async function httpCreate(input: CreateLegalDocVersionInput): Promise<LegalDocVersionView> {
  const res = await fetch(`${API_BASE_URL}/admin/legal-doc-versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(input),
  })
  handleAuthFailure(res.status)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    throw new ApiHttpError('CREATE_ERROR', body.message ?? '创建失败', res.status)
  }
  const { data } = (await res.json()) as { data: LegalDocVersionView }
  return data
}

async function httpActivate(id: string): Promise<LegalDocVersionView> {
  const res = await fetch(`${API_BASE_URL}/admin/legal-doc-versions/${id}/activate`, {
    method: 'PATCH',
    headers: authHeader(),
  })
  handleAuthFailure(res.status)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    throw new ApiHttpError('ACTIVATE_ERROR', body.message ?? '激活失败', res.status)
  }
  const { data } = (await res.json()) as { data: LegalDocVersionView }
  return data
}

// ─── Mock adapter ─────────────────────────────────────────────────────────────

const MOCK_STORE: LegalDocVersionView[] = [
  {
    id: 'mock-terms-v0',
    docType: 'terms_of_service',
    version: 'v0.9',
    title: '用户服务协议',
    isActive: false,
    publishedAt: '2026-05-01T00:00:00.000Z',
    publishedBy: 'admin',
    createdAt: '2026-05-01T00:00:00.000Z',
  },
  {
    id: 'mock-terms-v1',
    docType: 'terms_of_service',
    version: 'v1.0',
    title: '用户服务协议',
    isActive: true,
    publishedAt: '2026-06-22T00:00:00.000Z',
    publishedBy: 'admin',
    createdAt: '2026-06-22T00:00:00.000Z',
  },
  {
    id: 'mock-privacy-v1',
    docType: 'privacy_policy',
    version: 'v1.0',
    title: '隐私政策',
    isActive: true,
    publishedAt: '2026-06-22T00:00:00.000Z',
    publishedBy: 'admin',
    createdAt: '2026-06-22T00:00:00.000Z',
  },
  {
    id: 'mock-ai-v1',
    docType: 'ai_disclaimer',
    version: 'v1.0',
    title: 'AI 服务免责声明',
    isActive: false,
    publishedAt: null,
    publishedBy: null,
    createdAt: '2026-07-01T00:00:00.000Z',
  },
]

const MOCK_ACTIVE_CONTENT: Record<string, string> = {
  terms_of_service:
    '本后台为「AI求职打印服务终端」的运营管理系统，用于终端设备、打印订单、文件、AI 服务及第三方来源信息（岗位、招聘会、政策等）的管理与审核。\n\n本平台不是网络招聘平台：不提供平台内投递，不接收或转交求职者简历，不提供候选人筛选、面试邀约或录用管理功能。',
  privacy_policy:
    '为提供后台登录与账号安全能力，系统处理以下信息：账号名、绑定手机号、登录时间与来源、后台操作日志。\n\n手机号仅用于短信验证码登录、本人验证与密码找回；操作日志仅用于安全审计与故障排查。',
}

let mockIdSeq = 1000

function mockList(docType?: string): LegalDocVersionView[] {
  return docType ? MOCK_STORE.filter((d) => d.docType === docType) : [...MOCK_STORE]
}

function mockCreate(input: CreateLegalDocVersionInput): LegalDocVersionView {
  const item: LegalDocVersionView = {
    id: `mock-${++mockIdSeq}`,
    docType: input.docType,
    version: input.version,
    title: input.title,
    isActive: false,
    publishedAt: null,
    publishedBy: 'admin',
    createdAt: new Date().toISOString(),
  }
  MOCK_STORE.push(item)
  return item
}

function mockActivate(id: string): LegalDocVersionView {
  const target = MOCK_STORE.find((d) => d.id === id)
  if (!target) throw new Error('not found')
  // 失活同类型其它版本，但保留 publishedAt，供列表显示「已归档 / 已被 vX 取代」。
  MOCK_STORE.filter((d) => d.docType === target.docType).forEach((d) => {
    d.isActive = false
  })
  target.isActive = true
  target.publishedAt = new Date().toISOString()
  return { ...target }
}

async function httpGetActive(docType: string): Promise<LegalDocActiveView | null> {
  const res = await fetch(`${API_BASE_URL}/kiosk/legal/${encodeURIComponent(docType)}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    throw new ApiHttpError('LEGAL_DOC_LOAD_ERROR', body.message ?? '法务文档加载失败', res.status)
  }
  const body = (await res.json()) as { success?: boolean; data?: LegalDocActiveView | null }
  return body.data ?? null
}

function mockGetActive(docType: string): LegalDocActiveView | null {
  const row = MOCK_STORE.find((d) => d.docType === docType && d.isActive)
  if (!row) return null
  const content = MOCK_ACTIVE_CONTENT[docType]
  if (!content) return null
  return {
    id: row.id,
    docType: row.docType,
    version: row.version,
    title: row.title,
    content,
    publishedAt: row.publishedAt,
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const legalDocsService = {
  list: (docType?: string) =>
    API_MODE === 'http' ? httpList(docType) : Promise.resolve(mockList(docType)),

  create: (input: CreateLegalDocVersionInput) =>
    API_MODE === 'http' ? httpCreate(input) : Promise.resolve(mockCreate(input)),

  activate: (id: string) =>
    API_MODE === 'http' ? httpActivate(id) : Promise.resolve(mockActivate(id)),

  /** 登录页无鉴权读取当前有效版本；失败不得回落到硬编码 v1 草拟文。 */
  getActive: (docType: string) =>
    API_MODE === 'http' ? httpGetActive(docType) : Promise.resolve(mockGetActive(docType)),
}
