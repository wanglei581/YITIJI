import { findToolboxComplianceViolation } from './toolbox-policy'

export const TOOLBOX_GOVERNANCE_TRANSITIONS = {
  planned: ['draft', 'archived'],
  draft: ['submitted', 'archived'],
  submitted: ['approved', 'rejected', 'draft', 'archived'],
  approved: ['published', 'suspended', 'archived'],
  published: ['suspended', 'archived'],
  rejected: ['draft', 'archived'],
  suspended: ['approved', 'archived'],
  archived: [],
} as const

export type ToolboxGovernanceStatus = keyof typeof TOOLBOX_GOVERNANCE_TRANSITIONS
export type ToolboxHostStatus = 'pending_review' | 'active' | 'suspended' | 'expired' | 'archived'
export type ToolboxHostPurpose = 'web_app' | 'qr_target' | 'asset'

export type ToolboxPublishGateReason =
  | 'app_not_approved'
  | 'app_suspended'
  | 'app_archived'
  | 'self_review'
  | 'host_required'
  | 'host_not_allowed'
  | 'host_not_active'
  | 'host_expired'
  | 'host_suspended'
  | 'host_local_or_private'
  | 'content_blocked'
  | 'missing_disclaimer'
  | 'forbidden_capability'
  | 'external_url_disabled'
  | 'invalid_target_url'

export interface ToolboxAllowedHostInput {
  host: string
  purpose: ToolboxHostPurpose
  status: ToolboxHostStatus
  owner: string
  reason: string
  reviewedBy?: string | null
  reviewedAt?: string | null
  expiresAt?: string | null
}

export interface ToolboxGovernedAppInput {
  id: string
  title: string
  shortDescription: string
  status: ToolboxGovernanceStatus
  riskLevel: 'low' | 'medium' | 'high' | 'restricted'
  permissions: readonly string[]
  launch: {
    entryType: 'internal_route' | 'web_app' | 'qr_code' | 'mini_program_qr' | 'ai_skill'
    externalUrl?: string | null
    qrTargetUrl?: string | null
    requiresHostAllowlist: boolean
  }
  dataPolicy: {
    sensitiveDataAllowed: boolean
    requiresExplicitConsent: boolean
  }
  disclaimers: readonly string[]
  submittedBy?: string | null
  approvedBy?: string | null
}

export interface ToolboxGateResult {
  allowed: boolean
  reason: ToolboxPublishGateReason | null
}

export const TOOLBOX_GOVERNANCE_FORBIDDEN_PERMISSIONS = [
  'platform_resume_delivery',
  'employer_receives_resume',
  'candidate_screening',
  'interview_invitation',
  'offer_management',
  'candidate_recommendation_to_employer',
  'third_party_code_execution',
  'third_party_device_bridge',
] as const

const FORBIDDEN_PERMISSIONS = new Set<string>(TOOLBOX_GOVERNANCE_FORBIDDEN_PERMISSIONS)

const LOCAL_HOSTS = new Set(['localhost', 'localhost.localdomain'])

export function canTransitionToolboxAppStatus(from: ToolboxGovernanceStatus, to: ToolboxGovernanceStatus): boolean {
  return (TOOLBOX_GOVERNANCE_TRANSITIONS[from] as readonly ToolboxGovernanceStatus[]).includes(to)
}

export function assertDistinctToolboxReviewers(submittedBy: string | null | undefined, reviewedBy: string | null | undefined): void {
  if (!submittedBy || !reviewedBy || submittedBy === reviewedBy) {
    throw new Error('TOOLBOX_SELF_REVIEW_FORBIDDEN')
  }
}

export function evaluateToolboxHost(host: ToolboxAllowedHostInput, now: Date): ToolboxGateResult {
  const normalizedHost = normalizeHost(host.host)
  if (!normalizedHost || isLocalOrPrivateHost(normalizedHost)) {
    return blocked('host_local_or_private')
  }
  if (host.status === 'suspended') return blocked('host_suspended')
  if (host.status === 'expired') return blocked('host_expired')
  if (host.status !== 'active') return blocked('host_not_active')
  if (host.expiresAt) {
    const expiresAt = new Date(host.expiresAt).getTime()
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
      return blocked('host_expired')
    }
  }
  return { allowed: true, reason: null }
}

export function evaluateToolboxPublishGate(
  app: ToolboxGovernedAppInput,
  options: { allowedHosts: readonly ToolboxAllowedHostInput[]; now: Date; externalUrlAllowed: boolean },
): ToolboxGateResult {
  if (app.status === 'archived') return blocked('app_archived')
  if (app.status === 'suspended') return blocked('app_suspended')
  if (app.status !== 'approved') return blocked('app_not_approved')

  try {
    assertDistinctToolboxReviewers(app.submittedBy, app.approvedBy)
  } catch {
    return blocked('self_review')
  }

  const complianceViolation = findToolboxComplianceViolation(app.title, app.shortDescription)
  if (complianceViolation) return blocked('content_blocked')

  if ((app.riskLevel === 'high' || app.riskLevel === 'restricted') && !hasMeaningfulDisclaimer(app.disclaimers)) {
    return blocked('missing_disclaimer')
  }

  if (app.permissions.some((permission) => FORBIDDEN_PERMISSIONS.has(permission))) {
    return blocked('forbidden_capability')
  }

  const target = targetUrlForApp(app)
  if (app.launch.entryType === 'web_app' && !options.externalUrlAllowed) {
    return blocked('external_url_disabled')
  }
  const requiresUrlHostGate = app.launch.entryType !== 'mini_program_qr' &&
    (app.launch.requiresHostAllowlist || app.launch.entryType === 'web_app' || app.launch.entryType === 'qr_code')
  if (requiresUrlHostGate) {
    if (!target) return blocked('host_required')
    const host = hostFromUrl(target)
    if (!host) return blocked('invalid_target_url')
    if (isLocalOrPrivateHost(host)) return blocked('host_local_or_private')
    const allowedHost = options.allowedHosts.find((item) =>
      item.purpose === purposeForApp(app) && normalizeHost(item.host) === host
    )
    if (!allowedHost) return blocked('host_not_allowed')
    const hostGate = evaluateToolboxHost(allowedHost, options.now)
    if (!hostGate.allowed) return hostGate
  }

  return { allowed: true, reason: null }
}

function blocked(reason: ToolboxPublishGateReason): ToolboxGateResult {
  return { allowed: false, reason }
}

function targetUrlForApp(app: ToolboxGovernedAppInput): string | null {
  if (app.launch.entryType === 'web_app') return app.launch.externalUrl ?? null
  if (app.launch.entryType === 'qr_code') return app.launch.qrTargetUrl ?? null
  return null
}

function purposeForApp(app: ToolboxGovernedAppInput): ToolboxHostPurpose {
  return app.launch.entryType === 'qr_code' ? 'qr_target' : 'web_app'
}

function hostFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:') return null
    return normalizeHost(url.hostname)
  } catch {
    return null
  }
}

function normalizeHost(host: string): string {
  const value = host.trim().toLowerCase().replace(/\.$/, '')
  try {
    return new URL(`https://${value}/`).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return value
  }
}

function isLocalOrPrivateHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '')
  if (LOCAL_HOSTS.has(normalized)) return true
  if (normalized.includes(':')) return true
  const parts = normalized.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }
  const [a, b] = parts as [number, number, number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function hasMeaningfulDisclaimer(disclaimers: readonly string[]): boolean {
  return disclaimers.some((disclaimer) => disclaimer.trim().length > 0)
}
