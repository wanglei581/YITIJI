// ============================================================
// 合作机构「一机构一码」专属小程序入口服务
//
// http 模式：
//   GET  /partner/miniapp-entry       → 读取本机构专属路径、scene、在线终端数与发码能力
//   POST /partner/miniapp-entry-code  → 生成本机构专属无限制小程序码（受授权拦截）
// ============================================================

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type MiniappEnvVersion = 'release' | 'trial' | 'develop'

export interface PartnerMiniappEntryInfo {
  orgId: string
  orgName: string
  brandName: string
  miniappPath: string
  miniappScene: string
  sceneValid: boolean
  miniappCodeAvailable: boolean
  envVersion: MiniappEnvVersion
  onlineTerminalCount: number
  totalTerminalCount: number
}

export interface PartnerMiniappEntryCodeResult {
  orgId: string
  miniappPath: string
  miniappScene: string
  envVersion: MiniappEnvVersion
  mimeType: 'image/jpeg' | 'image/png'
  imageBase64: string
  dataUri: string
}

const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  MINIAPP_NOT_CONFIGURED: '平台暂未配置微信小程序凭据，当前无法生成小程序码，仍可先复制公众号菜单路径。',
  MINIAPP_CODE_FAILED: '微信生成小程序码失败（若小程序尚未发布正式版请稍后重试）。',
  MINIAPP_SCENE_INVALID: '当前机构编号超出微信参数长度限制，请联系平台管理员处理。',
  ORG_DISABLED: '当前机构已停用，无法生成机构专属小程序码。',
  ORG_REQUIRED: '当前账号未绑定机构，无法读取机构专属入口。',
  LICENSE_INACTIVE: '当前机构软件授权不可用，暂不能生成新的推广小程序码。',
  THROTTLE_EXCEEDED: '操作过于频繁，请 1 分钟后再试。',
}

export function miniappEntryErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiHttpError) {
    if (err.code && KNOWN_ERROR_MESSAGES[err.code]) return KNOWN_ERROR_MESSAGES[err.code]
    if (err.status === 429) return KNOWN_ERROR_MESSAGES.THROTTLE_EXCEEDED
    if (err.status === 403) return '当前状态暂不允许执行此操作，请检查机构授权或联系平台管理员。'
    if (err.message && /[\u4e00-\u9fa5]/.test(err.message)) return err.message
  }
  return fallback
}

async function request<T>(path: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...authHeader(),
    },
    credentials: 'include',
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = ''
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      if (body.error?.code) code = body.error.code
      if (body.error?.message) message = body.error.message
    } catch {
      /* ignore parse failure */
    }
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message || fallbackStatusText(res.status), res.status)
  }
  const json = (await res.json()) as { data?: T } & T
  return (json && typeof json === 'object' && 'data' in json && json.data !== undefined ? json.data : json) as T
}

function fallbackStatusText(status: number): string {
  if (status === 429) return '请求过于频繁，请稍后再试'
  if (status >= 500) return '服务暂时不可用，请稍后重试'
  return '请求未通过校验，请刷新重试'
}

export const partnerMiniappEntryService = {
  async getInfo(): Promise<PartnerMiniappEntryInfo> {
    if (API_MODE === 'mock') {
      return {
        orgId: 'mock_org_demo',
        orgName: '演示机构（mock 模式）',
        brandName: '演示机构服务站',
        miniappPath: 'pages/home/home?orgId=mock_org_demo',
        miniappScene: 'o=mock_org_demo',
        sceneValid: true,
        miniappCodeAvailable: false,
        envVersion: 'trial',
        onlineTerminalCount: 2,
        totalTerminalCount: 3,
      }
    }
    return request<PartnerMiniappEntryInfo>('/partner/miniapp-entry', 'GET')
  },

  async generateCode(): Promise<PartnerMiniappEntryCodeResult> {
    if (API_MODE === 'mock') {
      throw new ApiHttpError('MINIAPP_NOT_CONFIGURED', KNOWN_ERROR_MESSAGES.MINIAPP_NOT_CONFIGURED, 503)
    }
    return request<PartnerMiniappEntryCodeResult>('/partner/miniapp-entry-code', 'POST')
  },
}
