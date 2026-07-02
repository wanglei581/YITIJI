import { BadRequestException } from '@nestjs/common'
import {
  assertDistinctToolboxReviewers,
  canTransitionToolboxAppStatus,
  type ToolboxGovernanceStatus,
  type ToolboxHostPurpose,
  type ToolboxHostStatus,
} from './toolbox-governance'
import type { KioskToolboxItemView } from './terminal-toolbox.types'
import type { ToolboxMicroAppSnapshot } from './toolbox-projection'
import { findToolboxComplianceViolation } from './toolbox-policy'

const GOVERNANCE_STATUSES = new Set<ToolboxGovernanceStatus>([
  'planned',
  'draft',
  'submitted',
  'approved',
  'published',
  'rejected',
  'suspended',
  'archived',
])
const HOST_STATUSES = new Set<ToolboxHostStatus>(['pending_review', 'active', 'suspended', 'expired', 'archived'])
const HOST_PURPOSES = new Set<ToolboxHostPurpose>(['web_app', 'qr_target', 'asset'])

export type NormalizedToolboxSnapshot = ToolboxMicroAppSnapshot & {
  category: string
  priority: string
  status: string
  riskLevel: 'low' | 'medium' | 'high' | 'restricted'
  permissions: string[]
  dataPolicy: { sensitiveDataAllowed: boolean; requiresExplicitConsent: boolean }
  disclaimers: string[]
}

export function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

export function cleanAppKey(value: string): string {
  const appKey = cleanText(value, 64).toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(appKey)) {
    throw badRequest('INVALID_TOOLBOX_APP_KEY', '微应用 appKey 必须是 3-64 位小写字母、数字或连字符')
  }
  return appKey
}

export function normalizeSnapshot(appKey: string, raw: Record<string, unknown>): NormalizedToolboxSnapshot {
  const launch = objectValue(raw.launch)
  const dataPolicy = objectValue(raw.dataPolicy)
  const entryType = cleanText(launch.entryType, 32)
  if (!['internal_route', 'web_app', 'qr_code', 'mini_program_qr', 'ai_skill'].includes(entryType)) {
    throw badRequest('INVALID_TOOLBOX_ENTRY_TYPE', '微应用入口类型不合法')
  }
  const riskLevel = cleanText(raw.riskLevel, 32)
  if (!['low', 'medium', 'high', 'restricted'].includes(riskLevel)) {
    throw badRequest('INVALID_TOOLBOX_RISK_LEVEL', '微应用风险等级不合法')
  }
  return {
    id: appKey,
    title: requiredText(raw.title, 32, 'INVALID_TOOLBOX_TITLE', '微应用标题不能为空'),
    shortDescription: requiredText(raw.shortDescription, 80, 'INVALID_TOOLBOX_DESCRIPTION', '微应用描述不能为空'),
    category: requiredText(raw.category, 32, 'INVALID_TOOLBOX_CATEGORY', '微应用分类不能为空'),
    priority: requiredText(raw.priority, 16, 'INVALID_TOOLBOX_PRIORITY', '微应用优先级不能为空'),
    status: cleanText(raw.status, 32) || 'draft',
    riskLevel: riskLevel as 'low' | 'medium' | 'high' | 'restricted',
    permissions: stringArray(raw.permissions, 32),
    launch: {
      entryType: entryType as ToolboxMicroAppSnapshot['launch']['entryType'],
      internalRoute: cleanText(launch.internalRoute, 128) || null,
      externalUrl: cleanText(launch.externalUrl, 512) || null,
      qrImageUrl: cleanText(launch.qrImageUrl, 512) || null,
      qrTargetUrl: cleanText(launch.qrTargetUrl, 512) || null,
      assistantIntent: cleanText(launch.assistantIntent, 80) || null,
      requiresHostAllowlist: Boolean(launch.requiresHostAllowlist),
    },
    dataPolicy: {
      sensitiveDataAllowed: Boolean(dataPolicy.sensitiveDataAllowed),
      requiresExplicitConsent: Boolean(dataPolicy.requiresExplicitConsent),
    },
    disclaimers: stringArray(raw.disclaimers, 160),
  }
}

export function parseSnapshot(snapshotJson: string): NormalizedToolboxSnapshot {
  try {
    const parsed = JSON.parse(snapshotJson)
    if (!parsed || typeof parsed !== 'object') throw new Error('INVALID_JSON')
    return normalizeSnapshot(cleanText((parsed as Record<string, unknown>).id, 64), parsed as Record<string, unknown>)
  } catch {
    throw badRequest('INVALID_TOOLBOX_SNAPSHOT', '微应用版本快照格式不合法')
  }
}

export function parseStoredItems(itemsJson: string | undefined): KioskToolboxItemView[] {
  if (!itemsJson) return []
  try {
    const parsed = JSON.parse(itemsJson)
    return Array.isArray(parsed) ? parsed as KioskToolboxItemView[] : []
  } catch {
    return []
  }
}

export function assertTransition(from: string, to: ToolboxGovernanceStatus): void {
  const source = asGovernanceStatus(from)
  if (!canTransitionToolboxAppStatus(source, to)) {
    throw badRequest('INVALID_TOOLBOX_STATUS_TRANSITION', `百宝箱微应用状态不允许从 ${from} 变更为 ${to}`)
  }
}

export function asGovernanceStatus(value: string): ToolboxGovernanceStatus {
  if (!GOVERNANCE_STATUSES.has(value as ToolboxGovernanceStatus)) {
    throw badRequest('INVALID_TOOLBOX_STATUS', `未知百宝箱微应用状态: ${value}`)
  }
  return value as ToolboxGovernanceStatus
}

export function assertReviewer(submittedBy: string | null, reviewerId: string): void {
  try {
    assertDistinctToolboxReviewers(submittedBy, reviewerId)
  } catch {
    throw badRequest('TOOLBOX_SELF_REVIEW_FORBIDDEN', '微应用提交人与审核人不能相同')
  }
}

export function assertComplianceCopy(title: string, description: string): void {
  const violation = findToolboxComplianceViolation(title, description)
  if (violation) {
    throw badRequest('TOOLBOX_CONTENT_BLOCKED', `微应用标题或描述包含非合规招聘闭环文案: ${violation}`)
  }
}

export function assertHostPurpose(value: string): ToolboxHostPurpose {
  if (!HOST_PURPOSES.has(value as ToolboxHostPurpose)) throw badRequest('INVALID_TOOLBOX_HOST_PURPOSE', '允许域名用途不合法')
  return value as ToolboxHostPurpose
}

export function assertHostStatus(value: string): ToolboxHostStatus {
  if (!HOST_STATUSES.has(value as ToolboxHostStatus)) throw badRequest('INVALID_TOOLBOX_HOST_STATUS', '允许域名状态不合法')
  return value as ToolboxHostStatus
}

export function normalizeHostInput(raw: string): string {
  const value = cleanText(raw, 128).toLowerCase().replace(/\.$/, '')
  if (!value) throw badRequest('INVALID_TOOLBOX_HOST', '允许域名不能为空')
  try {
    const host = new URL(value.includes('://') ? value : `https://${value}/`).hostname.toLowerCase().replace(/\.$/, '')
    if (!host || host.includes(':')) throw new Error('INVALID_HOST')
    return host
  } catch {
    throw badRequest('INVALID_TOOLBOX_HOST', '允许域名格式不合法')
  }
}

export function parseOptionalDate(value: string | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw badRequest('INVALID_TOOLBOX_HOST_EXPIRES_AT', '允许域名过期时间不合法')
  return date
}

export function isExternalUrlAllowed(): boolean {
  return process.env['TOOLBOX_ALLOW_EXTERNAL_URL'] === 'true'
}

export function badRequest(code: string, message: string, extra?: Record<string, unknown>): BadRequestException {
  return new BadRequestException({ error: { code, message, ...extra } })
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown, maxLength: number): string[] {
  return Array.isArray(value)
    ? value.map((item) => cleanText(item, maxLength)).filter(Boolean).slice(0, 20)
    : []
}

function requiredText(value: unknown, maxLength: number, code: string, message: string): string {
  const text = cleanText(value, maxLength)
  if (!text) throw badRequest(code, message)
  return text
}
