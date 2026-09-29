// 打印交接上下文（商用收口 P0-5 第二、三批）。
//
// 同一份打印文件以前有两个来源、两种相反的读法：打印台和预览信「打印材料会话」，报价确认页信跳转时带的
// 临时状态。临时状态一丢（登录回跳、返回预览、旧地址重定向），页面就退回会话里那一份 —— 可能是上一位的。
// 现在只有一处：来源整份写入（beginPrintHandoff），跳转只带交接编号；打印链各页只认这里，并校验归属、有效期。
// 规格：docs/reviews/print-handoff-unification-2026-09-28.md 第 3 节与「协调方裁定」。
//
// 本文件只许 import printMaterialSession 与 printHandoffPolicy（单元测试直接转译它）。

import type { PrintJobParams } from '@ai-job-print/shared'
import type { DocumentProcessTaskView } from '../../services/api/materials'
import {
  clearPrintMaterialSession,
  readStoredPrintHandoff,
  writeStoredPrintHandoff,
  type MaterialCheckSummary,
  type PrintFileState,
  type PrintHandoffOrderMark,
  type PrintHandoffOwner,
  type PrintMaterialContentCategory,
  type PrintMaterialSession,
  type PrintMaterialSource,
  type StoredMaterialTask,
} from './printMaterialSession'
import {
  printHandoffEntryPath,
  printHandoffPolicyFor,
  type PrintHandoffEntry,
  type PrintHandoffOrigin,
} from './printHandoffPolicy'

export type PrintHandoffContext = PrintMaterialSession
export type { PrintHandoffOwner, PrintHandoffOrigin, PrintHandoffEntry }

/** 创建后 30 分钟封顶，与一体机上传、图片转换的签名链接一致。 */
export const PRINT_HANDOFF_TTL_MS = 30 * 60 * 1000

export interface PrintHandoffInput {
  origin: PrintHandoffOrigin
  file: PrintFileState
  source?: PrintMaterialSource
  /** 回到上一步用的站内路径；只保留路径部分。 */
  returnPath?: string
  /** 来源给的参数建议（如两页以上建议双面）。只是建议，本机不支持时由打印链收口并说明。 */
  paramsSuggestion?: Partial<PrintJobParams>
  /** 只对「我的文档」有意义：这一份要不要先做材料检查。 */
  requiresCheck?: boolean
  contentCategory?: PrintMaterialContentCategory
}

export type PrintHandoffFailure = 'invalid_input' | 'storage_unavailable'

export type BeginPrintHandoffResult =
  | { ok: true; context: PrintHandoffContext; entry: PrintHandoffEntry }
  | { ok: false; reason: PrintHandoffFailure }

export type PrintHandoffRead =
  | { status: 'ok'; context: PrintHandoffContext }
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'owner_mismatch' }
  | { status: 'expired'; returnPath?: string }
  | { status: 'link_expired'; returnPath?: string }

export type ResolvedPrintHandoff =
  | PrintHandoffRead
  | { status: 'replaced' }
  | { status: PrintHandoffFailure }

export type PrintHandoffPatch = {
  file?: PrintFileState
  materialCheck?: MaterialCheckSummary
  printParams?: PrintJobParams
  inspectionTask?: StoredMaterialTask | DocumentProcessTaskView
  normalizeTask?: StoredMaterialTask | DocumentProcessTaskView
  piiTask?: StoredMaterialTask | DocumentProcessTaskView
  piiRedactTask?: StoredMaterialTask | DocumentProcessTaskView
  contentCategory?: PrintMaterialContentCategory
  order?: PrintHandoffOrderMark
}

const PATCHABLE_KEYS = [
  'file',
  'materialCheck',
  'printParams',
  'inspectionTask',
  'normalizeTask',
  'piiTask',
  'piiRedactTask',
  'contentCategory',
  'order',
] as const

// ── 归属 ────────────────────────────────────────────────────────────────────

const memberMarks = new WeakMap<object, string>()

function randomMark(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID().replace(/-/g, '')
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const words = new Uint32Array(4)
    cryptoApi.getRandomValues(words)
    return Array.from(words, (word) => word.toString(16).padStart(8, '0')).join('')
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

/**
 * 当前使用者的归属。会员只记「本次登录」的随机标记：标记跟着登录对象走（AuthContext 只在登录时换对象），
 * 登出或刷新就没了 —— 刷新后会员的交接因此判为不符并清掉（隐私优先，文件可在「我的文档」找回）。
 * 标记里不带会员 id、手机号、令牌、昵称。
 */
export function printHandoffOwnerFor(user: object | null | undefined): PrintHandoffOwner {
  if (!user) return { kind: 'guest' }
  let mark = memberMarks.get(user)
  if (!mark) {
    mark = randomMark()
    memberMarks.set(user, mark)
  }
  return { kind: 'member', mark }
}

// ── 小工具 ──────────────────────────────────────────────────────────────────

const iso = (ms: number) => new Date(ms).toISOString()

function safeReturnPath(path: string | undefined): string | undefined {
  if (typeof path !== 'string') return undefined
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return undefined
  const bare = path.split(/[?#]/, 1)[0] ?? ''
  if (!bare || bare === '/login' || bare.startsWith('/login/')) return undefined
  return bare
}

/** 打印链接里的 expires（毫秒）。解析不出就是未知，不拦。 */
export function printLinkExpiresAt(fileUrl: string | undefined): string | null {
  if (!fileUrl) return null
  try {
    const raw = new URL(fileUrl, 'http://kiosk.invalid').searchParams.get('expires')
    if (!raw || !/^\d{10,16}$/.test(raw)) return null
    const ms = Number(raw)
    return Number.isFinite(ms) ? iso(ms) : null
  } catch {
    return null
  }
}

function hasPrintableIdentity(file: PrintFileState | undefined): file is PrintFileState {
  return Boolean(
    file &&
      typeof file.name === 'string' &&
      typeof file.fileId === 'string' && file.fileId.trim() &&
      typeof file.fileUrl === 'string' && file.fileUrl.trim(),
  )
}

function deadline(context: PrintHandoffContext): number {
  const created = Date.parse(context.createdAt)
  const stored = Date.parse(context.expiresAt)
  // 存储里的有效期只能缩短、不能被改长。
  return Math.min(stored, created + PRINT_HANDOFF_TTL_MS)
}

function withReturnPath<T extends { status: string }>(value: T, returnPath: string | undefined): T & { returnPath?: string } {
  return returnPath ? { ...value, returnPath } : value
}

// ── 写 / 读 / 补丁 / 清除 ────────────────────────────────────────────────────

/** 来源整份写入：生成新编号，旧任务、旧检查结论、旧参数一律不带过来。 */
export function beginPrintHandoff(
  input: PrintHandoffInput,
  owner: PrintHandoffOwner,
  now: number = Date.now(),
): BeginPrintHandoffResult {
  if (!hasPrintableIdentity(input?.file)) {
    clearPrintMaterialSession()
    return { ok: false, reason: 'invalid_input' }
  }
  const policy = printHandoffPolicyFor(input.origin, { requiresCheck: input.requiresCheck })
  const file = input.file
  const context: PrintHandoffContext = {
    v: 2,
    contextId: randomMark(),
    origin: input.origin,
    file: {
      name: file.name,
      size: file.size,
      pages: typeof file.pages === 'number' ? file.pages : null,
      fileId: file.fileId,
      fileUrl: file.fileUrl,
      fileMd5: file.fileMd5,
      mimeType: file.mimeType,
    },
    source: input.source,
    returnPath: safeReturnPath(input.returnPath),
    fileUrlExpiresAt: printLinkExpiresAt(file.fileUrl),
    owner,
    createdAt: iso(now),
    expiresAt: iso(now + PRINT_HANDOFF_TTL_MS),
    checkPolicy: policy.checkPolicy,
    paramsSuggestion: input.paramsSuggestion,
    contentCategory: input.contentCategory,
    updatedAt: iso(now),
  }
  if (!writeStoredPrintHandoff(context)) {
    clearPrintMaterialSession()
    return { ok: false, reason: 'storage_unavailable' }
  }
  const stored = readStoredPrintHandoff()
  return { ok: true, context: stored.status === 'ok' ? stored.value : context, entry: policy.entry }
}

function ownerDecision(stored: PrintHandoffOwner, current: PrintHandoffOwner): 'same' | 'rebind' | 'mismatch' {
  if (stored.kind === 'guest') return current.kind === 'guest' ? 'same' : 'rebind'
  return current.kind === 'member' && current.mark === stored.mark ? 'same' : 'mismatch'
}

/** 读交接：不正常时当场清掉存储，返回值里不带旧文件的任何信息。 */
export function readPrintHandoff(owner: PrintHandoffOwner, now: number = Date.now()): PrintHandoffRead {
  const stored = readStoredPrintHandoff()
  if (stored.status === 'none') return { status: 'none' }
  if (stored.status === 'invalid') {
    clearPrintMaterialSession()
    return { status: 'invalid' }
  }
  let context = stored.value
  const decision = ownerDecision(context.owner, owner)
  if (decision === 'mismatch') {
    clearPrintMaterialSession()
    return { status: 'owner_mismatch' }
  }
  if (now >= deadline(context)) {
    clearPrintMaterialSession()
    return withReturnPath({ status: 'expired' as const }, context.returnPath)
  }
  if (context.fileUrlExpiresAt && now >= Date.parse(context.fileUrlExpiresAt)) {
    clearPrintMaterialSession()
    return withReturnPath({ status: 'link_expired' as const }, context.returnPath)
  }
  if (decision === 'rebind') {
    // 游客中途登录视为同一人继续办理（产品已定），并改绑到这位会员：之后换人就判不符。
    context = { ...context, owner, updatedAt: iso(now) }
    if (!writeStoredPrintHandoff(context)) {
      clearPrintMaterialSession()
      return { status: 'invalid' }
    }
  }
  return { status: 'ok', context }
}

/** 按编号打补丁：编号对不上（已被新的交接替换）就不写 —— 检查页迟到的结果写不进别人的文件。 */
export function patchPrintHandoff(
  contextId: string,
  patch: PrintHandoffPatch,
  now: number = Date.now(),
): PrintHandoffContext | null {
  const stored = readStoredPrintHandoff()
  if (stored.status !== 'ok' || stored.value.contextId !== contextId) return null
  const current = stored.value
  if (now >= deadline(current)) return null
  const next: Record<string, unknown> = { ...current }
  for (const key of PATCHABLE_KEYS) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (value === undefined) delete next[key]
    else next[key] = value
  }
  const nextFile = next['file'] as PrintFileState | undefined
  if (!hasPrintableIdentity(nextFile)) return null
  next['fileUrlExpiresAt'] = printLinkExpiresAt(nextFile.fileUrl)
  next['updatedAt'] = iso(now)
  if (!writeStoredPrintHandoff(next as unknown as PrintHandoffContext)) return null
  const reread = readStoredPrintHandoff()
  return reread.status === 'ok' ? reread.value : null
}

/** 只清同一编号：材料任务失效时不误清已经换成的新文件。 */
export function clearPrintHandoff(contextId: string): boolean {
  const stored = readStoredPrintHandoff()
  if (stored.status !== 'ok' || stored.value.contextId !== contextId) return false
  clearPrintMaterialSession()
  return true
}

// ── 跳转 ────────────────────────────────────────────────────────────────────

export type PrintHandoffRouteState = { printContextId?: unknown; printHandoffError?: unknown }

export type PrintHandoffTarget =
  | { ok: true; path: string; state: { printContextId: string } }
  | { ok: false; path: '/print/confirm'; state: { printHandoffError: PrintHandoffFailure } }

/** 来源写完之后去哪：只带交接编号，不带文件、链接、参数。写失败就去确认页如实说。 */
export function printHandoffTarget(result: BeginPrintHandoffResult): PrintHandoffTarget {
  if (result.ok) {
    return { ok: true, path: printHandoffEntryPath(result.entry), state: { printContextId: result.context.contextId } }
  }
  return { ok: false, path: '/print/confirm', state: { printHandoffError: result.reason } }
}

export function printHandoffFailureText(reason: PrintHandoffFailure): string {
  return reason === 'storage_unavailable'
    ? '本机暂时无法保存打印信息，请找现场工作人员。'
    : '这份文件还没准备好打印。请回到上一步重新生成，或重新选择文件。'
}

const isFailure = (value: unknown): value is PrintHandoffFailure =>
  value === 'storage_unavailable' || value === 'invalid_input'

/**
 * 页面按「存储里的交接 + 跳转带来的编号」定这一页办的是哪一份：
 *   - 临时状态里的文件、参数一律不看；
 *   - 带了编号但和存储里的不一样：这一单作废（不提供「看当前这一份」—— 公共终端上更新的那一份可能属于下一位）；
 *   - 没带编号（登录回跳、返回预览、刷新）：用存储里那一份，归属与有效期已在 readPrintHandoff 里核过。
 */
export function resolveRouteHandoff(
  read: PrintHandoffRead,
  routeState: PrintHandoffRouteState | null | undefined,
): ResolvedPrintHandoff {
  if (isFailure(routeState?.printHandoffError)) return { status: routeState.printHandoffError }
  if (read.status !== 'ok') return read
  const wanted = routeState?.printContextId
  if (typeof wanted === 'string' && wanted !== read.context.contextId) return { status: 'replaced' }
  return read
}

/** 交接失效时给用户看的一句人话（不回显文件名、地址栏取值或任何编号）。 */
export function printHandoffProblemText(status: ResolvedPrintHandoff['status']): string | null {
  switch (status) {
    case 'owner_mismatch':
      return '这份文件属于上一位使用者，或登录身份变了，这一单已作废。请重新选择文件。'
    case 'expired':
      return '这一单放置超过 30 分钟，已经作废。请重新发起打印。'
    case 'link_expired':
      return '这份文件的打印链接已过期，请回到上一步重新生成。'
    case 'replaced':
      return '这一单已失效，请重新发起。'
    case 'invalid':
      return '打印信息不完整或已过时，这一单已作废。请重新选择文件。'
    case 'storage_unavailable':
    case 'invalid_input':
      return printHandoffFailureText(status)
    default:
      return null
  }
}
