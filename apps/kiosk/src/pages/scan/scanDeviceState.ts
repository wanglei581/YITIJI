import type { ScanSessionStatusResponse } from '@ai-job-print/shared'

/** 云端回报的整页。0、缺省、小数都不算「已收到 N 页」。 */
export function reportedPageCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null
}

/** 老服务端不带这一项时不编一个 20 或 50。 */
export function readDeviceMaxPages(status: object): number | null {
  const raw = (status as { deviceMaxPages?: unknown }).deviceMaxPages
  return reportedPageCount(raw)
}

export interface DeviceTerminalResult {
  outcome: 'completed' | 'completed-no-file' | 'failed' | 'expired'
  success: boolean
  reason?: string
  pages: number | null
}

export type DeviceScreen =
  | { kind: 'error'; fault: DeviceFault }
  | { kind: 'unknown'; tone: 'unreachable' | 'unconfirmed' }
  | { kind: 'run'; pages: number | null; scannerStarted: boolean }
  | { kind: 'more'; pages: number | null; maxPages: number | null }
  | { kind: 'make'; phase: 'composing' | 'delivering'; pages: number | null }
  | { kind: 'terminal'; result: DeviceTerminalResult }

export type DeviceFault = 'nopaper' | 'jam' | 'busy' | 'noresp' | 'timeout'

export function deviceFault(code: string | null | undefined): DeviceFault | null {
  if (code === 'feeder_empty') return 'nopaper'
  if (code === 'paper_jam' || code === 'cover_open') return 'jam'
  if (code === 'busy') return 'busy'
  if (code === 'not_found' || code === 'error' || code === 'not_ready') return 'noresp'
  if (code === 'timeout') return 'timeout'
  return null
}

function usableFile(file: ScanSessionStatusResponse['file']): boolean {
  if (!file) return false
  return file.fileId.trim().length > 0
    && file.fileUrl.trim().length > 0
    && file.filename.trim().length > 0
    && typeof file.sizeBytes === 'number'
    && file.mimeType.trim().length > 0
}

function sourceOf(status: ScanSessionStatusResponse): 'flatbed' | 'feeder' | null {
  if (status.deviceSource === 'flatbed' || status.deviceSource === 'feeder') return status.deviceSource
  return null
}

/**
 * 云端状态决定屏。本机回包不确定时，只有云端已经进入扫描 / 翻页 / 合成才盖过「状态未知」。
 * 没有 completed 且带着可用文件，不会给出完成。
 */
export type DeviceUncertainCommand = 'start' | 'next' | 'finish' | 'stop'

/** 本机这一步还没被云端状态接上时，不许按云端旧状态继续给按钮。 */
export function uncertaintyBlocks(
  command: DeviceUncertainCommand | null,
  deviceState: string | null,
): boolean {
  if (!command) return false
  if (command === 'start') {
    return deviceState !== 'scanning'
      && deviceState !== 'page_ready'
      && deviceState !== 'composing'
      && deviceState !== 'delivering'
  }
  if (command === 'next') {
    return deviceState !== 'scanning' && deviceState !== 'composing' && deviceState !== 'delivering'
  }
  if (command === 'finish') {
    return deviceState !== 'composing' && deviceState !== 'delivering'
  }
  return true
}

export function selectDeviceScreen(input: {
  status: ScanSessionStatusResponse | null
  cloudUnreadable: boolean
  startConfirmed: boolean
  /** 这一页里 start 还在飞。整页重载之后这一位是假的，不许靠它假装还在等。 */
  startInFlight?: boolean
  localUncertain: 'unreachable' | 'unknown' | null
  uncertainCommand?: DeviceUncertainCommand | null
}): DeviceScreen {
  const status = input.status
  const uncertain = input.localUncertain
  const waitingForStart = input.startConfirmed || input.startInFlight === true
  if (!status) {
    if (input.cloudUnreadable || uncertain === 'unreachable') return { kind: 'unknown', tone: 'unreachable' }
    if (uncertain || !waitingForStart) return { kind: 'unknown', tone: 'unconfirmed' }
    return { kind: 'run', pages: null, scannerStarted: false }
  }

  const pages = reportedPageCount(status.devicePageCount)
  const tone = uncertain === 'unreachable' || input.cloudUnreadable ? 'unreachable' as const : 'unconfirmed' as const
  // 停止任何一边未确认时，云端终态也不能替本机 abort 作证。
  if (input.uncertainCommand === 'stop') return { kind: 'unknown', tone }
  if (status.status === 'completed') {
    return {
      kind: 'terminal',
      result: usableFile(status.file)
        ? { outcome: 'completed', success: true, pages }
        : { outcome: 'completed-no-file', success: false, pages: null },
    }
  }
  if (status.status === 'expired') {
    return {
      kind: 'terminal',
      result: { outcome: 'expired', success: false, reason: '等待超时，这次没有拿到文件。', pages: null },
    }
  }
  if (status.status === 'failed' || status.status === 'cancelled') {
    return {
      kind: 'terminal',
      result: {
        outcome: 'failed',
        success: false,
        reason: status.status === 'cancelled'
          ? '已停止扫描。这次到这里为止，不会再继续。'
          : '这次扫描没有完成。',
        pages: null,
      },
    }
  }

  const deviceState = status.deviceState ?? null
  if (uncertain && input.uncertainCommand === 'start' && deviceState === 'error') return { kind: 'unknown', tone }
  if (deviceState === 'error') {
    const code = status.deviceErrorCode ?? null
    const fault = deviceFault(code)
    if (fault) return { kind: 'error', fault }
    // 本批五屏以外的既有已知故障仍保留 K1b-2 行为，未知码仍是状态未知。
    if (code === 'warming_up' || code === 'too_large') {
      return {
        kind: 'terminal',
        result: {
          outcome: 'failed', success: false, pages: null,
          reason: code === 'warming_up' ? '扫描仪还在预热。这次先停在这里。' : '这一次超过了这台机器能收的大小。这次先停在这里。',
        },
      }
    }
    return { kind: 'unknown', tone: 'unconfirmed' }
  }
  if (deviceState === 'aborted') {
    return {
      kind: 'terminal',
      result: {
        outcome: 'failed',
        success: false,
        reason: '已停止扫描。这次到这里为止，不会再继续。',
        pages: null,
      },
    }
  }
  if (status.status === 'matched') {
    return { kind: 'make', phase: 'delivering', pages }
  }
  if (
    uncertain
    && uncertaintyBlocks(input.uncertainCommand ?? null, deviceState)
  ) {
    return { kind: 'unknown', tone }
  }
  if (deviceState === 'scanning') return { kind: 'run', pages, scannerStarted: true }
  if (deviceState === 'page_ready' && sourceOf(status) === 'flatbed') {
    return { kind: 'more', pages, maxPages: readDeviceMaxPages(status) }
  }
  if (deviceState === 'page_ready') return { kind: 'unknown', tone: 'unconfirmed' }
  if (deviceState === 'composing' || deviceState === 'delivering') {
    return { kind: 'make', phase: deviceState, pages }
  }

  if (input.cloudUnreadable || uncertain) {
    return { kind: 'unknown', tone }
  }
  if (waitingForStart && (deviceState === 'ready' || deviceState === null)) {
    return { kind: 'run', pages: null, scannerStarted: false }
  }
  return { kind: 'unknown', tone: 'unconfirmed' }
}
