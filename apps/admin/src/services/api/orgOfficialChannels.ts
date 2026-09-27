// ============================================================
// 机构官方域名（入驻核验）与机构官方渠道（3.14），管理员侧。
//
// http（成功套 { success, data }；失败 { success:false, error:{ code, message } }）：
//   GET /admin/orgs/:id/verified-official-domains → { items: VerifiedOfficialDomain[] }
//   PUT /admin/orgs/:id/verified-official-domains  body { domains: string[] }（最多 10 个，整体替换）→ { items }
//   GET /admin/orgs/:id/official-channels          → { items: AdminOrgOfficialChannel[] }
//       ↑ 后端新增端点（110c6461e 还没有）。并入后 AdminOrgOfficialChannel 挪到 packages/shared，这里删掉。
// 单条紧急下架走 recruitmentEmergency.ts（targetType: 'official_channel'）。
//
// 登记官方域名是机构身份核验（依据入驻时的盖章确认函），不是内容审核；渠道内容由机构自己负责。
// 官方渠道不属于招聘内容托管，托管开关开或关，这里的行为都一样。
//
// mock：org-mock-1 登记了两个官方域名、有两条渠道（其中一条已紧急下架）；org-mock-2 没有登记域名、没有渠道。
//   localStorage['mock:org-official-channels'] = 'error' 时读取都失败（只在 mock 下读）。
//   PUT 在 mock 下复刻服务端的拒绝（公共后缀本身、商业招聘网站、格式不对、超过 10 个），
//   否则演示会出现「什么都能登记」的假能力。
// ============================================================

import type { VerifiedOfficialDomain } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, getUser, redirectToLogin } from '../auth'
import { isCommercialRecruitmentHost, OFFICIAL_DOMAIN_MAX, parseDomainInput } from '../../routes/partners/officialDomainRules'

export type { VerifiedOfficialDomain }

/** GET /admin/orgs/:id/official-channels 的单条（后端新增端点，契约见文件头）。 */
export interface AdminOrgOfficialChannel {
  id: string
  name: string
  url: string
  displayOrder: number
  enabled: boolean
  emergencyTakedown: boolean
  emergencyReasonCode: string | null
  emergencyReasonText: string | null
}

export interface OrgOfficialChannelsServiceInterface {
  listVerifiedDomains(orgId: string): Promise<VerifiedOfficialDomain[]>
  replaceVerifiedDomains(orgId: string, domains: string[]): Promise<VerifiedOfficialDomain[]>
  listOfficialChannels(orgId: string): Promise<AdminOrgOfficialChannel[]>
}

export const MOCK_ORG_OFFICIAL_CHANNELS_KEY = 'mock:org-official-channels'

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

async function request(method: 'GET' | 'PUT', path: string, body?: unknown): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请检查网络后重试', 0)
  }
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = `请求失败（${res.status}）`
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } }
      if (data.error?.code) code = data.error.code
      if (data.error?.message) message = data.error.message
    } catch { /* 非 JSON，保留默认值 */ }
    if (res.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', 401)
    }
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<unknown>
}

function unexpected(what: string): never {
  throw new ApiHttpError('UNEXPECTED_RESPONSE', `服务端返回的${what}格式无法识别，请刷新后核对`, 200)
}

/** 服务端套 { success, data }；万一改回裸对象也接得住。取出 items 数组。 */
function itemsOf(body: unknown, what: string): unknown[] {
  const payload = body && typeof body === 'object' && (body as { success?: unknown }).success === true
    ? (body as { data?: unknown }).data
    : body
  const items = payload && typeof payload === 'object' ? (payload as { items?: unknown }).items : undefined
  if (!Array.isArray(items)) unexpected(what)
  return items
}

function asDomain(raw: unknown): VerifiedOfficialDomain {
  const row = (raw ?? {}) as Record<string, unknown>
  if (typeof row.domain !== 'string' || typeof row.verifiedAt !== 'string' || typeof row.verifiedBy !== 'string') {
    unexpected('官方域名')
  }
  return { domain: row.domain, verifiedAt: row.verifiedAt, verifiedBy: row.verifiedBy }
}

function asChannel(raw: unknown): AdminOrgOfficialChannel {
  const row = (raw ?? {}) as Record<string, unknown>
  if (
    typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.url !== 'string'
    || typeof row.displayOrder !== 'number' || typeof row.enabled !== 'boolean'
    || typeof row.emergencyTakedown !== 'boolean'
  ) unexpected('官方渠道')
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    displayOrder: row.displayOrder,
    enabled: row.enabled,
    emergencyTakedown: row.emergencyTakedown,
    emergencyReasonCode: typeof row.emergencyReasonCode === 'string' ? row.emergencyReasonCode : null,
    emergencyReasonText: typeof row.emergencyReasonText === 'string' ? row.emergencyReasonText : null,
  }
}

const httpAdapter: OrgOfficialChannelsServiceInterface = {
  async listVerifiedDomains(orgId) {
    const body = await request('GET', `/admin/orgs/${encodeURIComponent(orgId)}/verified-official-domains`)
    return itemsOf(body, '官方域名').map(asDomain)
  },
  async replaceVerifiedDomains(orgId, domains) {
    const body = await request('PUT', `/admin/orgs/${encodeURIComponent(orgId)}/verified-official-domains`, { domains })
    return itemsOf(body, '官方域名').map(asDomain)
  },
  async listOfficialChannels(orgId) {
    const body = await request('GET', `/admin/orgs/${encodeURIComponent(orgId)}/official-channels`)
    return itemsOf(body, '官方渠道').map(asChannel)
  },
}

// ─── Mock adapter（内存，演示用；刷新页面即还原）──────────────────────────────

const mockDomains = new Map<string, VerifiedOfficialDomain[]>([
  ['org-mock-1', [
    { domain: 'rencai-demo.gov.cn', verifiedAt: '2026-09-20T02:30:00.000Z', verifiedBy: 'mock-admin-001' },
    { domain: 'hrss.demo-city.gov.cn', verifiedAt: '2026-09-21T06:10:00.000Z', verifiedBy: 'mock-admin-002' },
  ]],
])

const mockChannels = new Map<string, AdminOrgOfficialChannel[]>([
  ['org-mock-1', [
    {
      id: 'oc-mock-a1', name: '人才交流中心官网', url: 'https://www.rencai-demo.gov.cn/',
      displayOrder: 1, enabled: true, emergencyTakedown: false, emergencyReasonCode: null, emergencyReasonText: null,
    },
    {
      id: 'oc-mock-a2', name: '线上业务大厅（旧入口）', url: 'https://ywdt.rencai-demo.gov.cn/old',
      displayOrder: 2, enabled: false, emergencyTakedown: true, emergencyReasonCode: 'rights_complaint',
      emergencyReasonText: '页面冒用第三方机构标识，权利人投诉编号 TS-2026-0921',
    },
  ]],
])

/** 公共后缀本身不能登记（服务端按注册域判定；mock 只收常见几个，够演示拒绝路径）。 */
const MOCK_PUBLIC_SUFFIXES = new Set([
  'cn', 'com', 'net', 'org', 'gov.cn', 'edu.cn', 'com.cn', 'net.cn', 'org.cn', 'ac.cn',
  'github.io', 'gitee.io', 'vercel.app', 'netlify.app', 'pages.dev',
])

function mockFailIfRequested(): void {
  let variant: string | null = null
  try {
    variant = window.localStorage.getItem(MOCK_ORG_OFFICIAL_CHANNELS_KEY)
  } catch { /* 读不到按默认演示 */ }
  if (variant === 'error') throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请检查网络后重试', 0)
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const mockAdapter: OrgOfficialChannelsServiceInterface = {
  async listVerifiedDomains(orgId) {
    await delay(120)
    mockFailIfRequested()
    return (mockDomains.get(orgId) ?? []).map((item) => ({ ...item }))
  },
  // 复刻服务端 normalizeVerifiedDomainList：逐个规范化，第一个不合格的整批拒绝；
  // 重复的合并；保留下来的域名沿用原登记时间与登记人，新增的记当前账号与当前时间。
  async replaceVerifiedDomains(orgId, domains) {
    await delay(150)
    mockFailIfRequested()
    if (domains.length > OFFICIAL_DOMAIN_MAX) {
      // 服务端由 DTO 的 @ArrayMaxSize(10) 先拒，回的是英文校验原文 + VALIDATION_FAILED。
      throw new ApiHttpError('VALIDATION_FAILED', 'domains must contain no more than 10 elements', 400)
    }
    const existing = mockDomains.get(orgId) ?? []
    const next: VerifiedOfficialDomain[] = []
    for (const raw of domains) {
      const parsed = parseDomainInput(raw)
      if (parsed.kind !== 'ok' || MOCK_PUBLIC_SUFFIXES.has(parsed.domain) || isCommercialRecruitmentHost(parsed.domain)) {
        throw new ApiHttpError('VERIFIED_DOMAIN_INVALID', `不是可核验的官方注册域：${raw.trim() || '空域名'}`, 400)
      }
      if (next.some((item) => item.domain === parsed.domain)) continue
      next.push(existing.find((item) => item.domain === parsed.domain)
        ?? { domain: parsed.domain, verifiedAt: new Date().toISOString(), verifiedBy: getUser()?.id ?? 'mock-admin-001' })
    }
    mockDomains.set(orgId, next)
    return next.map((item) => ({ ...item }))
  },
  async listOfficialChannels(orgId) {
    await delay(120)
    mockFailIfRequested()
    return (mockChannels.get(orgId) ?? []).map((item) => ({ ...item }))
  },
}

/** 仅 mock：紧急下架演示真的把这条渠道改成已下架（recruitmentEmergency.ts 的 mock 调用）。 */
export function markMockOfficialChannelTakenDown(channelId: string, reasonCode: string, reasonText: string): void {
  for (const [orgId, rows] of mockChannels) {
    if (!rows.some((row) => row.id === channelId)) continue
    mockChannels.set(orgId, rows.map((row) => (row.id === channelId && !row.emergencyTakedown
      ? { ...row, enabled: false, emergencyTakedown: true, emergencyReasonCode: reasonCode, emergencyReasonText: reasonText }
      : row)))
  }
}

export const orgOfficialChannelsService: OrgOfficialChannelsServiceInterface =
  API_MODE === 'http' ? httpAdapter : mockAdapter
