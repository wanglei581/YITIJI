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

/**
 * 服务端统一错误体是 `{ error: { code, message } }`（HttpExceptionFilter）。此前这里读的是
 * 顶层 `body.message`，永远取不到，后台只会显示「获取失败」这类兜底句。顶层 message 仍兼容。
 */
async function toApiError(res: Response, fallbackCode: string, fallbackMessage: string): Promise<ApiHttpError> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string }
    message?: unknown
  }
  const message = body.error?.message ?? (typeof body.message === 'string' ? body.message : undefined)
  return new ApiHttpError(body.error?.code ?? fallbackCode, message ?? fallbackMessage, res.status)
}

async function httpList(docType?: string): Promise<LegalDocVersionView[]> {
  const url = docType
    ? `${API_BASE_URL}/admin/legal-doc-versions?docType=${encodeURIComponent(docType)}`
    : `${API_BASE_URL}/admin/legal-doc-versions`
  const res = await fetch(url, { headers: authHeader() })
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, 'LIST_ERROR', '获取失败')
  const { data } = (await res.json()) as { data: LegalDocVersionView[] }
  return data ?? []
}

/** 管理员读取单个版本（含正文）；服务端每次读取都写访问审计。 */
async function httpGet(id: string): Promise<LegalDocVersionDetail> {
  const res = await fetch(`${API_BASE_URL}/admin/legal-doc-versions/${encodeURIComponent(id)}`, {
    headers: authHeader(),
  })
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, 'GET_ERROR', '正文加载失败')
  const { data } = (await res.json()) as { data: LegalDocVersionDetail }
  return data
}

async function httpCreate(input: CreateLegalDocVersionInput): Promise<LegalDocVersionView> {
  const res = await fetch(`${API_BASE_URL}/admin/legal-doc-versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(input),
  })
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, 'CREATE_ERROR', '创建失败')
  const { data } = (await res.json()) as { data: LegalDocVersionView }
  return data
}

async function httpActivate(id: string): Promise<LegalDocVersionView> {
  const res = await fetch(`${API_BASE_URL}/admin/legal-doc-versions/${id}/activate`, {
    method: 'PATCH',
    headers: authHeader(),
  })
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, 'ACTIVATE_ERROR', '激活失败')
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
    title: 'AI 服务说明',
    isActive: false,
    publishedAt: null,
    publishedBy: null,
    createdAt: '2026-07-01T00:00:00.000Z',
  },
]

const MOCK_ACTIVE_CONTENT: Record<string, string> = {
  terms_of_service:
    '本后台为「职易达」的运营管理系统，用于终端设备、打印订单、文件与 AI 服务的运营，以及合作机构入驻核验和机构内容（政策、官方渠道）的紧急下架；机构内容由机构自行审核发布。\n\n本平台不是网络招聘平台：不提供平台内投递，不接收或转交求职者简历，不提供候选人筛选、面试邀约或录用管理功能。',
  privacy_policy:
    '为提供后台登录与账号安全能力，系统处理以下信息：账号名、绑定手机号、登录时间与来源、后台操作日志。\n\n手机号仅用于短信验证码登录、本人验证与密码找回；操作日志仅用于安全审计与故障排查。',
}

/** mock「查看正文」用：非当前有效版本的演示正文，以及 mock 新建的草稿正文。 */
const MOCK_CONTENT_BY_ID = new Map<string, string>([
  ['mock-terms-v0', '（演示数据）旧版用户服务协议正文。\n\n第一条 服务内容\n本条为演示文字，用于查看已归档版本。'],
  ['mock-ai-v1', '（演示数据）\n\n一、AI 生成内容仅供参考\n简历优化、模拟面试点评等结果由 AI 生成，请自行核对。\n\n二、如何投诉\n对 AI 生成内容有异议，可在一体机「意见反馈」选择「AI 内容投诉」。'],
])

let mockIdSeq = 1000

function mockList(docType?: string): LegalDocVersionView[] {
  return docType ? MOCK_STORE.filter((d) => d.docType === docType) : [...MOCK_STORE]
}

function mockGet(id: string): LegalDocVersionDetail {
  const row = MOCK_STORE.find((d) => d.id === id)
  if (!row) throw new ApiHttpError('LEGAL_DOC_NOT_FOUND', '法务文档版本不存在', 404)
  const content =
    MOCK_CONTENT_BY_ID.get(id) ?? (row.isActive ? MOCK_ACTIVE_CONTENT[row.docType] : undefined) ?? '（演示数据：这一版没有示例正文）'
  return { ...row, content }
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
  MOCK_CONTENT_BY_ID.set(item.id, input.content)
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
  if (!res.ok) throw await toApiError(res, 'LEGAL_DOC_LOAD_ERROR', '法务文档加载失败')
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

  /** 读取单个版本（含正文）；每次读取服务端写 legal_doc.view 访问审计。 */
  get: (id: string) =>
    API_MODE === 'http' ? httpGet(id) : Promise.resolve().then(() => mockGet(id)),

  create: (input: CreateLegalDocVersionInput) =>
    API_MODE === 'http' ? httpCreate(input) : Promise.resolve(mockCreate(input)),

  activate: (id: string) =>
    API_MODE === 'http' ? httpActivate(id) : Promise.resolve(mockActivate(id)),

  /** 登录页无鉴权读取当前有效版本；失败不得回落到硬编码 v1 草拟文。 */
  getActive: (docType: string) =>
    API_MODE === 'http' ? httpGetActive(docType) : Promise.resolve(mockGetActive(docType)),
}
