import type { AxiosInstance } from 'axios'
import { NO_RETRY_CONFIG } from './api-client'

export interface ScanTaskLease {
  scanTaskId: string
  serverNow: string
  notBefore: string
  expiresAt: string
  deliveryLease: string
}

export const SCAN_PRE_EXISTING_TOLERANCE_MS = 5_000

/**
 * Windows SMB 可保证边界与设计考量：
 *
 * 1. Windows SMB / NTFS 可保证边界：
 *    - 宿主机 NTFS 内核负责为共享目录中的每个新文件生成目录项、记录 birthtime（创建时间）和 mtime（最后写入时间）。
 *    - 打印机/扫描仪通过 SMB 协议分块写入文件期间，由于写锁定或连续增长，Agent 借由连续两次一致的采样快照
 *      （waitForStableFile: STABILITY_REQUIRED_CONSECUTIVE）可确定文件已完全写入落盘。
 *
 * 2. Windows SMB 无法保证的边界：
 *    - 扫描仪硬件（如富士施乐、惠普、佳能复合机）投递至 SMB 共享目录属于无状态网络文件流，
 *      硬件内部并不包含 Kiosk 当前用户的会话身份或认证 Token。
 *    - 扫描仪内嵌 RTC 时钟可能存在偏差，甚至 SMB 客户端可通过 SetFileTime 操纵时间戳。
 *    - 如果前一用户 A 取消或超时，其残留扫描件若滞留在目录中，与后一用户 B 的扫描件在文件系统层无天然隔离。
 *    - 绝不能将 Agent 处理文件时的执行时刻（new Date()）或者单纯的 mtime 视作用户身份凭据。
 *
 * 3. 租约与防线屏障（Pre-existing Barrier）：
 *    - Agent 在读取和投递候选文件前，必须向 API 服务端申请当前有效任务的短期加密租约（deliveryLease）。
 *    - 若服务端无等待任务（NO_WAITING_SCAN_TASK），候选文件立即隔离进 _unclaimed，严防残留。
 *    - 若取得租约，将候选文件的本地可信快照时间与租约生效时间（notBefore / task.createdAt）比对：
 *      任何在当前任务租约开始前已经存在的文件（mtime 或 birthtime 早于 notBefore - 5s 容差），
 *      判定为上一会话残留的旧文件，直接移入 _unclaimed 隔离，绝不投递至当前新任务中。
 *    - 投递请求必须在 multipart 中携带 scanTaskId、短期 deliveryLease 和 candidateSnapshotAt。
 */
export async function fetchScanLease(
  client: AxiosInstance,
  terminalId: string | undefined,
): Promise<ScanTaskLease | null> {
  if (!terminalId) return null
  try {
    const response = await client.get<{ success?: boolean; data?: ScanTaskLease }>(
      `/terminals/${terminalId}/scan-tasks/current-lease`,
      NO_RETRY_CONFIG as unknown as import('axios').AxiosRequestConfig,
    )
    const body = response.data as { success?: boolean; data?: ScanTaskLease } | undefined
    if (body && body.data && body.data.deliveryLease) {
      return body.data
    }
    return null
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status
    const code = (e as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code
    if (status === 409 || status === 404 || code === 'NO_WAITING_SCAN_TASK') {
      return null
    }
    throw e
  }
}

/**
 * 判定候选文件是否属于租约创建前已经存在的陈旧文件。
 */
export function isPreExistingCandidate(
  snapshot: { mtimeMs: number; birthtimeMs?: number },
  leaseNotBeforeIso: string,
  toleranceMs: number = SCAN_PRE_EXISTING_TOLERANCE_MS,
): boolean {
  const leaseNotBeforeMs = new Date(leaseNotBeforeIso).getTime()
  if (!Number.isFinite(leaseNotBeforeMs)) return false
  const barrierThresholdMs = leaseNotBeforeMs - toleranceMs

  // 1. 文件最后写入时间早于任务创建边界 -> 判定为前序任务残留
  if (snapshot.mtimeMs < barrierThresholdMs) {
    return true
  }

  // 2. NTFS 创建时间早于任务创建边界 -> 判定为前序任务残留
  if (snapshot.birthtimeMs !== undefined && Number.isFinite(snapshot.birthtimeMs) && snapshot.birthtimeMs > 0) {
    if (snapshot.birthtimeMs < barrierThresholdMs) {
      return true
    }
  }

  return false
}

/**
 * 内存目录观察基线，辅助记录文件初次被 Agent 发现的本地时间戳。
 */
export class ScanDirectoryBaseline {
  private readonly observedTimes = new Map<string, number>()

  recordObservation(filename: string, nowMs: number = Date.now()): void {
    if (!this.observedTimes.has(filename)) {
      this.observedTimes.set(filename, nowMs)
    }
  }

  remove(filename: string): void {
    this.observedTimes.delete(filename)
  }

  clear(): void {
    this.observedTimes.clear()
  }

  isPreExisting(
    filename: string,
    leaseNotBeforeMs: number,
    toleranceMs: number = SCAN_PRE_EXISTING_TOLERANCE_MS,
  ): boolean {
    const observedMs = this.observedTimes.get(filename)
    if (observedMs === undefined) return false
    return observedMs < leaseNotBeforeMs - toleranceMs
  }
}

export const globalDirectoryBaseline = new ScanDirectoryBaseline()
