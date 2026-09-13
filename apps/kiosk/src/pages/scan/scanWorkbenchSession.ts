import { isScanType, type ScanType } from './scanWorkbench'
import { parseScanStage, type ScanStage } from './scanWorkbenchModel'

export const SCAN_WORKBENCH_SESSION_KEY = 'ai-job-print:current-scan-workbench'

/**
 * 本机这一场扫描的「代次」。只活在页面内存里，不落存储。
 *
 * ## 它防的是哪一件事
 *
 * `POST /scan/sessions` 在飞的那一刻，本机登记里**还没有** live —— 所以清场
 * （隐私空闲 / 退出 / 屏保 / 离开扫描流程）走到 `revokeLiveScanSession` 时读不到
 * 任何可撤的东西，只能把本地那份抹掉。等创建响应回来，持有响应的那一方照旧
 * `patchScanWorkbenchSession({ live })`，于是**刚被清掉的那一位用户的收件箱又被立了
 * 起来**：服务端任务停在 waiting，下一位在面板上按下扫描，文件就投给了上一位。
 *
 * 代次就是这条竞态的判据：创建方发请求前取一份，响应回来时再比一次。不相等
 * 说明「我属于上一场」—— 既不许回写存储，也不许把服务端任务留成孤儿
 * （由创建方用手里那份凭证撤掉，见 `revokeCreatedScanSession`）。
 *
 * ## 为什么是同步的、为什么必须排在删除之前
 *
 * barrier 的全部意义就是**它比异步响应先落地**。`endScanLifecycle()` 只是一个
 * 自增，没有 await、没有存储 IO，所以它一定先于任何还在飞的请求回来；而把它排在
 * `removeItem` / 写回之前，保证「存储被动过」与「代次已推进」之间不存在中间态。
 */
let lifecycleGeneration = 0

/** 取当前代次。发出创建请求之前取一份，响应回来时比对。 */
export function scanLifecycleGeneration(): number {
  return lifecycleGeneration
}

/**
 * 宣告「这一场扫描到此为止」。
 *
 * 两个调用点，都在改存储**之前**：清空登记（`clearScanWorkbenchSession`）、
 * 显式抹掉 live（`patchScanWorkbenchSession` 的 `live: undefined`）。
 * 刻意不导出：谁能宣告一场扫描结束，由本模块的两个入口决定，不开放给业务页各自发挥。
 */
function endScanLifecycle(): void {
  lifecycleGeneration += 1
}

export interface ScanLiveState {
  scanTaskId: string
  controlToken: string
  instructions: string[]
  expiresAt: string
}

export interface ScanResultFile {
  fileId: string
  fileUrl: string
  name: string
  size: string
  pages: number | null
  format: string
  mimeType?: string
}

export type ScanOutcome = 'completed' | 'completed-no-file' | 'failed' | 'expired'

export interface ScanResultSnapshot {
  outcome: ScanOutcome
  success: boolean
  reason?: string
  file?: ScanResultFile
}

export interface ScanRetryExtras {
  source?: string
  pageMode?: string
  color?: string
  dpi?: number
}

export interface ScanWorkbenchSession {
  stage: ScanStage
  scanType?: ScanType
  extras?: ScanRetryExtras
  live?: ScanLiveState
  result?: ScanResultSnapshot
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseLive(raw: unknown): ScanLiveState | undefined {
  if (!isRecord(raw)) return undefined
  if (typeof raw.scanTaskId !== 'string' || raw.scanTaskId.trim().length === 0) return undefined
  if (typeof raw.controlToken !== 'string' || raw.controlToken.trim().length === 0) return undefined
  if (typeof raw.expiresAt !== 'string' || !Number.isFinite(Date.parse(raw.expiresAt))) return undefined
  if (!Array.isArray(raw.instructions)) return undefined
  const instructions = raw.instructions.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  )
  return {
    scanTaskId: raw.scanTaskId,
    controlToken: raw.controlToken,
    instructions,
    expiresAt: raw.expiresAt,
  }
}

function parseResultFile(raw: unknown): ScanResultFile | undefined {
  if (!isRecord(raw) || typeof raw.fileId !== 'string' || typeof raw.fileUrl !== 'string') return undefined
  if (typeof raw.name !== 'string' || typeof raw.size !== 'string' || typeof raw.format !== 'string') return undefined
  return {
    fileId: raw.fileId,
    fileUrl: raw.fileUrl,
    name: raw.name,
    size: raw.size,
    pages: typeof raw.pages === 'number' ? raw.pages : null,
    format: raw.format,
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : undefined,
  }
}

function parseResult(raw: unknown): ScanResultSnapshot | undefined {
  if (!isRecord(raw)) return undefined
  const outcome = raw.outcome
  if (
    outcome !== 'completed'
    && outcome !== 'completed-no-file'
    && outcome !== 'failed'
    && outcome !== 'expired'
  ) {
    return undefined
  }
  return {
    outcome,
    success: raw.success === true,
    reason: typeof raw.reason === 'string' ? raw.reason : undefined,
    file: parseResultFile(raw.file),
  }
}

function parseExtras(raw: unknown): ScanRetryExtras | undefined {
  if (!isRecord(raw)) return undefined
  const extras: ScanRetryExtras = {}
  if (typeof raw.source === 'string') extras.source = raw.source
  if (typeof raw.pageMode === 'string') extras.pageMode = raw.pageMode
  if (typeof raw.color === 'string') extras.color = raw.color
  if (typeof raw.dpi === 'number') extras.dpi = raw.dpi
  return Object.keys(extras).length > 0 ? extras : undefined
}

export function readScanWorkbenchSession(): ScanWorkbenchSession | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null
    const raw = window.sessionStorage.getItem(SCAN_WORKBENCH_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return null
    const stage = parseScanStage(typeof parsed.stage === 'string' ? parsed.stage : null)
    if (!stage) return null
    return {
      stage,
      scanType: isScanType(parsed.scanType) ? parsed.scanType : undefined,
      extras: parseExtras(parsed.extras),
      live: parseLive(parsed.live),
      result: parseResult(parsed.result),
    }
  } catch {
    return null
  }
}

export function saveScanWorkbenchSession(session: ScanWorkbenchSession): void {
  try {
    window.sessionStorage.setItem(SCAN_WORKBENCH_SESSION_KEY, JSON.stringify(session))
  } catch {
    /* sessionStorage 不可用时不阻塞扫描 */
  }
}

export function patchScanWorkbenchSession(
  patch: Partial<ScanWorkbenchSession>,
): ScanWorkbenchSession {
  const current = readScanWorkbenchSession() ?? { stage: 'start' as const }
  // 显式把 live 抹掉 = 这一场扫描到此为止（安全返回 / 回到首页 / 重扫）。
  // 和清场同一个道理：之后才回来的创建响应不能再把 live 写回去。
  if ('live' in patch && patch.live === undefined) endScanLifecycle()
  const next: ScanWorkbenchSession = {
    stage: patch.stage ?? current.stage,
    scanType: 'scanType' in patch ? patch.scanType : current.scanType,
    extras: 'extras' in patch ? patch.extras : current.extras,
    live: 'live' in patch ? patch.live : current.live,
    result: 'result' in patch ? patch.result : current.result,
  }
  saveScanWorkbenchSession(next)
  return next
}

export function clearScanWorkbenchSession(): void {
  // 顺序不可调换：代次必须在抹掉登记**之前**同步推进。清场之后才回来的创建响应
  // 靠它判断「我属于上一场」，从而既不回写登记，也不把服务端任务留成孤儿。
  // 反过来写会留出一个窗口：登记已空、代次还是旧的，那一刻回来的响应照样能写回去。
  endScanLifecycle()
  try {
    window.sessionStorage.removeItem(SCAN_WORKBENCH_SESSION_KEY)
  } catch {
    /* ignore */
  }
}

export function hasLiveScanSession(
  session: ScanWorkbenchSession | null,
  locationState?: { scanTaskId?: unknown; controlToken?: unknown } | null,
): boolean {
  if (session?.live?.scanTaskId && session.live.controlToken) return true
  return typeof locationState?.scanTaskId === 'string'
    && locationState.scanTaskId.length > 0
    && typeof locationState?.controlToken === 'string'
    && locationState.controlToken.length > 0
}

export function hasScanResult(
  session: ScanWorkbenchSession | null,
  locationState?: { outcome?: unknown; success?: unknown; file?: unknown; reason?: unknown } | null,
): boolean {
  if (session?.result) return true
  if (!locationState) return false
  if (typeof locationState.outcome === 'string') return true
  if (locationState.success === true || locationState.success === false) return true
  return Boolean(locationState.file) || typeof locationState.reason === 'string'
}
