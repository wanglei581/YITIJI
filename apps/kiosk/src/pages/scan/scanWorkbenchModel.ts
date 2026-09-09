export const SCAN_STAGES = ['start', 'settings', 'progress', 'result'] as const

export type ScanStage = (typeof SCAN_STAGES)[number]

export function parseScanStage(raw: string | null): ScanStage | null {
  if (raw === 'start' || raw === 'settings' || raw === 'progress' || raw === 'result') {
    return raw
  }
  return null
}

export function isScanStageAuthorized(
  stage: ScanStage,
  hasLiveSession: boolean,
  hasResult: boolean,
): boolean {
  if (stage === 'start' || stage === 'settings') return true
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
}): ScanStage {
  const intended = args.requested ?? args.storedStage ?? 'start'
  if (isScanStageAuthorized(intended, args.hasLiveSession, args.hasResult)) {
    return intended
  }
  if (intended === 'result' && args.hasLiveSession) return 'progress'
  return 'start'
}
