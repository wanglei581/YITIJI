import {
  BUILTIN_TOOLBOX_MICRO_APPS,
  type KioskToolboxItem,
  type SaveToolboxConfigInput,
  type TerminalToolboxConfigView,
  type ToolboxAdminAppView,
  type ToolboxAllowedHostPurpose,
  type ToolboxAllowedHostRecord,
  type ToolboxAllowedHostStatus,
  type ToolboxAppVersion,
  type ToolboxGovernanceResult,
  type ToolboxLaunchSummary,
  type ToolboxMicroAppCategory,
  type ToolboxMicroAppDefinition,
  type ToolboxMicroAppPriority,
  type ToolboxMicroAppRiskLevel,
  type ToolboxTerminalView,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type {
  KioskToolboxItem,
  SaveToolboxConfigInput,
  TerminalToolboxConfigView,
  ToolboxAdminAppView,
  ToolboxAllowedHostRecord,
  ToolboxAllowedHostStatus,
  ToolboxAppVersion,
  ToolboxGovernanceResult,
  ToolboxLaunchSummary,
  ToolboxMicroAppDefinition,
  ToolboxTerminalView,
}

export interface CreateToolboxAppInput {
  appKey: string
  title: string
  shortDescription: string
  category: ToolboxMicroAppCategory
  priority: ToolboxMicroAppPriority
  riskLevel: ToolboxMicroAppRiskLevel
}

export interface UpsertToolboxAllowedHostInput {
  host: string
  purpose: ToolboxAllowedHostPurpose
  owner: string
  reason: string
  expiresAt?: string
}

export interface ReviewToolboxAllowedHostInput {
  status: Exclude<ToolboxAllowedHostStatus, 'pending_review'>
  reason?: string
  expiresAt?: string
}

export interface ToolboxAdminServiceInterface {
  listTerminals(): Promise<ToolboxTerminalView[]>
  getLaunchSummary(params?: { days?: number; terminalId?: string | null }): Promise<ToolboxLaunchSummary>
  saveConfig(terminalId: string, input: SaveToolboxConfigInput): Promise<TerminalToolboxConfigView>
  listApps(): Promise<ToolboxAdminAppView[]>
  listVersions(appKey: string): Promise<ToolboxAppVersion[]>
  listAllowedHosts(): Promise<ToolboxAllowedHostRecord[]>
  createApp(input: CreateToolboxAppInput): Promise<ToolboxGovernanceResult>
  createVersion(appKey: string, snapshot: Record<string, unknown>): Promise<ToolboxGovernanceResult>
  submitVersion(appKey: string, version: number): Promise<ToolboxGovernanceResult>
  approveVersion(appKey: string, version: number): Promise<ToolboxGovernanceResult>
  rejectVersion(appKey: string, version: number, reason: string): Promise<ToolboxGovernanceResult>
  publishVersion(appKey: string, version: number, terminalIds?: string[]): Promise<ToolboxGovernanceResult>
  suspendApp(appKey: string): Promise<ToolboxGovernanceResult>
  upsertAllowedHost(input: UpsertToolboxAllowedHostInput): Promise<ToolboxAllowedHostRecord>
  reviewAllowedHost(hostId: string, input: ReviewToolboxAllowedHostInput): Promise<ToolboxAllowedHostRecord>
}

async function parseError(res: Response): Promise<never> {
  let code = `HTTP_${res.status}`
  let message = res.statusText
  let reason: string | undefined
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; reason?: string } }
    if (body.error?.code) code = body.error.code
    if (body.error?.message) message = body.error.message
    if (body.error?.reason) reason = body.error.reason
  } catch {
    /* keep defaults */
  }
  if (res.status === 401) {
    redirectToLogin()
    throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', res.status, reason)
  }
  throw new ApiHttpError(code, message, res.status, reason)
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<T>
}

const httpAdapter: ToolboxAdminServiceInterface = {
  listTerminals: () => req<ToolboxTerminalView[]>('GET', '/admin/toolbox/terminals'),
  getLaunchSummary: (params) => {
    const query = new URLSearchParams()
    if (params?.days) query.set('days', String(params.days))
    if (params?.terminalId) query.set('terminalId', params.terminalId)
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return req<ToolboxLaunchSummary>('GET', `/admin/toolbox/launch-summary${suffix}`)
  },
  saveConfig: (terminalId, input) =>
    req<TerminalToolboxConfigView>('PUT', `/admin/terminals/${terminalId}/toolbox-config`, input),
  listApps: () => req<ToolboxAdminAppView[]>('GET', '/admin/toolbox/apps'),
  listVersions: (appKey) => req<ToolboxAppVersion[]>('GET', `/admin/toolbox/apps/${encodeURIComponent(appKey)}/versions`),
  listAllowedHosts: () => req<ToolboxAllowedHostRecord[]>('GET', '/admin/toolbox/allowed-hosts'),
  createApp: (input) => req<ToolboxGovernanceResult>('POST', '/admin/toolbox/apps', input),
  createVersion: (appKey, snapshot) =>
    req<ToolboxGovernanceResult>('POST', `/admin/toolbox/apps/${encodeURIComponent(appKey)}/versions`, { snapshot }),
  submitVersion: (appKey, version) =>
    req<ToolboxGovernanceResult>('POST', `/admin/toolbox/apps/${encodeURIComponent(appKey)}/versions/${version}/submit`),
  approveVersion: (appKey, version) =>
    req<ToolboxGovernanceResult>('POST', `/admin/toolbox/apps/${encodeURIComponent(appKey)}/versions/${version}/approve`),
  rejectVersion: (appKey, version, reason) =>
    req<ToolboxGovernanceResult>('POST', `/admin/toolbox/apps/${encodeURIComponent(appKey)}/versions/${version}/reject`, { reason }),
  publishVersion: (appKey, version, terminalIds) =>
    req<ToolboxGovernanceResult>('POST', `/admin/toolbox/apps/${encodeURIComponent(appKey)}/versions/${version}/publish`, { terminalIds }),
  suspendApp: (appKey) =>
    req<ToolboxGovernanceResult>('POST', `/admin/toolbox/apps/${encodeURIComponent(appKey)}/suspend`),
  upsertAllowedHost: (input) => req<ToolboxAllowedHostRecord>('POST', '/admin/toolbox/allowed-hosts', input),
  reviewAllowedHost: (hostId, input) =>
    req<ToolboxAllowedHostRecord>('POST', `/admin/toolbox/allowed-hosts/${encodeURIComponent(hostId)}/review`, input),
}

const mockTerminals: ToolboxTerminalView[] = [
  { terminalId: 'KSK-001', terminalCode: 'KSK-001', isOnline: true, config: null },
  { terminalId: 'KIOSK-DEMO-01', terminalCode: 'KIOSK-DEMO-01', isOnline: false, config: null },
]

let mockApps: ToolboxAdminAppView[] = BUILTIN_TOOLBOX_MICRO_APPS.slice(0, 5).map((app, index) => ({
  id: `mock-app-${index + 1}`,
  appKey: app.id,
  title: app.title,
  category: app.category,
  priority: app.priority,
  status: app.status,
  riskLevel: app.riskLevel,
  createdBy: 'mock-admin',
  updatedBy: 'mock-admin',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  versionCount: 0,
  latestVersion: null,
  latestVersionStatus: null,
}))

let mockVersions: ToolboxAppVersion[] = []
let mockHosts: ToolboxAllowedHostRecord[] = [
  {
    id: 'mock-host-1',
    host: 'trusted.example.com',
    purpose: 'web_app',
    status: 'active',
    owner: 'platform',
    reason: '开发演示域名',
    createdBy: 'mock-admin',
    reviewedBy: 'mock-reviewer',
    reviewedAt: new Date(0).toISOString(),
    expiresAt: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
]

function updateMockApp(appKey: string, patch: Partial<ToolboxAdminAppView>): void {
  mockApps = mockApps.map((app) => app.appKey === appKey ? { ...app, ...patch, updatedAt: new Date().toISOString() } : app)
}

function appOrThrow(appKey: string): ToolboxAdminAppView {
  const app = mockApps.find((item) => item.appKey === appKey)
  if (!app) throw new ApiHttpError('TOOLBOX_APP_NOT_FOUND', '百宝箱微应用不存在', 404)
  return app
}

const mockAdapter: ToolboxAdminServiceInterface = {
  async listTerminals() {
    return mockTerminals
  },
  async getLaunchSummary(params) {
    const now = new Date()
    const days = params?.days ?? 7
    return {
      days,
      terminalId: params?.terminalId ?? null,
      from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString(),
      to: now.toISOString(),
      totalCount: 0,
      qrShownCount: 0,
      externalNoticeCount: 0,
      externalConfirmedCount: 0,
      externalCancelledCount: 0,
      byAction: {
        show_qr: 0,
        open_external_notice: 0,
        open_external_confirmed: 0,
        cancel_external: 0,
      },
      topItems: [],
    }
  },
  async saveConfig(terminalId, input) {
    const items: KioskToolboxItem[] = input.items.map((item, index) => ({
      key: item.key || `tool-${index + 1}`,
      title: item.title,
      description: item.description,
      icon: item.icon || 'wrench',
      to: item.to || null,
      disabled: !!item.disabled,
      sortOrder: Number.isInteger(item.sortOrder) ? item.sortOrder : index,
      placements: item.placements?.length ? item.placements : ['toolbox'],
      launchMode: item.launchMode ?? 'internal_route',
      externalUrl: item.externalUrl ?? null,
      qrImageUrl: item.qrImageUrl ?? null,
      qrTargetUrl: item.qrTargetUrl ?? null,
    }))
    const config: TerminalToolboxConfigView = {
      terminalId,
      enabled: input.enabled,
      items,
      updatedAt: new Date(0).toISOString(),
    }
    const t = mockTerminals.find((x) => x.terminalId === terminalId)
    if (t) t.config = config
    return config
  },
  async listApps() {
    return mockApps
  },
  async listVersions(appKey) {
    appOrThrow(appKey)
    return mockVersions.filter((version) => version.snapshot.id === appKey).sort((a, b) => b.version - a.version)
  },
  async listAllowedHosts() {
    return mockHosts
  },
  async createApp(input) {
    if (!mockApps.some((app) => app.appKey === input.appKey)) {
      mockApps = [{
        id: `mock-app-${Date.now()}`,
        appKey: input.appKey,
        title: input.title,
        category: input.category,
        priority: input.priority,
        status: 'draft',
        riskLevel: input.riskLevel,
        createdBy: 'mock-admin',
        updatedBy: 'mock-admin',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        versionCount: 0,
        latestVersion: null,
        latestVersionStatus: null,
      }, ...mockApps]
    }
    return { appKey: input.appKey, status: 'draft' }
  },
  async createVersion(appKey, snapshot) {
    const app = appOrThrow(appKey)
    const version = Math.max(0, ...mockVersions.filter((item) => item.snapshot.id === appKey).map((item) => item.version)) + 1
    mockVersions = [{
      id: `mock-version-${appKey}-${version}`,
      appId: app.id,
      version,
      status: 'draft',
      snapshot: { ...snapshot, id: appKey, status: 'draft' } as ToolboxMicroAppDefinition,
      createdAt: new Date().toISOString(),
    }, ...mockVersions]
    updateMockApp(appKey, { status: 'draft', versionCount: app.versionCount + 1, latestVersion: version, latestVersionStatus: 'draft' })
    return { appKey, version, status: 'draft' }
  },
  async submitVersion(appKey, version) {
    mockVersions = mockVersions.map((item) => item.snapshot.id === appKey && item.version === version
      ? { ...item, status: 'submitted', submittedBy: 'mock-admin', submittedAt: new Date().toISOString() }
      : item)
    updateMockApp(appKey, { status: 'submitted', latestVersionStatus: 'submitted' })
    return { appKey, version, status: 'submitted' }
  },
  async approveVersion(appKey, version) {
    mockVersions = mockVersions.map((item) => item.snapshot.id === appKey && item.version === version
      ? { ...item, status: 'approved', approvedBy: 'mock-reviewer', reviewedAt: new Date().toISOString() }
      : item)
    updateMockApp(appKey, { status: 'approved', latestVersionStatus: 'approved' })
    return { appKey, version, status: 'approved' }
  },
  async rejectVersion(appKey, version, reason) {
    mockVersions = mockVersions.map((item) => item.snapshot.id === appKey && item.version === version
      ? { ...item, status: 'rejected', rejectedBy: 'mock-reviewer', rejectionReason: reason, reviewedAt: new Date().toISOString() }
      : item)
    updateMockApp(appKey, { status: 'rejected', latestVersionStatus: 'rejected' })
    return { appKey, version, status: 'rejected' }
  },
  async publishVersion(appKey, version, terminalIds) {
    const target = mockVersions.find((item) => item.snapshot.id === appKey && item.version === version)
    if (!target || target.status !== 'approved') {
      throw new ApiHttpError('TOOLBOX_PUBLISH_BLOCKED', '百宝箱微应用未通过发布门禁', 400, 'app_not_approved')
    }
    mockVersions = mockVersions.map((item) => item === target ? { ...item, status: 'published', publishedAt: new Date().toISOString() } : item)
    updateMockApp(appKey, { status: 'published', latestVersionStatus: 'published' })
    return { appKey, version, status: 'published', affectedTerminalCount: terminalIds?.length ?? mockTerminals.length, projectionKey: `app:${appKey}` }
  },
  async suspendApp(appKey) {
    appOrThrow(appKey)
    updateMockApp(appKey, { status: 'suspended' })
    return { appKey, status: 'suspended', affectedTerminalCount: 0, projectionKey: `app:${appKey}` }
  },
  async upsertAllowedHost(input) {
    const existing = mockHosts.find((host) => host.host === input.host && host.purpose === input.purpose)
    const next: ToolboxAllowedHostRecord = {
      id: existing?.id ?? `mock-host-${Date.now()}`,
      host: input.host,
      purpose: input.purpose,
      status: 'pending_review',
      owner: input.owner,
      reason: input.reason,
      createdBy: existing?.createdBy ?? 'mock-admin',
      reviewedBy: null,
      reviewedAt: null,
      expiresAt: input.expiresAt ?? null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mockHosts = [next, ...mockHosts.filter((host) => host.id !== next.id)]
    return next
  },
  async reviewAllowedHost(hostId, input) {
    let saved: ToolboxAllowedHostRecord | null = null
    mockHosts = mockHosts.map((host) => {
      if (host.id !== hostId) return host
      saved = {
        ...host,
        status: input.status,
        reason: input.reason ?? host.reason,
        reviewedBy: 'mock-reviewer',
        reviewedAt: new Date().toISOString(),
        expiresAt: input.expiresAt ?? host.expiresAt,
        updatedAt: new Date().toISOString(),
      }
      return saved
    })
    if (!saved) throw new ApiHttpError('TOOLBOX_HOST_NOT_FOUND', '允许域名不存在', 404)
    return saved
  },
}

export const toolboxService: ToolboxAdminServiceInterface =
  API_MODE === 'http' ? httpAdapter : mockAdapter
