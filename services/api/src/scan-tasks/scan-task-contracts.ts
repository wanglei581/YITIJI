import { createHash, timingSafeEqual } from 'node:crypto'
import { ForbiddenException } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { SCAN_DEVICE_PAGE_COUNT_UNREADABLE_MESSAGE } from '../files/file-validation'
import type { FilePurpose } from '../files/file.types'
import type { ScanDeliveryLeaseResult } from './scan-lease'

/**
 * 契约本地副本。源：packages/shared/src/types/scanTask.ts。
 * services/api 不直接 import @ai-job-print/shared（commonjs 与 ESM 互操作），字段变更必须两处一起改。
 */
export type ScanType = 'resume' | 'id' | 'document' | 'contract'
export type ScanTaskStatus =
  | 'waiting'
  | 'matched'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled'

/** Unacked waiting rows older than this are expired; must exceed kiosk lost-response replay (~25s). */
export const SCAN_UNACKED_WAITING_GRACE_MS = 60 * 1000

/**
 * 投递内容去重窗口。必须与 apps/terminal-agent scan-watcher.ts 的 DELIVERY_RETRY_MAX_MS 相等。
 * 两侧没有共同的运行时 import，verify-scan-tasks 读源码断言两边数值一致。
 */
export const SCAN_CONTENT_DEDUP_WINDOW_MS = 2 * 60 * 60 * 1000

/** 观察时间未来容差（5 秒），覆盖 NTP 微漂移。 */
export const SCAN_MAX_FUTURE_OBSERVATION_MS = 5_000

/**
 * 扫描捕获时间陈旧性时钟容差（5 秒）。
 * 正常极速扫描不会被 NTP 微抖动误拒，跨用户残留文件（观察时间早于新任务）仍会被拒绝。
 */
export const SCAN_STALE_CAPTURE_TOLERANCE_MS = 5_000

/** 扫描会话从创建到过期的窗口。 */
export const SCAN_TASK_TTL_MS = 10 * 60 * 1000

/** 建档后签发的内容 URL 有效期，与打印/上传会话链路同一惯例（30 分钟）。 */
export const SCAN_FILE_URL_TTL_MS = 30 * 60 * 1000

/**
 * matched 状态心跳节拍。投递在上传期间按这个间隔刷新 updatedAt，
 * 避免收割任务把仍在上传的会话当成卡死。
 */
export const SCAN_MATCHED_HEARTBEAT_INTERVAL_MS = 60 * 1000

export const SCAN_TYPE_TO_PURPOSE: Record<ScanType, FilePurpose> = {
  resume: 'resume_scan',
  id: 'id_scan',
  document: 'print_doc',
  contract: 'contract_upload',
}

/** 面向用户的失败原因白名单，不透出内部错误细节。 */
export const USER_FACING_SCAN_ERROR: Record<string, string> = {
  SCAN_UPLOAD_FAILED: '扫描文件处理失败，请重新扫描',
  SCAN_FILE_TYPE_NOT_ALLOWED:
    '这次扫出来的文件格式不收：证件扫描请在打印机屏幕上选图片格式（JPG）后重扫。',
  SCAN_FILE_TOO_LARGE: '这份扫描文件太大，收不了。请少扫几页，分成几次办理。',
  SCAN_DEVICE_TOO_MANY_PAGES: '页数超过这次扫描的上限。请少扫几页，分成几次办理。',
  SCAN_DEVICE_PAGE_COUNT_UNREADABLE: SCAN_DEVICE_PAGE_COUNT_UNREADABLE_MESSAGE,
  SCAN_MATCHED_TIMEOUT: '扫描处理超时未完成',
}

/**
 * 投递 catch 只认这四种文件服务错误码。其余（含 SCAN_TASK_STATE_CHANGED、普通 Error）
 * 仍落 SCAN_UPLOAD_FAILED。按 getResponse() 取码，这样 ConflictException 也看得见。
 * 页数读不出必须单独保留，不能并进 SCAN_DEVICE_TOO_MANY_PAGES。
 */
export function scanDeliveredUploadErrorCode(error: unknown): string {
  const code = nestedExceptionErrorCode(error)
  if (code === 'FILE_MIME_NOT_ALLOWED') return 'SCAN_FILE_TYPE_NOT_ALLOWED'
  if (code === 'FILE_TOO_LARGE') return 'SCAN_FILE_TOO_LARGE'
  if (code === 'SCAN_DEVICE_TOO_MANY_PAGES') return 'SCAN_DEVICE_TOO_MANY_PAGES'
  if (code === 'SCAN_DEVICE_PAGE_COUNT_UNREADABLE') return 'SCAN_DEVICE_PAGE_COUNT_UNREADABLE'
  return 'SCAN_UPLOAD_FAILED'
}

function nestedExceptionErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('getResponse' in error)) return null
  const getResponse = (error as { getResponse?: () => unknown }).getResponse
  if (typeof getResponse !== 'function') return null
  const response = getResponse.call(error)
  if (!response || typeof response !== 'object' || !('error' in response)) return null
  const detail = (response as { error?: unknown }).error
  if (!detail || typeof detail !== 'object' || !('code' in detail)) return null
  const code = (detail as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

/** 指引单一事实源。Kiosk 只渲染本数组全文。不写 UNC 明文。 */
export const SCAN_TYPE_INSTRUCTIONS: Record<ScanType, string[]> = {
  resume: [
    '将简历原件正面朝上放入自动进纸器，或正面朝下对齐玻璃板左上角',
    '在打印机操作面板点击「扫描」',
    '选择「扫描到 SMB」（本机已配置的接收目录）；简历建议黑白，文字更清晰',
    '按「开始」扫描；完成后回到本屏幕等待自动识别，请勿关闭页面',
  ],
  id: [
    '将证件正面朝下放在打印机玻璃板中央，取下订书钉并抚平',
    '在打印机操作面板点击「扫描」，分辨率建议 300 DPI',
    '选择「扫描到 SMB」（本机已配置的接收目录）后按「开始」；正反面需翻面再扫一次',
    '完成后回到本屏幕等待自动识别，请勿关闭页面',
  ],
  document: [
    '多页材料放入自动进纸器，单页证书放在玻璃板上',
    '在打印机操作面板点击「扫描」，并选择「扫描到 SMB」（本机已配置的接收目录）',
    '按「开始」扫描；整叠扫完后回到本屏幕等待自动生成 PDF，请勿关闭页面',
  ],
  contract: [
    '将合同或协议按页序放入自动进纸器，单页材料正面朝下对齐玻璃板左上角',
    '在打印机操作面板点击「扫描」，分辨率建议 300 DPI',
    '选择「扫描到 SMB」（本机已配置的接收目录）后按「开始」',
    '完成后请回到这台屏幕等待处理，期间请勿关闭页面或结束这次办理。',
  ],
}

export interface ScanTaskFileView {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  fileUrl: string
}

export interface ScanTaskStatusResult {
  scanTaskId: string
  status: ScanTaskStatus
  scanType: ScanType
  file: ScanTaskFileView | null
  errorCode: string | null
  errorMessage: string | null
  expiresAt: string
  startMode: 'panel' | 'device'
  deviceState: string | null
  devicePageCount: number
  deviceErrorCode: string | null
  deviceSource: string | null
  deviceColorMode: string | null
  deviceUpdatedAt: string | null
  deviceMaxPages: number | null
}

export type ScanDeliveryLeaseView = ScanDeliveryLeaseResult & {
  startMode?: 'device'
  device?: { source: string | null; colorMode: string | null; maxPages: number; maxBytes: number }
}

export interface ScanRetryCreateResult {
  scanTaskId: string
  controlToken: string
  expiresAt: string
  instructions: string[]
}

function uniqueConflictTargetsField(e: unknown, field: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false
  const target = e.meta?.['target']
  if (typeof target === 'string') return target.includes(field)
  if (Array.isArray(target)) return target.some((value) => String(value).includes(field))
  return e.message.includes(field)
}

export function isScanTaskActiveSessionConflict(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === 'P2002' &&
    !isScanRetryLineageConflict(e)
  )
}

export function isScanRetryLineageConflict(e: unknown): boolean {
  return (
    uniqueConflictTargetsField(e, 'retryOfScanTaskId') ||
    uniqueConflictTargetsField(e, 'retryConsumedByScanTaskId')
  )
}

/**
 * controlToken 与存库 hash 做定长比较。长度不一致时直接 false，
 * 避免 timingSafeEqual 因长度不同抛异常。
 */
export function timingSafeEqualHex(
  token: string | undefined,
  expectedHash: string | null | undefined
): boolean {
  if (!token || !expectedHash) return false
  const actual = Buffer.from(createHash('sha256').update(token).digest('hex'), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** 会员与游客都要 controlToken；重读竞态胜者后也必须对最新快照再校验。 */
export function assertScanTaskReadAccess(
  task: { controlTokenHash: string | null; endUserId: string | null },
  endUserId: string | null,
  controlToken: string | undefined
): void {
  if (
    !task.controlTokenHash ||
    !controlToken ||
    !timingSafeEqualHex(controlToken, task.controlTokenHash)
  ) {
    throw new ForbiddenException({
      error: { code: 'SCAN_TASK_FORBIDDEN', message: '无权查看该扫描任务' },
    })
  }
  if (task.endUserId && task.endUserId !== endUserId) {
    throw new ForbiddenException({
      error: { code: 'SCAN_TASK_FORBIDDEN', message: '无权查看该扫描任务' },
    })
  }
}
