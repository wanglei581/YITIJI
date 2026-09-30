// 管理员为「临时密码、手机未自证」的机构账号登记联系人手机。
// 成功体与其它 /admin/orgs 账号接口一样是裸 JSON，不套 { data }。
// 手机号、确认函编号、本人密码不写入浏览器存储。

import { API_BASE_URL, API_MODE } from './client'
import { authHeader, redirectToLogin } from '../auth'

export interface RegisterPartnerContactPhoneInput {
  phone: string
  confirmationLetterNo: string
  currentPassword: string
}

export interface RegisterPartnerContactPhoneResult {
  accountId: string
  phoneMasked: string
  registeredAt: string
}

export type RegisterPartnerContactPhoneResponse =
  | ({ ok: true } & RegisterPartnerContactPhoneResult)
  | { ok: false; code: string; message: string; status: number }

const MAINLAND_MOBILE_PATTERN = /^1[3-9]\d{9}$/
const CONFIRMATION_LETTER_NO_PATTERN = /^[A-Za-z0-9/-]{4,64}$/
const MASKED_PHONE_PATTERN = /^1[3-9]\d\*{4}\d{4}$/
const SUCCESS_KEYS = ['accountId', 'phoneMasked', 'registeredAt'] as const

export function contactPhoneRegistrationFieldError(body: RegisterPartnerContactPhoneInput): string | null {
  if (!MAINLAND_MOBILE_PATTERN.test(body.phone)) return '请输入 11 位大陆手机号'
  if (!CONFIRMATION_LETTER_NO_PATTERN.test(body.confirmationLetterNo)) {
    return '确认函编号须为 4–64 位字母、数字、横线或斜线'
  }
  if (body.currentPassword.length === 0) return '请输入本人当前密码'
  return null
}

function invalidResponse(status: number): RegisterPartnerContactPhoneResponse {
  return { ok: false, code: 'INVALID_RESPONSE', message: '服务响应异常，请稍后再试', status }
}

function isMaskedPhone(value: unknown): value is string {
  return typeof value === 'string' && (MASKED_PHONE_PATTERN.test(value) || value === '***')
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function isRegisterPartnerContactPhoneSuccess(value: unknown): value is RegisterPartnerContactPhoneResult {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== SUCCESS_KEYS.length || !SUCCESS_KEYS.every((key) => keys.includes(key))) return false
  return typeof record.accountId === 'string'
    && record.accountId.trim().length > 0
    && record.accountId.length <= 128
    && isMaskedPhone(record.phoneMasked)
    && isCanonicalIsoDate(record.registeredAt)
}

function requestBody(body: RegisterPartnerContactPhoneInput): string {
  return JSON.stringify({
    phone: body.phone,
    confirmationLetterNo: body.confirmationLetterNo,
    currentPassword: body.currentPassword,
  })
}

async function errorResult(res: Response): Promise<RegisterPartnerContactPhoneResponse> {
  let code = `HTTP_${res.status}`
  let message = res.statusText || '请求失败'
  try {
    const payload = await res.json() as {
      error?: { code?: unknown; message?: unknown }
      message?: unknown
    }
    if (typeof payload.error?.code === 'string' && payload.error.code.length > 0) code = payload.error.code
    if (typeof payload.error?.message === 'string') message = payload.error.message
    else if (typeof payload.message === 'string') message = payload.message
    else if (Array.isArray(payload.message) && payload.message.every((item) => typeof item === 'string') && payload.message.length > 0) {
      message = payload.message.join('；')
    }
  } catch {
    /* 保留状态码兜底，不把解析异常当成成功 */
  }
  if (res.status === 401) redirectToLogin()
  return { ok: false, code, message, status: res.status }
}

export async function registerPartnerContactPhone(
  orgId: string,
  accountId: string,
  body: RegisterPartnerContactPhoneInput,
): Promise<RegisterPartnerContactPhoneResponse> {
  const fieldError = contactPhoneRegistrationFieldError(body)
  if (fieldError) return { ok: false, code: 'VALIDATION_ERROR', message: fieldError, status: 400 }
  if (API_MODE !== 'http') {
    return {
      ok: false,
      code: 'DEMO_MODE_READONLY',
      message: '当前为 mock 模式，登记手机号需要连接真实后端',
      status: 501,
    }
  }
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/admin/orgs/${encodeURIComponent(orgId)}/accounts/${encodeURIComponent(accountId)}/contact-phone`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...authHeader(),
      },
      credentials: 'include',
      body: requestBody(body),
    })
  } catch {
    return { ok: false, code: 'NETWORK_ERROR', message: '网络连接异常，请检查网络后重试', status: 0 }
  }
  if (!res.ok) return errorResult(res)
  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    return invalidResponse(res.status)
  }
  if (!isRegisterPartnerContactPhoneSuccess(payload)) return invalidResponse(res.status)
  return {
    ok: true,
    accountId: payload.accountId,
    phoneMasked: payload.phoneMasked,
    registeredAt: payload.registeredAt,
  }
}
