/**
 * U 盘导入能力开关（走查 W-125）。
 *
 * 一体机首页卡片看的是同一份公开只读接口
 * GET {apiBaseUrl}/terminals/{terminalId}/capabilities。
 * Agent 在列文件和代传之前再查一次，挡住深链接、简历来源页、
 * 二维码过期后改走 U 盘这三条不经过首页卡片的路。
 *
 * 2026-10-04 核对：usb_import 不在 DEFAULT_DENY_CAPABILITY_KEYS。
 * 服务端副本 services/api/src/terminals/terminal-capabilities.types.ts
 * 与 packages/shared/src/types/printScanCapability.ts 的名单都只有
 * color_print / duplex_print / signature_stamp。
 * 因此没有 usb_import 这一行，或 configured === false，按「还没接管」放行。
 * 配过且 status 不是 available（含枚举外的脏值）一律拒绝。
 * 请求失败、超过 5 秒、返回形状对不上，拒绝且不缓存。
 *
 * 公开接口直接返回 { terminalCode, capabilities }，没有全局 { success, data }
 * 包装（管理员那条才包）。两种形状都认，避免以后加上包装就整机 fail-closed。
 */
import axios from 'axios'
import { createApiClient, NO_RETRY_CONFIG } from '../agent/api-client'
import { log, warn } from '../logger'

export const USB_IMPORT_CAPABILITY_KEY = 'usb_import'
export const USB_CAPABILITY_TIMEOUT_MS = 5_000
export const USB_CAPABILITY_CACHE_MS = 15_000

export const LOCAL_USB_DISABLED = {
  httpStatus: 403 as const,
  code: 'LOCAL_USB_DISABLED' as const,
  message: '这台机器暂未开放 U 盘导入，请用手机扫码上传',
}

export const LOCAL_USB_CAPABILITY_UNKNOWN = {
  httpStatus: 503 as const,
  code: 'LOCAL_USB_CAPABILITY_UNKNOWN' as const,
  message: '暂时确认不了 U 盘导入是否开放，请稍后再试或用手机扫码上传',
}

export type UsbImportDecision =
  | { allowed: true }
  | {
      allowed: false
      httpStatus: 403 | 503
      code: 'LOCAL_USB_DISABLED' | 'LOCAL_USB_CAPABILITY_UNKNOWN'
      message: string
    }

export interface FetchUsbCapabilitiesInput {
  apiBaseUrl: string
  terminalId: string
  timeoutMs: number
}

export type FetchUsbCapabilities = (input: FetchUsbCapabilitiesInput) => Promise<unknown>

interface CacheEntry {
  key: string
  expiresAt: number
  decision: UsbImportDecision
}

let cache: CacheEntry | null = null

export function resetUsbCapabilityCacheForTest(): void {
  cache = null
}

export async function decideUsbImport(input: {
  apiBaseUrl: string
  terminalId: string | undefined
  now?: number
  fetchCapabilities?: FetchUsbCapabilities
}): Promise<UsbImportDecision> {
  const now = input.now ?? Date.now()
  const terminalId = input.terminalId?.trim() ?? ''
  const apiBaseUrl = input.apiBaseUrl.trim()
  if (!terminalId || !apiBaseUrl) {
    warn('usb-capability: decision=unknown reason=missing_terminal')
    return unknownDecision()
  }

  const key = `${terminalId}\u0000${apiBaseUrl}`
  if (cache && cache.key === key && cache.expiresAt > now) return cache.decision

  try {
    const body = await (input.fetchCapabilities ?? fetchCapabilitiesFromApi)({
      apiBaseUrl,
      terminalId,
      timeoutMs: USB_CAPABILITY_TIMEOUT_MS,
    })
    const decision = decideFromBody(body)
    if (isCacheable(decision)) {
      cache = { key, expiresAt: now + USB_CAPABILITY_CACHE_MS, decision }
    }
    return decision
  } catch (error) {
    warn(`usb-capability: decision=unknown reason=${failureReason(error)}`)
    return unknownDecision()
  }
}

async function fetchCapabilitiesFromApi(input: FetchUsbCapabilitiesInput): Promise<unknown> {
  // 不用带重试的 30 秒客户端：5xx 会再试三次，整体会超过 5 秒上限。
  const client = createApiClient(input.apiBaseUrl)
  const response = await client.get<unknown>(
    `/terminals/${encodeURIComponent(input.terminalId)}/capabilities`,
    { ...NO_RETRY_CONFIG, timeout: input.timeoutMs },
  )
  return response.data
}

function decideFromBody(body: unknown): UsbImportDecision {
  const rows = extractCapabilities(body)
  if (!rows) {
    warn('usb-capability: decision=unknown reason=bad_shape')
    return unknownDecision()
  }
  const row = findUsbImportRow(rows)
  if (row === 'malformed') {
    warn('usb-capability: decision=unknown reason=bad_shape')
    return unknownDecision()
  }
  if (!row || !row.configured) {
    log(`usb-capability: decision=allow configured=false status=${logStatus(row?.status ?? null)}`)
    return { allowed: true }
  }
  if (row.status === 'available') {
    log('usb-capability: decision=allow configured=true status=available')
    return { allowed: true }
  }
  log(`usb-capability: decision=deny configured=true status=${logStatus(row.status)}`)
  return {
    allowed: false,
    httpStatus: LOCAL_USB_DISABLED.httpStatus,
    code: LOCAL_USB_DISABLED.code,
    message: LOCAL_USB_DISABLED.message,
  }
}

function extractCapabilities(body: unknown): unknown[] | null {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  if (Array.isArray(record.capabilities)) return record.capabilities
  const data = record.data
  if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).capabilities)) {
    return (data as { capabilities: unknown[] }).capabilities
  }
  return null
}

function findUsbImportRow(rows: unknown[]): { configured: boolean; status: string } | null | 'malformed' {
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    if (record.capabilityKey !== USB_IMPORT_CAPABILITY_KEY) continue
    if (typeof record.configured !== 'boolean') return 'malformed'
    return {
      configured: record.configured,
      status: typeof record.status === 'string' ? record.status : '',
    }
  }
  return null
}

function isCacheable(decision: UsbImportDecision): boolean {
  if (decision.allowed) return true
  return decision.httpStatus === 403
}

function unknownDecision(): UsbImportDecision {
  return {
    allowed: false,
    httpStatus: LOCAL_USB_CAPABILITY_UNKNOWN.httpStatus,
    code: LOCAL_USB_CAPABILITY_UNKNOWN.code,
    message: LOCAL_USB_CAPABILITY_UNKNOWN.message,
  }
}

function logStatus(status: string | null): string {
  if (status === null) return 'absent'
  if (/^[a-z0-9_]{1,32}$/i.test(status)) return status
  return 'invalid'
}

function failureReason(error: unknown): string {
  if (!axios.isAxiosError(error)) return 'error'
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return 'timeout'
  const status = error.response?.status
  if (typeof status === 'number') return `http_${status}`
  return 'network'
}
