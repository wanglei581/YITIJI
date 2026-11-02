export const SCAN_STAGES = ['start', 'how', 'device-settings', 'settings', 'progress', 'result'] as const

export type ScanStage = (typeof SCAN_STAGES)[number]

export function parseScanStage(raw: string | null): ScanStage | null {
  if (raw == null) return null
  return (SCAN_STAGES as readonly string[]).includes(raw) ? (raw as ScanStage) : null
}

export function isScanStageAuthorized(
  stage: ScanStage,
  hasLiveSession: boolean,
  hasResult: boolean,
  hasMaterialContext = false,
): boolean {
  if (stage === 'start' || stage === 'settings') return true
  if (stage === 'how' || stage === 'device-settings') {
    return hasMaterialContext && !hasLiveSession && !hasResult
  }
  if (stage === 'progress') return hasLiveSession
  if (stage === 'result') return hasResult
  return false
}

/**
 * URL `?stage=` 是意图，不是授权。
 * 没有扫描会话时，progress / result 即使写在 URL 里也不能落地。
 * 没有 stage 时从 sessionStorage 复水。
 */
export function resolveScanView(args: {
  requested: ScanStage | null
  storedStage: ScanStage | null
  hasLiveSession: boolean
  hasResult: boolean
  /** how / device-settings 必须带着这一次选中的材料。没有就退回选材料。 */
  hasMaterialContext?: boolean
  /**
   * 登录回跳只带着材料记号。它只够打开「怎么扫」，不够打开放纸设置。
   * 有进行中的扫描或结果时，记号也不算数。
   */
  hasHowContinue?: boolean
}): ScanStage {
  const intended = args.requested ?? args.storedStage ?? 'start'
  const quiet = !args.hasLiveSession && !args.hasResult
  if (intended === 'how' && quiet && (args.hasMaterialContext === true || args.hasHowContinue === true)) {
    return 'how'
  }
  if (isScanStageAuthorized(intended, args.hasLiveSession, args.hasResult, args.hasMaterialContext === true)) {
    return intended
  }
  if (intended === 'result' && args.hasLiveSession) return 'progress'
  return 'start'
}
