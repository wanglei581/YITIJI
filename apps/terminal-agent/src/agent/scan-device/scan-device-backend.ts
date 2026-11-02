/**
 * agent/scan-device/scan-device-backend.ts — 屏上扫描的云端租约与状态回报
 *
 * 取 current-lease 的失败口径与 fetchScanLease 相同（409 / 404 / NO_WAITING_SCAN_TASK
 * 视为当前没有可执行任务），但本文件自己解析 device 字段，不改那条面板路线。
 * 回报：POST /terminals/:terminalId/scan-tasks/:taskId/device-report。
 * 401 闩上本地未授权标记。停扫 409 与「只拒这一次回报」的 409 分开返回。
 */

import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import { NO_RETRY_CONFIG, isUnauthorizedHttpError } from '../api-client'
import { markUnauthorized } from '../auth-state'

const NO_RETRY = NO_RETRY_CONFIG as unknown as AxiosRequestConfig
import { SCAN_TASK_ID_PATTERN } from './scan-temp-dir'
import type { ScanDeviceErrorCode } from './wia-script'
import type { WiaColor, WiaSource } from './wia-script'

export type ScanDeviceReportState =
  | 'ready'
  | 'scanning'
  | 'page_ready'
  | 'composing'
  | 'delivering'
  | 'error'
  | 'aborted'

export interface DeviceLease {
  scanTaskId: string
  serverNow: string
  notBefore: string
  expiresAt: string
  deliveryLease: string
  startMode: 'device'
  device: { source: WiaSource; colorMode: WiaColor; maxPages?: number; maxBytes?: number }
}

export interface DeviceReportBody {
  state: ScanDeviceReportState
  pageCount?: number
  errorCode?: ScanDeviceErrorCode
  /** 这一场实际在扫的来源和颜色。只有 scanDeviceReportSettings 开着才放进请求体。 */
  source?: WiaSource
  colorMode?: WiaColor
}

export type FetchDeviceLeaseResult =
  | { kind: 'lease'; lease: DeviceLease }
  | { kind: 'none'; stopCode?: string }
  | { kind: 'rejected'; code: string }
  | { kind: 'unauthorized' }
  | { kind: 'unavailable' }

export type DeviceReportResult =
  | { kind: 'ok' }
  | { kind: 'stop'; code: string }
  | { kind: 'rejected'; code: string }
  | { kind: 'unauthorized' }
  | { kind: 'unavailable' }

/** 全称与任务说明里的简称都算停扫。改用面板只认带 SWITCHED 的两个。 */
const SCAN_DEVICE_STOP_CODES = new Set<string>([
  'SCAN_DEVICE_TASK_CANCELLED',
  'TASK_CANCELLED',
  'SCAN_DEVICE_TASK_ENDED',
  'TASK_ENDED',
  'SCAN_DEVICE_SWITCHED_TO_PANEL',
  'SWITCHED_TO_PANEL',
  'SCAN_DEVICE_CAPABILITY_DISABLED',
  'CAPABILITY_DISABLED',
  'SCAN_TASK_NOT_DEVICE',
  'SCAN_DEVICE_TASK_NOT_ACKED',
  'TASK_NOT_ACKED',
  'SCAN_DEVICE_SETTINGS_CHANGED',
])

const SWITCHED_TO_PANEL_CODES = new Set<string>([
  'SCAN_DEVICE_SWITCHED_TO_PANEL',
  'SWITCHED_TO_PANEL',
])

export function isScanDeviceStopCode(code: string): boolean {
  return SCAN_DEVICE_STOP_CODES.has(code)
}

export function isSwitchedToPanelCode(code: string): boolean {
  return SWITCHED_TO_PANEL_CODES.has(code)
}

function readErrorCode(error: unknown): { status?: number; code?: string } {
  const response = (error as { response?: { status?: number; data?: { error?: { code?: string } } } }).response
  const code = response?.data?.error?.code
  return {
    status: response?.status,
    code: typeof code === 'string' ? code : undefined,
  }
}

function unwrapData(body: unknown): unknown {
  if (!body || typeof body !== 'object') return undefined
  if ('data' in body) return (body as { data?: unknown }).data
  return body
}

/** 不是 device、参数不齐或已经过期都返回 undefined，调用方按「没有可执行任务」处理。 */
export function readDeviceLease(body: unknown, now: number): DeviceLease | undefined {
  const data = unwrapData(body)
  if (!data || typeof data !== 'object') return undefined
  const row = data as Record<string, unknown>
  if (row['startMode'] !== 'device') return undefined
  const device = row['device']
  if (!device || typeof device !== 'object') return undefined
  const source = (device as { source?: unknown }).source
  const colorMode = (device as { colorMode?: unknown }).colorMode
  if (source !== 'flatbed' && source !== 'feeder') return undefined
  if (colorMode !== 'gray' && colorMode !== 'color') return undefined
  const scanTaskId = row['scanTaskId']
  const deliveryLease = row['deliveryLease']
  const notBefore = row['notBefore']
  const expiresAt = row['expiresAt']
  const serverNow = row['serverNow']
  if (typeof scanTaskId !== 'string' || !SCAN_TASK_ID_PATTERN.test(scanTaskId)) return undefined
  if (typeof deliveryLease !== 'string' || deliveryLease.length === 0) return undefined
  if (typeof notBefore !== 'string' || Number.isNaN(Date.parse(notBefore))) return undefined
  if (typeof expiresAt !== 'string' || !(Date.parse(expiresAt) > now)) return undefined
  const maxPages = optionalDeviceLimit((device as { maxPages?: unknown }).maxPages)
  const maxBytes = optionalDeviceLimit((device as { maxBytes?: unknown }).maxBytes)
  return {
    scanTaskId,
    serverNow: typeof serverNow === 'string' ? serverNow : new Date(now).toISOString(),
    notBefore,
    expiresAt,
    deliveryLease,
    startMode: 'device',
    device: {
      source,
      colorMode,
      ...(maxPages !== undefined ? { maxPages } : {}),
      ...(maxBytes !== undefined ? { maxBytes } : {}),
    },
  }
}

/** 不是正整数就当这个上限没给，整张租约仍然有效。 */
function optionalDeviceLimit(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return undefined
  return value
}

export async function fetchDeviceLease(
  client: AxiosInstance,
  terminalId: string | undefined,
  now: number,
): Promise<FetchDeviceLeaseResult> {
  if (!terminalId) return { kind: 'unavailable' }
  try {
    const response = await client.get(
      `/terminals/${encodeURIComponent(terminalId)}/scan-tasks/current-lease`,
      NO_RETRY,
    )
    const lease = readDeviceLease(response.data, now)
    return lease ? { kind: 'lease', lease } : { kind: 'none' }
  } catch (error) {
    if (isUnauthorizedHttpError(error)) {
      markUnauthorized()
      return { kind: 'unauthorized' }
    }
    const { status, code } = readErrorCode(error)
    if (status === 409 && code && isScanDeviceStopCode(code)) return { kind: 'none', stopCode: code }
    if (status === 404 || code === 'NO_WAITING_SCAN_TASK') return { kind: 'none' }
    if (status === 409) return { kind: 'rejected', code: code ?? 'HTTP_409' }
    return { kind: 'unavailable' }
  }
}

export async function postDeviceReport(
  client: AxiosInstance,
  terminalId: string | undefined,
  taskId: string,
  body: DeviceReportBody,
): Promise<DeviceReportResult> {
  if (!terminalId) return { kind: 'unavailable' }
  const payload: DeviceReportBody = { state: body.state }
  if (body.pageCount !== undefined) payload.pageCount = body.pageCount
  if (body.state === 'error' && body.errorCode) payload.errorCode = body.errorCode
  if (body.source && body.colorMode) {
    payload.source = body.source
    payload.colorMode = body.colorMode
  }
  try {
    await client.post(
      `/terminals/${encodeURIComponent(terminalId)}/scan-tasks/${encodeURIComponent(taskId)}/device-report`,
      payload,
      NO_RETRY,
    )
    return { kind: 'ok' }
  } catch (error) {
    if (isUnauthorizedHttpError(error)) {
      markUnauthorized()
      return { kind: 'unauthorized' }
    }
    const { status, code } = readErrorCode(error)
    if (status === 409 && code && isScanDeviceStopCode(code)) return { kind: 'stop', code }
    if (status === 409) return { kind: 'rejected', code: code ?? 'HTTP_409' }
    return { kind: 'unavailable' }
  }
}
