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
  // deactivate others of same type
  MOCK_STORE.filter((d) => d.docType === target.docType).forEach((d) => (d.isActive = false))
  target.isActive = true
  target.publishedAt = new Date().toISOString()
  return { ...target }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const legalDocsService = {
  list: (docType?: string) =>
    API_MODE === 'http' ? httpList(docType) : Promise.resolve(mockList(docType)),

  create: (input: CreateLegalDocVersionInput) =>
    API_MODE === 'http' ? httpCreate(input) : Promise.resolve(mockCreate(input)),

  activate: (id: string) =>
    API_MODE === 'http' ? httpActivate(id) : Promise.resolve(mockActivate(id)),
}
