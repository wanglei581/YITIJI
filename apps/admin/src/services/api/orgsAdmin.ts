// ============================================================
// Admin 合作机构管理 Service(阶段1B)
//
// API_MODE=http → 真实后端 /admin/orgs/*
// API_MODE=mock → 内存 mock(无后端也能走通 UI,数据明示为演示数据)
//
// 合规:机构 = 外部数据来源方/运营协作方;不含企业招聘端概念。
// 账号密码只在创建/重置时单向提交,任何读取接口不回显。
// ============================================================

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

// ─── 类型(契约 = services/api AdminOrgsService 返回形状)───────────────────

export interface AdminOrgAccount {
  id: string
  username: string
  name: string
  enabled: boolean
  phoneMasked: string | null
  phoneVerifiedAt: string | null
  availableActionVerificationMethods: PartnerAccountVerificationMethod[]
  createdAt: string
}

export type PartnerAccountAction = 'delete_account' | 'rebind_phone'
export type PartnerAccountVerificationMethod = 'sms' | 'password'

export interface CreatePartnerAccountActionChallengeInput {
  action: PartnerAccountAction
  verifyMethod: PartnerAccountVerificationMethod
  adminCurrentPassword?: string
}

export interface PartnerAccountActionChallengeResponse {
  challengeId: string
  action: PartnerAccountAction
  verifyMethod: PartnerAccountVerificationMethod
  phoneMasked?: string
  availableMethods: PartnerAccountVerificationMethod[]
  expiresInSeconds: number
  cooldownSeconds: number
}

export interface PartnerAccountActionTicketResponse {
  actionTicket: string
  expiresInSeconds: number
}

export interface PhoneRebindResponse {
  rebindTicket: string
  phoneMasked: string
  expiresInSeconds: number
  cooldownSeconds: number
}

export interface PhoneRebindResendResponse {
  phoneMasked: string
  expiresInSeconds: number
  cooldownSeconds: number
}

export interface AdminOrgListItem {
  id: string
  name: string
  type: string
  contact: string | null
  contactPhone: string | null
  sceneTemplate: string | null
  enabledModules: string[]
  enabled: boolean
  createdAt: string
  updatedAt: string
  counts: { accounts: number; sources: number; jobs: number; fairs: number }
}

export interface AdminOrgDetail extends AdminOrgListItem {
  accounts: AdminOrgAccount[]
}

export interface OrgAccountInput {
  username: string
  password: string
  name: string
  phone: string
}

export interface CreateOrgInput {
  name: string
  type: string
  contact?: string
  contactPhone?: string
  sceneTemplate?: string
  enabledModules?: string[]
  account?: OrgAccountInput
}

export interface UpdateOrgInput {
  name?: string
  type?: string
  contact?: string
  contactPhone?: string
  sceneTemplate?: string
  enabledModules?: string[]
}

export interface OrgsAdminServiceInterface {
  listOrgs(): Promise<AdminOrgListItem[]>
  getOrgDetail(orgId: string): Promise<AdminOrgDetail>
  createOrg(input: CreateOrgInput): Promise<AdminOrgDetail>
  updateOrg(orgId: string, input: UpdateOrgInput): Promise<AdminOrgDetail>
  setOrgStatus(orgId: string, action: 'enable' | 'disable'): Promise<AdminOrgDetail>
  createAccount(orgId: string, input: OrgAccountInput): Promise<AdminOrgAccount>
  setAccountStatus(orgId: string, accountId: string, action: 'enable' | 'disable'): Promise<AdminOrgAccount>
  resetAccountPassword(orgId: string, accountId: string, password: string): Promise<void>
  createActionChallenge(
    orgId: string,
    accountId: string,
    input: CreatePartnerAccountActionChallengeInput,
    signal?: AbortSignal,
  ): Promise<PartnerAccountActionChallengeResponse>
  verifyActionChallenge(
    orgId: string,
    accountId: string,
    challengeId: string,
    credential: { code: string } | { currentPassword: string },
    signal?: AbortSignal,
  ): Promise<PartnerAccountActionTicketResponse>
  cancelActionChallenge(orgId: string, accountId: string, challengeId: string): Promise<void>
  revokeActionTicket(orgId: string, accountId: string, actionTicket: string): Promise<void>
  deleteAccount(orgId: string, accountId: string, actionTicket: string, signal?: AbortSignal): Promise<void>
  startPhoneRebind(
    orgId: string,
    accountId: string,
    actionTicket: string,
    newPhone: string,
    signal?: AbortSignal,
  ): Promise<PhoneRebindResponse>
  resendNewPhoneCode(
    orgId: string,
    accountId: string,
    rebindTicket: string,
    signal?: AbortSignal,
  ): Promise<PhoneRebindResendResponse>
  verifyPhoneRebind(
    orgId: string,
    accountId: string,
    rebindTicket: string,
    code: string,
    signal?: AbortSignal,
  ): Promise<void>
  revokePhoneRebindTicket(orgId: string, accountId: string, rebindTicket: string): Promise<void>
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

function handleAuthFailure(status: number, code: string): void {
  if (status === 401) {
    redirectToLogin()
    throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', status)
  }
}

async function parseError(res: Response): Promise<never> {
  let code = `HTTP_${res.status}`
  let message = res.statusText
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string }; message?: string | string[] }
    if (body.error?.code) code = body.error.code
    if (body.error?.message) message = body.error.message
    else if (typeof body.message === 'string') message = body.message
    else if (Array.isArray(body.message) && body.message.length > 0) message = body.message.join('；')
  } catch {
    /* keep defaults */
  }
  handleAuthFailure(res.status, code)
  throw new ApiHttpError(code, message, res.status)
}

async function req<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  for (const [key, value] of Object.entries(authHeader())) headers.set(key, value)
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    method,
    headers,
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) await parseError(res)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const httpAdapter: OrgsAdminServiceInterface = {
  listOrgs: () => req<AdminOrgListItem[]>('GET', '/admin/orgs'),
  getOrgDetail: (orgId) => req<AdminOrgDetail>('GET', `/admin/orgs/${orgId}`),
  createOrg: (input) => req<AdminOrgDetail>('POST', '/admin/orgs', input),
  updateOrg: (orgId, input) => req<AdminOrgDetail>('PATCH', `/admin/orgs/${orgId}`, input),
  setOrgStatus: (orgId, action) => req<AdminOrgDetail>('PATCH', `/admin/orgs/${orgId}/status`, { action }),
  createAccount: (orgId, input) => req<AdminOrgAccount>('POST', `/admin/orgs/${orgId}/accounts`, input),
  setAccountStatus: (orgId, accountId, action) =>
    req<AdminOrgAccount>('PATCH', `/admin/orgs/${orgId}/accounts/${accountId}/status`, { action }),
  resetAccountPassword: async (orgId, accountId, password) => {
    await req<{ success: boolean }>('PATCH', `/admin/orgs/${orgId}/accounts/${accountId}/password`, { password })
  },
  createActionChallenge: (orgId, accountId, input, signal) =>
    req<PartnerAccountActionChallengeResponse>(
      'POST',
      `/admin/orgs/${orgId}/accounts/${accountId}/action-challenges`,
      input,
      { signal },
    ),
  verifyActionChallenge: (orgId, accountId, challengeId, credential, signal) =>
    req<PartnerAccountActionTicketResponse>(
      'POST',
      `/admin/orgs/${orgId}/accounts/${accountId}/action-challenges/${challengeId}/verify`,
      credential,
      { signal },
    ),
  cancelActionChallenge: async (orgId, accountId, challengeId) => {
    await req<void>('DELETE', `/admin/orgs/${orgId}/accounts/${accountId}/action-challenges/${challengeId}`)
  },
  revokeActionTicket: async (orgId, accountId, actionTicket) => {
    await req<void>('DELETE', `/admin/orgs/${orgId}/accounts/${accountId}/action-tickets/current`, undefined, {
      headers: { 'X-Account-Action-Ticket': actionTicket },
    })
  },
  deleteAccount: async (orgId, accountId, actionTicket, signal) => {
    await req<{ success: true }>('DELETE', `/admin/orgs/${orgId}/accounts/${accountId}`, undefined, {
      headers: { 'X-Account-Action-Ticket': actionTicket },
      signal,
    })
  },
  startPhoneRebind: (orgId, accountId, actionTicket, newPhone, signal) =>
    req<PhoneRebindResponse>(
      'POST',
      `/admin/orgs/${orgId}/accounts/${accountId}/phone-rebind/start`,
      { newPhone },
      { headers: { 'X-Account-Action-Ticket': actionTicket }, signal },
    ),
  resendNewPhoneCode: (orgId, accountId, rebindTicket, signal) =>
    req<PhoneRebindResendResponse>(
      'POST',
      `/admin/orgs/${orgId}/accounts/${accountId}/phone-rebind/resend-new`,
      undefined,
      { headers: { 'X-Phone-Rebind-Ticket': rebindTicket }, signal },
    ),
  verifyPhoneRebind: async (orgId, accountId, rebindTicket, code, signal) => {
    await req<{ success: true }>(
      'POST',
      `/admin/orgs/${orgId}/accounts/${accountId}/phone-rebind/verify`,
      { code },
      { headers: { 'X-Phone-Rebind-Ticket': rebindTicket }, signal },
    )
  },
  revokePhoneRebindTicket: async (orgId, accountId, rebindTicket) => {
    await req<void>('DELETE', `/admin/orgs/${orgId}/accounts/${accountId}/phone-rebind/current`, undefined, {
      headers: { 'X-Phone-Rebind-Ticket': rebindTicket },
    })
  },
}

// ─── Mock adapter(内存可变,演示用)─────────────────────────────────────────

const now = () => new Date().toISOString()
let seq = 100
const nextId = (p: string) => `${p}-mock-${++seq}`

let mockAccounts: (AdminOrgAccount & { orgId: string })[] = [
  {
    id: 'acc-mock-1',
    orgId: 'org-mock-1',
    username: 'hr_center',
    name: '李老师',
    enabled: true,
    phoneMasked: '139****0001',
    phoneVerifiedAt: now(),
    availableActionVerificationMethods: ['sms', 'password'],
    createdAt: now(),
  },
]

// 仅供本地演示：用模块内存模拟“目标 + action 绑定、单次消费”的票据语义，
// 不代表真实密码/OTP 安全强度；HTTP 模式的安全性完全由服务端实现。
type MockActionBinding = { orgId: string; accountId: string; action: PartnerAccountAction }
const mockChallenges = new Map<string, MockActionBinding & { verifyMethod: PartnerAccountVerificationMethod }>()
const mockActionTickets = new Map<string, MockActionBinding>()
const mockRebindTickets = new Map<string, MockActionBinding & { newPhone: string }>()

const mockOrgs: Omit<AdminOrgListItem, 'counts'>[] = [
  {
    id: 'org-mock-1', name: '市人才交流中心(演示)', type: 'public_employment_service',
    contact: '李老师', contactPhone: '0532-00000000', sceneTemplate: 'public_employment',
    enabledModules: ['print_scan', 'policy_service', 'job_info', 'job_fair', 'external_apply_redirect'],
    enabled: true, createdAt: now(), updatedAt: now(),
  },
  {
    id: 'org-mock-2', name: '某大学就业指导中心(演示)', type: 'school_employment_center',
    contact: '王老师', contactPhone: null, sceneTemplate: 'school',
    enabledModules: ['resume_service', 'print_scan', 'job_info', 'job_fair', 'smart_campus'],
    enabled: false, createdAt: now(), updatedAt: now(),
  },
]

function mockCounts(orgId: string) {
  return { accounts: mockAccounts.filter((a) => a.orgId === orgId).length, sources: 0, jobs: 0, fairs: 0 }
}

const mockAdapter: OrgsAdminServiceInterface = {
  async listOrgs() {
    return mockOrgs.map((o) => ({ ...o, counts: mockCounts(o.id) }))
  },
  async getOrgDetail(orgId) {
    const org = mockOrgs.find((o) => o.id === orgId)
    if (!org) throw new ApiHttpError('ORG_NOT_FOUND', '机构不存在', 404)
    return { ...org, counts: mockCounts(orgId), accounts: mockAccounts.filter((a) => a.orgId === orgId) }
  },
  async createOrg(input) {
    const org: Omit<AdminOrgListItem, 'counts'> = {
      id: nextId('org'), name: input.name, type: input.type,
      contact: input.contact ?? null, contactPhone: input.contactPhone ?? null,
      sceneTemplate: input.sceneTemplate ?? null, enabledModules: input.enabledModules ?? [],
      enabled: true, createdAt: now(), updatedAt: now(),
    }
    mockOrgs.unshift(org)
    if (input.account) {
      mockAccounts.push({
        id: nextId('acc'),
        orgId: org.id,
        username: input.account.username,
        name: input.account.name,
        enabled: true,
        phoneMasked: `${input.account.phone.slice(0, 3)}****${input.account.phone.slice(7)}`,
        phoneVerifiedAt: null,
        availableActionVerificationMethods: [],
        createdAt: now(),
      })
    }
    return this.getOrgDetail(org.id)
  },
  async updateOrg(orgId, input) {
    const org = mockOrgs.find((o) => o.id === orgId)
    if (!org) throw new ApiHttpError('ORG_NOT_FOUND', '机构不存在', 404)
    Object.assign(org, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)), { updatedAt: now() })
    return this.getOrgDetail(orgId)
  },
  async setOrgStatus(orgId, action) {
    const org = mockOrgs.find((o) => o.id === orgId)
    if (!org) throw new ApiHttpError('ORG_NOT_FOUND', '机构不存在', 404)
    org.enabled = action === 'enable'
    org.updatedAt = now()
    return this.getOrgDetail(orgId)
  },
  async createAccount(orgId, input) {
    if (mockAccounts.some((a) => a.username === input.username)) {
      throw new ApiHttpError('USERNAME_TAKEN', `用户名 ${input.username} 已存在`, 409)
    }
    const account = {
      id: nextId('acc'),
      orgId,
      username: input.username,
      name: input.name,
      enabled: true,
      phoneMasked: `${input.phone.slice(0, 3)}****${input.phone.slice(7)}`,
      phoneVerifiedAt: null,
      availableActionVerificationMethods: [],
      createdAt: now(),
    }
    mockAccounts.push(account)
    return account
  },
  async setAccountStatus(orgId, accountId, action) {
    const account = mockAccounts.find((a) => a.id === accountId && a.orgId === orgId)
    if (!account) throw new ApiHttpError('ACCOUNT_NOT_FOUND', '账号不存在', 404)
    account.enabled = action === 'enable'
    return account
  },
  async resetAccountPassword(orgId, accountId) {
    const account = mockAccounts.find((a) => a.id === accountId && a.orgId === orgId)
    if (!account) throw new ApiHttpError('ACCOUNT_NOT_FOUND', '账号不存在', 404)
    account.availableActionVerificationMethods = account.phoneVerifiedAt ? ['sms'] : []
  },
  async createActionChallenge(orgId, accountId, input) {
    const account = mockAccounts.find((item) => item.id === accountId && item.orgId === orgId)
    if (!account) throw new ApiHttpError('ACCOUNT_NOT_FOUND', '账号不存在', 404)
    if (!account.availableActionVerificationMethods.includes(input.verifyMethod)) {
      throw new ApiHttpError('ACCOUNT_ACTION_METHOD_UNAVAILABLE', '当前验证方式不可用', 422)
    }
    const challengeId = nextId('challenge')
    mockChallenges.set(challengeId, { orgId, accountId, action: input.action, verifyMethod: input.verifyMethod })
    return {
      challengeId,
      action: input.action,
      verifyMethod: input.verifyMethod,
      ...(input.verifyMethod === 'sms' && account.phoneMasked ? { phoneMasked: account.phoneMasked } : {}),
      availableMethods: [...account.availableActionVerificationMethods],
      expiresInSeconds: 300,
      cooldownSeconds: input.verifyMethod === 'sms' ? 60 : 0,
    }
  },
  async verifyActionChallenge(orgId, accountId, challengeId, credential) {
    const challenge = mockChallenges.get(challengeId)
    if (!challenge || challenge.orgId !== orgId || challenge.accountId !== accountId) {
      throw new ApiHttpError('ACCOUNT_ACTION_CHALLENGE_UNAVAILABLE', '验证已失效，请重新开始', 409)
    }
    const valid = challenge.verifyMethod === 'sms'
      ? 'code' in credential && /^\d{6}$/.test(credential.code)
      : 'currentPassword' in credential && credential.currentPassword.length >= 8
    if (!valid) throw new ApiHttpError('ACCOUNT_CREDENTIAL_INVALID', '验证信息不正确', 422)
    mockChallenges.delete(challengeId)
    const actionTicket = nextId('action-ticket')
    mockActionTickets.set(actionTicket, {
      orgId: challenge.orgId,
      accountId: challenge.accountId,
      action: challenge.action,
    })
    return { actionTicket, expiresInSeconds: 90 }
  },
  async cancelActionChallenge(orgId, accountId, challengeId) {
    const challenge = mockChallenges.get(challengeId)
    if (challenge?.orgId === orgId && challenge.accountId === accountId) mockChallenges.delete(challengeId)
  },
  async revokeActionTicket(orgId, accountId, actionTicket) {
    const ticket = mockActionTickets.get(actionTicket)
    if (ticket?.orgId === orgId && ticket.accountId === accountId) mockActionTickets.delete(actionTicket)
  },
  async deleteAccount(orgId, accountId, actionTicket) {
    const account = mockAccounts.find((item) => item.id === accountId && item.orgId === orgId)
    if (!account) throw new ApiHttpError('ACCOUNT_NOT_FOUND', '账号不存在', 404)
    const ticket = mockActionTickets.get(actionTicket)
    if (!ticket || ticket.orgId !== orgId || ticket.accountId !== accountId || ticket.action !== 'delete_account') {
      throw new ApiHttpError('ACCOUNT_ACTION_STEP_UP_REQUIRED', '请先完成账号安全验证', 403)
    }
    mockActionTickets.delete(actionTicket)
    const activeCount = mockAccounts.filter((item) => item.orgId === orgId && item.enabled).length
    if (activeCount - (account.enabled ? 1 : 0) < 1) {
      throw new ApiHttpError(
        'LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED',
        '请先新增并启用接替账号，再移除此账号',
        409,
      )
    }
    mockAccounts = mockAccounts.filter((item) => item.id !== accountId)
  },
  async startPhoneRebind(orgId, accountId, actionTicket, newPhone) {
    const ticket = mockActionTickets.get(actionTicket)
    if (!ticket || ticket.orgId !== orgId || ticket.accountId !== accountId || ticket.action !== 'rebind_phone') {
      throw new ApiHttpError('ACCOUNT_ACTION_TICKET_STALE', '授权已失效，请重新验证', 409)
    }
    if (!/^1[3-9]\d{9}$/.test(newPhone)) throw new ApiHttpError('VALIDATION_ERROR', '请输入有效手机号', 400)
    mockActionTickets.delete(actionTicket)
    const rebindTicket = nextId('rebind-ticket')
    mockRebindTickets.set(rebindTicket, { orgId, accountId, action: 'rebind_phone', newPhone })
    return {
      rebindTicket,
      phoneMasked: `${newPhone.slice(0, 3)}****${newPhone.slice(7)}`,
      expiresInSeconds: 300,
      cooldownSeconds: 60,
    }
  },
  async resendNewPhoneCode(orgId, accountId, rebindTicket) {
    const ticket = mockRebindTickets.get(rebindTicket)
    if (!ticket || ticket.orgId !== orgId || ticket.accountId !== accountId) {
      throw new ApiHttpError('ACCOUNT_ACTION_TICKET_STALE', '换绑验证已失效', 409)
    }
    return {
      phoneMasked: `${ticket.newPhone.slice(0, 3)}****${ticket.newPhone.slice(7)}`,
      expiresInSeconds: 300,
      cooldownSeconds: 60,
    }
  },
  async verifyPhoneRebind(orgId, accountId, rebindTicket, code) {
    const ticket = mockRebindTickets.get(rebindTicket)
    if (!ticket || ticket.orgId !== orgId || ticket.accountId !== accountId) {
      throw new ApiHttpError('ACCOUNT_ACTION_TICKET_STALE', '换绑验证已失效', 409)
    }
    if (!/^\d{6}$/.test(code)) throw new ApiHttpError('ACCOUNT_CREDENTIAL_INVALID', '验证码不正确', 422)
    mockRebindTickets.delete(rebindTicket)
    mockAccounts = mockAccounts.map((account) => account.id === accountId && account.orgId === orgId
      ? {
          ...account,
          phoneMasked: `${ticket.newPhone.slice(0, 3)}****${ticket.newPhone.slice(7)}`,
          phoneVerifiedAt: now(),
          availableActionVerificationMethods: ['sms', 'password'],
        }
      : account)
  },
  async revokePhoneRebindTicket(orgId, accountId, rebindTicket) {
    const ticket = mockRebindTickets.get(rebindTicket)
    if (ticket?.orgId === orgId && ticket.accountId === accountId) mockRebindTickets.delete(rebindTicket)
  },
}

// ─── Facade ───────────────────────────────────────────────────────────────────

export const orgsAdminService: OrgsAdminServiceInterface = API_MODE === 'http' ? httpAdapter : mockAdapter
