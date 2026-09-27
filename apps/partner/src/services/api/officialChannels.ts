// ============================================================
// 本机构官方渠道（3.14）：机构在「机构资料」页维护自己的官方渠道二维码。
//
// http（成功套 { success, data }；失败 { success:false, error:{ code, message } }）：
//   GET    /partner/official-channels       → { items, verifiedDomains }
//   POST   /partner/official-channels       body { name, url, displayOrder?, enabled? } → item
//   PATCH  /partner/official-channels/:id   body 上面四项的任意子集 → item
//   DELETE /partner/official-channels/:id   → { archived: true }（归档后从列表消失，机构端没有恢复入口）
//   服务端拒绝时 message 是中文原因（https、域名范围、跳转参数、商业招聘网站、已紧急下架……），页面原样展示。
//
// verifiedDomains 是后端新增字段（110c6461e 的列表响应还没有）。后端并入后，
// PartnerOfficialChannelList 挪到 packages/shared 的 OfficialChannelPartnerListResponse，这里删掉。
// 没读到这一项时记为 null（「不知道」），不当成「未登记」。
//
// mock：演示两条渠道，其中一条已被平台紧急下架。localStorage['mock:official-channels'] =
//   'no-domains' | 'empty' | 'error' | 'loading' 切换未登记域名 / 空列表 / 读取失败 / 一直读取中（只在 mock 下读）。
//   mock 复刻服务端的校验与中文原因，否则演示会出现「什么链接都能保存」的假能力。
// ============================================================

import type { OfficialChannelPartnerItem } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'
import {
  canonicalChannelUrl,
  checkChannelUrl,
  OFFICIAL_CHANNEL_NAME_MAX,
} from '../../routes/profile/officialChannelRules'

export type { OfficialChannelPartnerItem }

/** GET /partner/official-channels 的返回。verifiedDomains=null 表示服务端没返回这一项。 */
export interface PartnerOfficialChannelList {
  items: OfficialChannelPartnerItem[]
  verifiedDomains: string[] | null
}

export interface CreateOfficialChannelInput {
  name: string
  url: string
  displayOrder?: number
  enabled?: boolean
}

export type UpdateOfficialChannelInput = Partial<CreateOfficialChannelInput>

export interface PartnerOfficialChannelsService {
  list(): Promise<PartnerOfficialChannelList>
  create(input: CreateOfficialChannelInput): Promise<OfficialChannelPartnerItem>
  update(id: string, input: UpdateOfficialChannelInput): Promise<OfficialChannelPartnerItem>
  archive(id: string): Promise<void>
}

export const MOCK_OFFICIAL_CHANNELS_KEY = 'mock:official-channels'

// ─── 给人看的错误 ──────────────────────────────────────────────────────────────

const CODE_MESSAGES: Readonly<Record<string, string>> = {
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
  VALIDATION_FAILED: '填写内容未通过校验：名称 1 到 40 个字、链接不超过 500 个字符、排序 0 到 999，请检查后重试',
  UNEXPECTED_RESPONSE: '服务端返回的内容无法识别，请刷新后核对',
}

/**
 * 与政策发布弹窗（routes/policy/PolicyReleaseDialog.tsx）同一口径：服务端的中文原因原样给出；
 * 英文技术串（class-validator 原文、statusText、HTTP_400）一律换成码表或兜底句。
 */
export function officialChannelErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiHttpError) {
    if (error.status === 401) return '登录已过期，请重新登录后再试'
    const message = error.message.trim()
    if (message && /[一-鿿]/.test(message)) return message
    if (CODE_MESSAGES[error.code]) return CODE_MESSAGES[error.code]
    if (error.status === 0) return CODE_MESSAGES.NETWORK_ERROR
  }
  return fallback
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

async function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...authHeader(),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', CODE_MESSAGES.NETWORK_ERROR, 0)
  }
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = `请求失败（${res.status}）`
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } }
      if (data.error?.code) code = data.error.code
      if (data.error?.message) message = data.error.message
    } catch { /* 非 JSON，保留默认值 */ }
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<unknown>
}

/** 服务端套 { success, data }；万一改回裸对象也接得住。 */
function payloadOf(body: unknown): unknown {
  if (body && typeof body === 'object' && 'data' in body && (body as { success?: unknown }).success === true) {
    return (body as { data: unknown }).data
  }
  return body
}

function unexpected(): never {
  throw new ApiHttpError('UNEXPECTED_RESPONSE', CODE_MESSAGES.UNEXPECTED_RESPONSE, 200)
}

function asItem(raw: unknown): OfficialChannelPartnerItem {
  if (!raw || typeof raw !== 'object') unexpected()
  const row = raw as Record<string, unknown>
  if (
    typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.url !== 'string'
    || typeof row.displayOrder !== 'number' || typeof row.enabled !== 'boolean'
    || typeof row.emergencyTakedown !== 'boolean'
  ) unexpected()
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    displayOrder: row.displayOrder,
    enabled: row.enabled,
    emergencyTakedown: row.emergencyTakedown,
    emergencyReasonCode: typeof row.emergencyReasonCode === 'string' ? row.emergencyReasonCode : null,
    emergencyReasonText: typeof row.emergencyReasonText === 'string' ? row.emergencyReasonText : null,
    organizationName: typeof row.organizationName === 'string' ? row.organizationName : '',
  }
}

const httpAdapter: PartnerOfficialChannelsService = {
  async list() {
    const data = payloadOf(await request('GET', '/partner/official-channels')) as
      { items?: unknown; verifiedDomains?: unknown } | null
    if (!data || !Array.isArray(data.items)) unexpected()
    const domains = Array.isArray(data.verifiedDomains) && data.verifiedDomains.every((d) => typeof d === 'string')
      ? (data.verifiedDomains as string[])
      : null
    return { items: data.items.map(asItem), verifiedDomains: domains }
  },
  async create(input) {
    return asItem(payloadOf(await request('POST', '/partner/official-channels', input)))
  },
  async update(id, input) {
    return asItem(payloadOf(await request('PATCH', `/partner/official-channels/${encodeURIComponent(id)}`, input)))
  },
  async archive(id) {
    const data = payloadOf(await request('DELETE', `/partner/official-channels/${encodeURIComponent(id)}`)) as
      { archived?: unknown } | null
    if (!data || data.archived !== true) unexpected()
  },
}

// ─── Mock adapter（内存，演示用；刷新页面即还原）──────────────────────────────

const MOCK_ORG_NAME = '演示机构（mock 模式）'
const MOCK_DOMAINS = ['demo-university.edu.cn', 'career-demo.cn']

let mockSeq = 10
let mockRows: OfficialChannelPartnerItem[] = [
  {
    id: 'oc-mock-1', name: '学校就业信息网', url: 'https://career.demo-university.edu.cn/',
    displayOrder: 1, enabled: true, emergencyTakedown: false,
    emergencyReasonCode: null, emergencyReasonText: null, organizationName: MOCK_ORG_NAME,
  },
  {
    id: 'oc-mock-2', name: '就业指导中心旧版网站', url: 'https://jyzx.demo-university.edu.cn/notice',
    displayOrder: 2, enabled: false, emergencyTakedown: true,
    emergencyReasonCode: 'false_information',
    emergencyReasonText: '页面上的招聘会时间与主办方公告不一致，投诉编号 TS-2026-0927',
    organizationName: MOCK_ORG_NAME,
  },
]

function mockVariant(): string | null {
  try {
    return window.localStorage.getItem(MOCK_OFFICIAL_CHANNELS_KEY)
  } catch {
    return null
  }
}

function mockDomains(): string[] {
  return mockVariant() === 'no-domains' ? [] : [...MOCK_DOMAINS]
}

/** 与服务端 cleanName / cleanUrl 同样的判定顺序与中文原因。 */
function mockClean(input: { name?: string; url?: string }): { name?: string; url?: string } {
  const out: { name?: string; url?: string } = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name || name.length > OFFICIAL_CHANNEL_NAME_MAX) {
      throw new ApiHttpError('OFFICIAL_CHANNEL_NAME_INVALID', '渠道名称需要 1 到 40 个字', 400)
    }
    out.name = name
  }
  if (input.url !== undefined) {
    const hint = checkChannelUrl(input.url, mockDomains())
    if (hint.kind === 'empty' || hint.kind === 'not_url' || hint.kind === 'not_https' || hint.kind === 'credentials_or_port') {
      throw new ApiHttpError('OFFICIAL_CHANNEL_URL_INVALID', '链接必须是不带账号的 https 地址', 400)
    }
    if (hint.kind === 'commercial') {
      throw new ApiHttpError('OFFICIAL_CHANNEL_COMMERCIAL_HOST_BLOCKED', '不能把商业招聘网站保存为本机构官方渠道', 400)
    }
    if (hint.kind !== 'ok') {
      throw new ApiHttpError('OFFICIAL_CHANNEL_DOMAIN_NOT_VERIFIED', '链接或跳转目标不在该机构已核验的官方域名内', 400)
    }
    out.url = hint.canonical
  }
  return out
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const mockAdapter: PartnerOfficialChannelsService = {
  async list() {
    const variant = mockVariant()
    if (variant === 'loading') await delay(30_000)
    await delay(120)
    if (variant === 'error') throw new ApiHttpError('NETWORK_ERROR', CODE_MESSAGES.NETWORK_ERROR, 0)
    if (variant === 'no-domains' || variant === 'empty') return { items: [], verifiedDomains: mockDomains() }
    return { items: mockRows.map((row) => ({ ...row })), verifiedDomains: mockDomains() }
  },
  async create(input) {
    await delay(150)
    const clean = mockClean({ name: input.name, url: input.url })
    const row: OfficialChannelPartnerItem = {
      id: `oc-mock-${++mockSeq}`,
      name: clean.name!,
      url: clean.url!,
      displayOrder: input.displayOrder ?? 0,
      enabled: input.enabled ?? true,
      emergencyTakedown: false,
      emergencyReasonCode: null,
      emergencyReasonText: null,
      organizationName: MOCK_ORG_NAME,
    }
    mockRows = [...mockRows, row].sort((a, b) => a.displayOrder - b.displayOrder)
    return { ...row }
  },
  async update(id, input) {
    await delay(150)
    const row = mockRows.find((item) => item.id === id)
    if (!row) throw new ApiHttpError('OFFICIAL_CHANNEL_NOT_FOUND', '官方渠道不存在', 404)
    if (Object.values(input).every((value) => value === undefined)) {
      throw new ApiHttpError('OFFICIAL_CHANNEL_EMPTY_UPDATE', '没有可更新的字段', 400)
    }
    const enabled = input.enabled ?? row.enabled
    // 已紧急下架的渠道冻结：机构只能归档。启用被拒的原因与服务端同一句；
    // 改名、改链接在 110c6461e 的服务端其实还能成功（见 3.14 协调记录），这里按冻结口径拒绝。
    if (row.emergencyTakedown) {
      throw new ApiHttpError(
        'EMERGENCY_TAKEDOWN_IRREVERSIBLE',
        enabled ? '该渠道已紧急下架，不能恢复启用' : '该渠道已紧急下架，只能归档，不能修改',
        403,
      )
    }
    const urlChanged = input.url !== undefined && canonicalChannelUrl(input.url) !== row.url
    const clean = mockClean({ name: input.name, url: urlChanged ? input.url : undefined })
    // 与服务端一致：重新启用会按当前登记的域名重验旧链接。
    if (enabled && !row.enabled && !urlChanged) mockClean({ url: row.url })
    const next: OfficialChannelPartnerItem = {
      ...row,
      name: clean.name ?? row.name,
      url: clean.url ?? row.url,
      displayOrder: input.displayOrder ?? row.displayOrder,
      enabled,
    }
    mockRows = mockRows.map((item) => (item.id === id ? next : item)).sort((a, b) => a.displayOrder - b.displayOrder)
    return { ...next }
  },
  async archive(id) {
    await delay(150)
    if (!mockRows.some((item) => item.id === id)) {
      throw new ApiHttpError('OFFICIAL_CHANNEL_NOT_FOUND', '官方渠道不存在', 404)
    }
    mockRows = mockRows.filter((item) => item.id !== id)
  },
}

export const partnerOfficialChannelsService: PartnerOfficialChannelsService =
  API_MODE === 'http' ? httpAdapter : mockAdapter
