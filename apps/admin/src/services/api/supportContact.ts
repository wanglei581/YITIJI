// 法务文档版本页「服务联系」卡片用。只被这一页引用。
// API_MODE=http → /admin/support-contact
// API_MODE=mock → 内存，不假装已经写到后端。

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export interface AdminSupportContact {
  servicePhone: string | null
  serviceHours: string | null
  miniappPublished: boolean
}

export interface AdminSupportContactInput {
  servicePhone: string | null
  serviceHours: string | null
  miniappPublished: boolean
}

const PHONE_PATTERN = /^(?:1[3-9]\d{9}|0\d{2,3}-?\d{7,8})$/
const PHONE_MESSAGE = '服务电话需为大陆手机号或带区号的固定电话'

function cleanText(value: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function normalizeSupportContactInput(input: AdminSupportContactInput): AdminSupportContactInput {
  const servicePhone = cleanText(input.servicePhone)
  const serviceHours = cleanText(input.serviceHours)
  if (servicePhone && !PHONE_PATTERN.test(servicePhone)) {
    throw new ApiHttpError('VALIDATION_FAILED', PHONE_MESSAGE, 400)
  }
  if (serviceHours && serviceHours.length > 40) {
    throw new ApiHttpError('VALIDATION_FAILED', '服务时间不超过 40 个字', 400)
  }
  return {
    servicePhone,
    serviceHours,
    miniappPublished: input.miniappPublished === true,
  }
}

function handleAuthFailure(status: number): void {
  if (status === 401 || status === 403) redirectToLogin()
}

async function toApiError(res: Response, fallbackMessage: string): Promise<ApiHttpError> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string }
    message?: unknown
  }
  const message = body.error?.message ?? (typeof body.message === 'string' ? body.message : undefined)
  return new ApiHttpError(body.error?.code ?? 'SUPPORT_CONTACT_ERROR', message ?? fallbackMessage, res.status)
}

async function httpGet(): Promise<AdminSupportContact> {
  const res = await fetch(`${API_BASE_URL}/admin/support-contact`, { headers: authHeader() })
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, '服务联系方式加载失败')
  const { data } = (await res.json()) as { data: AdminSupportContact }
  return data
}

async function httpSave(input: AdminSupportContactInput): Promise<AdminSupportContact> {
  const res = await fetch(`${API_BASE_URL}/admin/support-contact`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(input),
  })
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, '服务联系方式保存失败')
  const { data } = (await res.json()) as { data: AdminSupportContact }
  return data
}

let mockStore: AdminSupportContact = {
  servicePhone: null,
  serviceHours: null,
  miniappPublished: false,
}

export const supportContactService = {
  async get(): Promise<AdminSupportContact> {
    if (API_MODE === 'http') return httpGet()
    return { ...mockStore }
  },
  async save(input: AdminSupportContactInput): Promise<AdminSupportContact> {
    const next = normalizeSupportContactInput(input)
    if (API_MODE === 'http') return httpSave(next)
    mockStore = next
    return { ...mockStore }
  },
}
