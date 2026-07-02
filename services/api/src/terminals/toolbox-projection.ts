import type {
  KioskAppLaunchModeView,
  KioskToolboxItemView,
} from './terminal-toolbox.types'

export interface ToolboxMicroAppSnapshot {
  id: string
  title: string
  shortDescription: string
  riskLevel?: 'low' | 'medium' | 'high' | 'restricted'
  disclaimers?: string[]
  launch: {
    entryType: 'internal_route' | 'web_app' | 'qr_code' | 'mini_program_qr' | 'ai_skill'
    internalRoute?: string | null
    externalUrl?: string | null
    qrImageUrl?: string | null
    qrTargetUrl?: string | null
    assistantIntent?: string | null
    requiresHostAllowlist?: boolean
  }
}

export function toolboxProjectionKey(appKey: string): string {
  return `app:${appKey.trim().toLowerCase()}`
}

export function snapshotToKioskToolboxItem(
  appKey: string,
  snapshot: ToolboxMicroAppSnapshot,
  sortOrder = 1000,
): KioskToolboxItemView {
  const entryType = snapshot.launch.entryType
  const launchMode = mapLaunchMode(entryType)
  const internalRoute = snapshot.launch.internalRoute
    ?? (entryType === 'ai_skill' && snapshot.launch.assistantIntent
      ? `/assistant?intent=${encodeURIComponent(snapshot.launch.assistantIntent)}`
      : null)

  return {
    key: toolboxProjectionKey(appKey),
    title: snapshot.title,
    description: snapshot.shortDescription,
    icon: iconForEntryType(entryType),
    to: launchMode === 'internal_route' ? internalRoute ?? null : null,
    disabled: false,
    sortOrder,
    placements: ['toolbox'],
    launchMode,
    riskLevel: snapshot.riskLevel,
    disclaimers: snapshot.disclaimers,
    externalUrl: launchMode === 'external_url' ? snapshot.launch.externalUrl ?? null : null,
    qrImageUrl: launchMode === 'qr_code' || launchMode === 'mini_program_qr' ? snapshot.launch.qrImageUrl ?? null : null,
    qrTargetUrl: launchMode === 'qr_code' || launchMode === 'mini_program_qr' ? snapshot.launch.qrTargetUrl ?? null : null,
  }
}

export function removeProjectedToolboxItem(
  items: readonly KioskToolboxItemView[],
  appKey: string,
): KioskToolboxItemView[] {
  const key = toolboxProjectionKey(appKey)
  return items.filter((item) => item.key !== key)
}

export function upsertProjectedToolboxItem(
  items: readonly KioskToolboxItemView[],
  projected: KioskToolboxItemView,
): KioskToolboxItemView[] {
  const withoutExisting = items.filter((item) => item.key !== projected.key)
  return [...withoutExisting, projected].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'zh-Hans-CN'))
}

function mapLaunchMode(entryType: ToolboxMicroAppSnapshot['launch']['entryType']): KioskAppLaunchModeView {
  if (entryType === 'web_app') return 'external_url'
  if (entryType === 'qr_code') return 'qr_code'
  if (entryType === 'mini_program_qr') return 'mini_program_qr'
  return 'internal_route'
}

function iconForEntryType(entryType: ToolboxMicroAppSnapshot['launch']['entryType']): string {
  if (entryType === 'qr_code' || entryType === 'mini_program_qr') return 'help-circle'
  if (entryType === 'web_app') return 'sparkles'
  if (entryType === 'ai_skill') return 'sparkles'
  return 'wrench'
}
