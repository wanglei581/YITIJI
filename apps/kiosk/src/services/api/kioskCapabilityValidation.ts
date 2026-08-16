import type {
  KioskAppItem,
  KioskSmartCampusConfig,
  KioskTerminalConfig,
  KioskToolboxConfig,
} from '@ai-job-print/shared'

const LAUNCH_MODES = new Set(['internal_route', 'external_url', 'qr_code', 'mini_program_qr'])
const PLACEMENTS = new Set(['toolbox', 'smart_campus'])
const INTERNAL_ROUTE = /^\/(?!\/)(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?(?:[?#][^\\<>]*)?$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || isNullableString(value)
}

export function isValidKioskAppItem(value: unknown): value is KioskAppItem {
  if (!isRecord(value)) return false
  if (
    typeof value['key'] !== 'string' ||
    typeof value['title'] !== 'string' ||
    typeof value['description'] !== 'string' ||
    typeof value['icon'] !== 'string' ||
    !isNullableString(value['to']) ||
    typeof value['disabled'] !== 'boolean' ||
    typeof value['sortOrder'] !== 'number' ||
    !Number.isFinite(value['sortOrder']) ||
    !isOptionalNullableString(value['externalUrl']) ||
    !isOptionalNullableString(value['qrImageUrl']) ||
    !isOptionalNullableString(value['qrTargetUrl'])
  ) {
    return false
  }

  const launchMode = value['launchMode']
  if (launchMode !== undefined && (typeof launchMode !== 'string' || !LAUNCH_MODES.has(launchMode))) {
    return false
  }
  const placements = value['placements']
  return (
    placements === undefined ||
    (Array.isArray(placements) &&
      placements.every((placement) => typeof placement === 'string' && PLACEMENTS.has(placement)))
  )
}

function validItems(value: unknown): value is KioskAppItem[] {
  return Array.isArray(value) && value.every(isValidKioskAppItem)
}

function isSmartCampusConfig(value: unknown): value is KioskSmartCampusConfig {
  if (!isRecord(value) || typeof value['enabled'] !== 'boolean' || !validItems(value['items'])) {
    return false
  }
  const modules = value['modules']
  return (
    isRecord(modules) &&
    typeof modules['welcome'] === 'boolean' &&
    typeof modules['bigdata'] === 'boolean' &&
    typeof modules['luggage'] === 'boolean' &&
    typeof modules['panorama'] === 'boolean'
  )
}

function isToolboxConfig(value: unknown): value is KioskToolboxConfig {
  return isRecord(value) && typeof value['enabled'] === 'boolean' && validItems(value['items'])
}

export function parseKioskTerminalConfig(value: unknown): KioskTerminalConfig | null {
  if (!isRecord(value)) return null
  if (
    !isSmartCampusConfig(value['smartCampus']) ||
    !isToolboxConfig(value['toolbox']) ||
    typeof value['configVersion'] !== 'string' ||
    value['configVersion'].trim().length === 0 ||
    typeof value['refreshIntervalMs'] !== 'number' ||
    !Number.isFinite(value['refreshIntervalMs']) ||
    value['refreshIntervalMs'] <= 0 ||
    typeof value['serverTime'] !== 'string' ||
    !Number.isFinite(Date.parse(value['serverTime']))
  ) {
    return null
  }
  return value as unknown as KioskTerminalConfig
}

export function isLaunchableKioskAppItem(item: KioskAppItem): boolean {
  if (item.disabled) return false
  const launchMode = item.launchMode ?? 'internal_route'
  if (launchMode === 'internal_route') return Boolean(item.to && INTERNAL_ROUTE.test(item.to))
  if (launchMode === 'external_url') return isHttpsUrl(item.externalUrl)
  return isSafeQrImageUrl(item.qrImageUrl) && isSafeQrTarget(item.qrTargetUrl, launchMode)
}

function isHttpsUrl(value: string | null | undefined): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

function isSafeQrImageUrl(value: string | null | undefined): boolean {
  if (!value) return false
  return (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) || isHttpsUrl(value)
}

function isSafeQrTarget(
  value: string | null | undefined,
  launchMode: 'qr_code' | 'mini_program_qr',
): boolean {
  if (launchMode === 'qr_code') return isHttpsUrl(value)
  return Boolean(
    value &&
      !/^(?:javascript|file|data|vbscript|https?):/i.test(value) &&
      !value.includes('://') &&
      !value.includes('\\') &&
      !value.includes('<') &&
      !value.includes('>'),
  )
}
