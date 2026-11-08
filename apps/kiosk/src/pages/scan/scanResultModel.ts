import type { ScanType } from './scanWorkbench'
import type { ScanOutcome } from './scanWorkbenchSession'

/**
 * 结果页用的类型与结果判定。
 *
 * 2026-11-02 K1a 从 `ScanResultPage.tsx` 搬来（页面 512 行，往里再加屏上扫描的结果之前先按职责拆开）。
 * 三样都是原文，只在声明前加了 `export`。
 */
export interface ScannedFile {
  fileId: string
  fileUrl: string
  name: string
  size: string
  pages: number | null
  format: string
  mimeType?: string
}

export interface ScanResultState {
  scanType?: ScanType
  source?: string
  pageMode?: string
  color?: string
  dpi?: number
  success?: boolean
  reason?: string
  outcome?: ScanOutcome
  file?: ScannedFile
}

export function deriveOutcome(state: ScanResultState): ScanOutcome {
  if (state.outcome) return state.outcome
  if (state.success === true && state.file) return 'completed'
  if (state.reason?.includes('未拿到文件')) return 'completed-no-file'
  if (state.reason?.includes('超时') || state.reason?.includes('过期')) return 'expired'
  return 'failed'
}
