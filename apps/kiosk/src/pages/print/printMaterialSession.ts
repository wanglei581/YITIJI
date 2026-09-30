import type { PrintJobParams } from '@ai-job-print/shared'
import type { DocumentProcessTaskView, MaterialTaskKind, MaterialTaskStatus } from '../../services/api/materials'

const STORAGE_KEY = 'ai-job-print:current-print-material-check'

export interface PrintFileState {
  name: string
  size: string
  pages: number | null
  fileId?: string
  fileUrl?: string
  fileMd5?: string
  mimeType?: string
}

export type PrintMaterialSource = 'resume' | 'document'

export function printUploadPathForSource(source?: PrintMaterialSource | null): string {
  return source === 'resume' ? '/print/upload?source=resume' : '/print/upload?source=document'
}

export interface StoredMaterialTask {
  id: string
  kind: MaterialTaskKind
  status: MaterialTaskStatus
  accessToken?: string
  sourceFileId?: string
  resultFileId?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  expiresAt?: string
  createdAt?: string
  updatedAt?: string
}

/**
 * 遮挡结论摘要 —— 下游打印页（预览 / 参数 / 确认）只能读这里，
 * 不允许各自按 findings 数量再编一句「遮挡 N 项」。
 * `claim` 为空表示后端没有给出可识别结论，下游一律按「本机未确认」处理。
 */
export interface MaterialRedactionSummary {
  /** 来自后端 claim；null = 未知 / 未产出结论（fail-closed）。 */
  claim: 'redacted_verified' | 'redacted_unverified' | 'partial' | 'not_supported' | 'nothing_to_redact' | null
  redactedFileId: string | null
  /** 逐项真实结果计数，不是笼统成功。 */
  appliedRedactedCount: number
  failedNoPositionCount: number
  keptCount: number
  /** 复检残留；null = 后端没给数字，不等于 0。 */
  reverifyRemainingCount: number | null
  reverifyRan: boolean
  /** 用户在强制预览页勾选「我核对过」的时间；为空表示没有经过人眼确认。 */
  previewConfirmedAt?: string
  /** 用户明确接受「不做遮挡直接打印原件」的时间。 */
  unredactedAcknowledgedAt?: string
}

export interface MaterialCheckSummary {
  inspectionTaskId: string
  normalizeTaskId?: string
  piiTaskId: string
  piiRedactTaskId?: string
  checkedAt: string
  findingCount: number
  /** 用户请求遮挡的数量（裁决结果），不代表真的盖上了。 */
  redactedCount: number
  keptCount: number
  redaction?: MaterialRedactionSummary
  mode: 'checked' | 'demo'
}

export type PrintMaterialContentCategory = 'photo'

/** 交接上下文的归属：游客，或「会员 + 本次登录在内存里生成的随机标记」。不存会员 id、手机号、令牌。 */
export type PrintHandoffOwner = { kind: 'guest' } | { kind: 'member'; mark: string }

/** 这一份打印前要不要先做材料检查（由来源决定，见 printHandoffPolicy）。 */
export type PrintCheckPolicy = 'required' | 'exempt'

/** 建单后打的标记：只记本单编号，同一份交接不能再建第二单。 */
export interface PrintHandoffOrderMark {
  orderId: string | null
  taskId: string | null
  orderedAt: string
}

/**
 * 打印交接上下文（v2，商用收口 P0-5）。同一个 sessionStorage 位置，原「打印材料会话」升级而来：
 * 清场清单（登出、换人、闲置、屏保、换引导票、完成页）不用改，全部自动覆盖。
 * 只有来源能整份写入（printHandoff.beginPrintHandoff）；打印链各页只能按 contextId 打补丁。
 */
export interface PrintMaterialSession {
  v: 2
  contextId: string
  /** 细分来源（printHandoffPolicy 的 PrintHandoffOrigin）。 */
  origin: string
  file: PrintFileState
  /** 只决定「重新选文件」回简历打印还是文档打印。 */
  source?: PrintMaterialSource
  /** 站内路径（只有路径部分），给「回到上一步」用。 */
  returnPath?: string
  /** 打印链接自己的到期时间（从链接里的 expires 解析）；null = 未知，不拦。 */
  fileUrlExpiresAt: string | null
  owner: PrintHandoffOwner
  createdAt: string
  expiresAt: string
  checkPolicy: PrintCheckPolicy
  /** 来源给的参数建议（如两页以上建议双面），只是建议。 */
  paramsSuggestion?: Partial<PrintJobParams>
  /** 来自入口页面传递的内容类别提示（目前只有 'photo'）；仅作为审计字段随 pii_scan 请求持久化，不影响是否真实扫描。 */
  contentCategory?: PrintMaterialContentCategory
  /** 只有证件扫描或证件用途为 true。缺省就不是证件件。 */
  idDocument?: true
  inspectionTask?: StoredMaterialTask
  normalizeTask?: StoredMaterialTask
  piiTask?: StoredMaterialTask
  piiRedactTask?: StoredMaterialTask
  materialCheck?: MaterialCheckSummary
  /** 用户最后确定、并已与本机能力求交的参数。 */
  printParams?: PrintJobParams
  order?: PrintHandoffOrderMark
  updatedAt: string
}

function isBrowserStorageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isPrintFileState(value: unknown): value is PrintFileState {
  if (!isRecord(value)) return false
  return (
    typeof value['name'] === 'string' &&
    typeof value['size'] === 'string' &&
    (typeof value['pages'] === 'number' || value['pages'] === null)
  )
}

function isMaterialTaskKind(value: unknown): value is MaterialTaskKind {
  return (
    value === 'inspection' ||
    value === 'normalize_a4' ||
    value === 'pii_scan' ||
    value === 'pii_redact' ||
    value === 'bundle_render'
  )
}

function isMaterialTaskStatus(value: unknown): value is MaterialTaskStatus {
  return (
    value === 'pending' ||
    value === 'processing' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  )
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === null) return null
  return optionalString(value)
}

function sanitizeFile(file: PrintFileState): PrintFileState {
  return {
    name: sanitizeFileName(file.name),
    size: file.size,
    pages: file.pages,
    fileId: file.fileId,
    fileUrl: file.fileUrl,
    fileMd5: file.fileMd5,
    mimeType: file.mimeType,
  }
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (value) => {
      const [, domain] = value.split('@')
      return `${value.slice(0, 1)}***@${domain ?? '***'}`
    })
    .replace(/(?:\+?86[- ]?)?1[3-9]\d{9}/g, (value) => `${value.slice(0, 3)}****${value.slice(-4)}`)
    .replace(/\d{6}(?:19|20)\d{2}\d{2}\d{2}\d{3}[\dXx]/g, (value) => `${value.slice(0, 6)}********${value.slice(-4)}`)
}

function toStoredMaterialTask(task: DocumentProcessTaskView | StoredMaterialTask | undefined): StoredMaterialTask | undefined {
  if (!task || !isRecord(task)) return undefined
  if (!optionalString(task['id']) || !isMaterialTaskKind(task['kind']) || !isMaterialTaskStatus(task['status'])) {
    return undefined
  }
  return {
    id: task['id'],
    kind: task['kind'],
    status: task['status'],
    accessToken: optionalString(task['accessToken']),
    sourceFileId: optionalString(task['sourceFileId']),
    resultFileId: optionalNullableString(task['resultFileId']),
    errorCode: optionalNullableString(task['errorCode']),
    errorMessage: optionalNullableString(task['errorMessage']),
    expiresAt: optionalString(task['expiresAt']),
    createdAt: optionalString(task['createdAt']),
    updatedAt: optionalString(task['updatedAt']),
  }
}

function sanitizeOwner(owner: unknown): PrintHandoffOwner | null {
  if (!isRecord(owner)) return null
  if (owner['kind'] === 'guest') return { kind: 'guest' }
  if (owner['kind'] === 'member' && typeof owner['mark'] === 'string' && owner['mark'].length >= 8) {
    return { kind: 'member', mark: owner['mark'] }
  }
  return null
}

function sanitizeOrder(order: unknown): PrintHandoffOrderMark | undefined {
  if (!isRecord(order) || typeof order['orderedAt'] !== 'string') return undefined
  return {
    orderId: optionalString(order['orderId']) ?? null,
    taskId: optionalString(order['taskId']) ?? null,
    orderedAt: order['orderedAt'],
  }
}

/** 保存时按白名单过滤字段：不认识的键（会员 id、令牌、昵称……）一律不落盘。 */
function sanitizeSession(next: PrintMaterialSession): PrintMaterialSession {
  return {
    v: 2,
    contextId: next.contextId,
    origin: next.origin,
    file: sanitizeFile(next.file),
    source: next.source === 'resume' || next.source === 'document' ? next.source : undefined,
    returnPath: next.returnPath,
    fileUrlExpiresAt: next.fileUrlExpiresAt,
    owner: sanitizeOwner(next.owner) ?? { kind: 'guest' },
    createdAt: next.createdAt,
    expiresAt: next.expiresAt,
    checkPolicy: next.checkPolicy === 'exempt' ? 'exempt' : 'required',
    paramsSuggestion: next.paramsSuggestion,
    contentCategory: next.contentCategory,
    ...(next.idDocument === true ? { idDocument: true as const } : {}),
    inspectionTask: toStoredMaterialTask(next.inspectionTask),
    normalizeTask: toStoredMaterialTask(next.normalizeTask),
    piiTask: toStoredMaterialTask(next.piiTask),
    piiRedactTask: toStoredMaterialTask(next.piiRedactTask),
    materialCheck: next.materialCheck,
    printParams: next.printParams,
    order: sanitizeOrder(next.order),
    updatedAt: next.updatedAt,
  }
}

const isIsoDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))

/** v2 结构校验：旧结构（没有 v、contextId、归属、有效期）一律不认。 */
function isStoredHandoff(value: unknown): value is PrintMaterialSession {
  if (!isRecord(value) || value['v'] !== 2) return false
  if (typeof value['contextId'] !== 'string' || value['contextId'].length < 8) return false
  if (typeof value['origin'] !== 'string' || !value['origin']) return false
  if (!isPrintFileState(value['file'])) return false
  const file = value['file'] as unknown as Record<string, unknown>
  if (!optionalString(file['fileId']) || !optionalString(file['fileUrl'])) return false
  if (!sanitizeOwner(value['owner'])) return false
  if (!isIsoDate(value['createdAt']) || !isIsoDate(value['expiresAt'])) return false
  if (value['fileUrlExpiresAt'] !== null && !isIsoDate(value['fileUrlExpiresAt'])) return false
  return value['checkPolicy'] === 'required' || value['checkPolicy'] === 'exempt'
}

export type StoredHandoffRead =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'ok'; value: PrintMaterialSession }

/** 只读存储并校验结构；归属、有效期由 printHandoff 判。结构不对时不在这里清（调用方决定）。 */
export function readStoredPrintHandoff(): StoredHandoffRead {
  if (!isBrowserStorageAvailable()) return { status: 'none' }
  let raw: string | null
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return { status: 'none' }
  }
  if (!raw) return { status: 'none' }
  try {
    const parsed = JSON.parse(raw) as unknown
    return isStoredHandoff(parsed) ? { status: 'ok', value: parsed } : { status: 'invalid' }
  } catch {
    return { status: 'invalid' }
  }
}

/** 整份写入（已过白名单）。写不进返回 false —— 调用方必须如实告诉用户，不能静默退回临时状态。 */
export function writeStoredPrintHandoff(next: PrintMaterialSession): boolean {
  if (!isBrowserStorageAvailable()) return false
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeSession(next)))
    return true
  } catch {
    return false
  }
}

export function clearPrintMaterialSession(): void {
  if (!isBrowserStorageAvailable()) return
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
