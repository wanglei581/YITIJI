import type { ScanRescanAuthorization } from '@ai-job-print/shared'
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

/**
 * 当前这一场可用的一次性安全重扫授权，没有就是 null。
 * 声明提到这里，是因为 `endScanLifecycle()` 要在推进代次的同一步里把它扔掉；
 * 它是什么、什么时候登记、什么时候消失，见下方 `ScanRescanAuthority` 的注释。
 */
let rescanAuthority: ScanRescanAuthority | null = null

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
  rescanAuthority = null
}

/**
 * 一次性安全重扫授权（内存态）。
 *
 * ## 它是什么
 *
 * 上一场扫描在文件已经被取走（服务端 matched）之后失败 / 被取消 / 过期时，服务端会
 * 铸一枚 15 分钟的一次性授权：绑定用户 + 终端 + 扫描类型 + 那份内容的 hash + 上一场的
 * controlToken，CAS 消费一次。带着它创建的新任务才被允许把**同一份纸**再投一次，
 * 否则会撞上服务端 2 小时的同字节去重（`SCAN_FILE_PREVIOUSLY_ATTEMPTED`）。
 *
 * 本机这一份只是那枚授权的**取用凭据**，用来发请求，判定权始终在服务端。
 *
 * ## 为什么只活在内存里
 *
 * `priorControlToken` 是上一场任务的控制凭证明文。**这枚授权自己一个字节都不落存储**：
 * 不进 body、不进 query string、不写 localStorage / sessionStorage，只走
 * `X-Scan-Retry-Control` 头。写进 `ai-job-print:current-scan-workbench` 它就会跨刷新、
 * 跨用户活下来，而这台机器是公共设备。
 *
 * 但话要说完整，否则下一个读代码的人会以为这份凭证只存在于本模块内存里：**它的取用
 * 来源是既有的 live 登记**（`live.controlToken`），而那份登记为了让看门狗重载之后还能
 * 继续轮询同一场扫描，本来就写在 sessionStorage 里（`ScanSettingsPage` 写、
 * `ScanProgressPage` 复水）。所以真实的存活边界是：
 *   · 结果页整页重载之后，授权会按同一份 live 登记**重新登记**（不是丢失）；
 *   · 让这份凭证真正消失的是清场 —— `clearScanWorkbenchSession()` 同一步抹掉 live 登记
 *     和本模块这枚授权，隐私空闲 / 屏保 / 退出 / 换人 / 离开扫描流程全走那一条。
 * 设置页那边没有这条复水：整页重载之后它说不出「这一场当初是不是安全重扫」，
 * 所以它什么都不宣称，只如实说「本机无从判断」。
 *
 * ## 它什么时候消失
 *
 * 任何一次代次推进都会把它扔掉（见 `endScanLifecycle`）：清场、退出、屏保、离开扫描
 * 流程、安全返回、明确放弃，全都走那条。**唯一**允许它跨越代次的入口是
 * `beginScanRescan()` —— 那是用户按下「重试扫描」的那一刻，取出、推进代次、按新代次
 * 重新登记三件事在同一个同步块里做完，中间没有第二段可写入的窗口。
 */
export interface ScanRescanAuthority {
  priorScanTaskId: string
  priorControlToken: string
  scanType: ScanType
  /** 铸下这份授权时的扫描代次。代次一变它就作废。 */
  generation: number
  /** 本机记下的登记时刻，用于本地有效期判断。 */
  armedAtMs: number
}

/**
 * 本地有效期，与服务端 `SCAN_RETRY_AUTHORITY_TTL_MS`（15 分钟）取同一个值。
 *
 * 刻意不取更短：短了会在服务端其实还认的时候把授权扔掉，用户被静默降级成普通重扫，
 * 正是这次要修的那个缺陷。也不取更长：长了只会多发一次注定被 403 的请求。
 * 两边都不是判定方 —— 服务端才是，这里只是不把明显已经过期的凭据再发出去。
 */
export const SCAN_RESCAN_AUTHORITY_TTL_MS = 15 * 60 * 1000

/** 校验「这份授权此刻还能不能用」：同一代次、同一扫描类型、未超本地有效期。 */
function usableRescanAuthority(scanType: ScanType): ScanRescanAuthority | null {
  const authority = rescanAuthority
  if (!authority) return null
  if (authority.generation !== lifecycleGeneration) return null
  if (authority.scanType !== scanType) return null
  if (Date.now() - authority.armedAtMs >= SCAN_RESCAN_AUTHORITY_TTL_MS) return null
  return authority
}

/**
 * 登记一枚可能存在的重扫授权。
 *
 * 由结果页在**服务端可能真的铸过授权**的终态上调用（failed / expired）。成功、
 * 「完成但没带文件」这两种终态一律不登记 —— 那两种任务服务端已经建了档（fileId 非空），
 * 按契约根本不会发授权，登记只会让下一次白发一个必然 403 的请求。
 *
 * @returns 是否登记成功（凭据齐全才登记）。
 */
export function armScanRescanAuthority(input: {
  priorScanTaskId: string
  priorControlToken: string
  scanType: ScanType
}): boolean {
  if (input.priorScanTaskId.trim().length === 0) return false
  if (input.priorControlToken.trim().length === 0) return false
  const resident = rescanAuthority
  // 同一场重复登记必须**保留原来的 armedAtMs**。结果页每次挂载都会走一遍这里
  // （React 重渲染、阶段来回切），按 Date.now() 重新计时就是「回一次结果页续 15 分钟」，
  // 而服务端那枚授权是从它铸出来的那一刻开始算的 —— 本机的窗口只能比它短，不能比它长。
  //
  // 整页重载是这条幂等管不到的一种情况：模块内存连 resident 都没了，只能重新计时。
  // 那种情况下本机窗口会比服务端的长一截，而这个方向是可以接受的那一边 ——
  // 判定方始终是服务端：窗口估长，代价是多发一次注定 403 的请求，页面当场如实说明；
  // 窗口估短，用户会被本机判成「没有授权」，拿着同一张纸去撞那条两小时的同字节去重，
  // 白等十分钟且屏幕上看不见原因。
  const armedAtMs = resident
    && resident.priorScanTaskId === input.priorScanTaskId
    && resident.scanType === input.scanType
    && resident.generation === lifecycleGeneration
    ? resident.armedAtMs
    : Date.now()
  rescanAuthority = {
    priorScanTaskId: input.priorScanTaskId,
    priorControlToken: input.priorControlToken,
    scanType: input.scanType,
    generation: lifecycleGeneration,
    armedAtMs,
  }
  return true
}

/** 只问「现在还有没有可用的授权」，不消费。供页面决定文案与按钮，不参与发请求。 */
export function hasScanRescanAuthority(scanType: ScanType): boolean {
  return usableRescanAuthority(scanType) !== null
}

/**
 * 取走授权（**一次性**：取过就没了，无论这次请求成不成功）。
 *
 * 取不到就是取不到，本模块不会替调用方造一份 —— 调用方拿到 null 时发的是普通创建，
 * 页面必须如实说清那不是安全重扫。
 */
export function takeScanRescanAuthority(scanType: ScanType): ScanRescanAuthorization | null {
  const authority = usableRescanAuthority(scanType)
  rescanAuthority = null
  if (!authority) return null
  return {
    retryOfScanTaskId: authority.priorScanTaskId,
    priorControlToken: authority.priorControlToken,
  }
}

/** 明确扔掉授权（成功终态、离开、换人）。不导出给业务页随手调也没关系：它是幂等的。 */
export function clearScanRescanAuthority(): void {
  rescanAuthority = null
}

/**
 * 「重试扫描（同一份材料）」：结束这一场，并把它那枚一次性授权移交给下一场。
 *
 * ## 拿不到授权就**什么都不做**
 *
 * 第一句是 `if (!carried) return false` —— 在动任何东西之前。这不是风格问题：
 * 早先的版本先 patch（`live: undefined` 抹掉本机唯一那份 scanTaskId + controlToken、
 * 顺手清掉结果快照）再判断有没有授权，于是「拿不到授权」这条路径会把用户这一场的
 * 全部凭证销毁掉，然后返回 false。调用方即使老老实实看返回值，也已经没有东西可退回 ——
 * 结果页连那张失败回执都显示不出来，服务端那个任务也再没人能撤。
 *
 * 所以现在：没有可用的成对授权 → 一个字节都不改，返回 false。要不要改发一个**普通**
 * 新会话，是用户在结果页上显式按下「重新开始一次扫描」的事（`beginPlainScanRestart`），
 * 不是这个函数悄悄替他决定的。
 *
 * ## 有授权时，三步必须在同一个同步块里按序做完
 *
 *   1. 先取出（校验代次 / 类型 / 有效期），随即清空槽位；
 *   2. 推进代次并写回登记（`patchScanWorkbenchSession` 的 `live: undefined` 分支），
 *      这一步会再清一次槽位 —— 已经是空的，所以移交不会被自己清掉；
 *   3. 按**新**代次重新登记，`armedAtMs` 原样带走：移交不延长有效期，
 *      否则用户反复点「重试扫描」就能把一枚 15 分钟的授权无限续下去。
 *
 * 顺序反了（先 patch 再取）授权会在第 2 步被自己清空，重扫就静默退化成普通新会话；
 * `verify:scan-session-truth` 把这段顺序和上面那个早退一起钉住了。
 *
 * `rescanIntent: true` 是写给**整页重载之后**的那一帧看的：凭据只活在内存里，重载就
 * 没了，而设置页必须知道「这一场是带着重扫意图进来的」才能 fail-closed，
 * 不然它会照常发一个普通创建。它只是一个布尔，不是凭证。
 */
export function beginScanRescan(args: { scanType: ScanType; extras?: ScanRetryExtras }): boolean {
  const carried = usableRescanAuthority(args.scanType)
  if (!carried) return false
  rescanAuthority = null
  patchScanWorkbenchSession({
    stage: 'settings',
    scanType: args.scanType,
    extras: args.extras,
    live: undefined,
    result: undefined,
    rescanIntent: true,
  })
  rescanAuthority = { ...carried, generation: lifecycleGeneration }
  return true
}

/**
 * 「重新开始一次扫描」——**不是**安全同字节重扫，由用户在页面上显式按下。
 *
 * 它和 `beginScanRescan` 的区别就是这次修复的全部要点：安全重扫拿不到授权时不许
 * 自动退化成这一条。同一张纸走这一条，服务端那两小时的同字节去重会把回传的文件
 * 原样拒掉，任务停在 waiting 直到过期 —— 用户在机器前白等十分钟，屏幕上看不见原因。
 * 所以页面必须先把代价说清楚，再让用户自己选；选了就走这里。
 *
 * 明确清掉两样东西：槽位里任何残留的授权（这一场声明过「我不做安全重扫」），
 * 以及登记里那笔 `rescanIntent`（否则设置页会对着一场普通会话 fail-closed）。
 */
export function beginPlainScanRestart(args: { scanType: ScanType; extras?: ScanRetryExtras }): void {
  rescanAuthority = null
  patchScanWorkbenchSession({
    stage: 'settings',
    scanType: args.scanType,
    extras: args.extras,
    live: undefined,
    result: undefined,
    rescanIntent: undefined,
  })
}

/**
 * 「本页带着安全重扫意图进来，凭据却已经不在内存里」——设置页据此 fail-closed。
 *
 * 唯一的成因是**整页重载**：授权只活在模块内存里（刻意的，见 `ScanRescanAuthority`），
 * 看门狗一重载就没了，而登记里那笔 `rescanIntent` 还在。会话已经建成之后再重载不算
 * （那时 `restoredLive` 能复水，本页根本不会再创建）。
 *
 * 判 true 时页面**绝不能**改发普通创建：用户按的是「同一份材料」，服务端会按同字节
 * 去重把文件拒掉，人在机器前白等十分钟。出路只有一个显式动作（重新开始一次扫描，
 * 并且把它不是安全重扫这件事说出来）。
 */
export function scanRescanCredentialsLost(args: {
  session: ScanWorkbenchSession | null
  scanType: ScanType | null
  /** 本页复水出来的那份 live（必须是**校验过有效期**的那一份，不是 session.live 原样）。 */
  restoredLive: ScanLiveState | null
}): boolean {
  if (args.session?.rescanIntent !== true) return false
  if (!args.scanType) return false
  if (args.restoredLive) return false
  return !hasScanRescanAuthority(args.scanType)
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
  /**
   * 这一场是带着「安全重扫意图」进来的。**只是一个布尔，不含任何凭证** ——
   * 凭据（上一场的 controlToken 明文）依旧只活在内存里，一个字节都不落存储。
   *
   * 它存在的唯一理由是整页重载：重载把内存里的授权抹掉，而用户还站在机器前、
   * 手里还是同一张纸。设置页靠这一位判 fail-closed（见 `scanRescanCredentialsLost`），
   * 否则它会照常发一个普通创建，把用户支到面板前去扫一张注定被去重拒收的纸。
   *
   * 它**不许比自己那一场活得久**：任何一次生命周期终结（`live: undefined` 的 patch、
   * 清场）都会把它一起抹掉，见 `patchScanWorkbenchSession`。否则「安全返回扫描首页」
   * 之后重新选类型开一场普通扫描，会被这一位误判成 fail-closed —— 好功能被一个
   * 过期标记锁死。
   */
  rescanIntent?: boolean
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
      // 只认真正的 true：存储里任何别的值（字符串 'false'、1、被人手改过的字节）
      // 都不足以把一场扫描锁进 fail-closed。
      rescanIntent: parsed.rescanIntent === true ? true : undefined,
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
  const lifecycleEnding = 'live' in patch && patch.live === undefined
  if (lifecycleEnding) endScanLifecycle()
  const next: ScanWorkbenchSession = {
    stage: patch.stage ?? current.stage,
    scanType: 'scanType' in patch ? patch.scanType : current.scanType,
    extras: 'extras' in patch ? patch.extras : current.extras,
    live: 'live' in patch ? patch.live : current.live,
    result: 'result' in patch ? patch.result : current.result,
    // 「安全重扫意图」不许比它所属的那一场活得久：写了就按写的（beginScanRescan 会在
    // 同一笔 patch 里把它立起来），这一笔是生命周期终结就一并抹掉，其余情况原样留着。
    // 少了后半句，「安全返回扫描首页」之后开的那场普通扫描会继承一个过期的意图，
    // 被设置页 fail-closed 锁死 —— 防线错杀正常路径，比没有防线更糟。
    rescanIntent: 'rescanIntent' in patch
      ? patch.rescanIntent
      : lifecycleEnding
        ? undefined
        : current.rescanIntent,
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
