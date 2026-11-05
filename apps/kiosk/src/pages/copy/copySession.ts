import type { CopyJobReceipt, CopySettings, CreateCopyInput } from '../../services/api/copyJobs'

export const COPY_MAX_COPIES = 99
export const DEFAULT_COPY_SETTINGS: CopySettings = { source: 'flatbed', copies: 1, colorMode: 'black_white', duplex: 'simplex' }
export function stepCopyCount(copies: number, delta: number): number {
  return Math.min(COPY_MAX_COPIES, Math.max(1, Math.trunc(copies + delta)))
}

type CapabilityRows = Partial<Record<'copy' | 'scan_device' | 'color_print' | 'duplex_print', { status: string }>>
export function copyOptions(rows: CapabilityRows) {
  const available = (key: keyof CapabilityRows) => rows[key]?.status === 'available'
  return { screen: available('copy') && available('scan_device'), color: available('color_print'), duplex: available('duplex_print') }
}
export function allowedCopySettings(settings: CopySettings, options: ReturnType<typeof copyOptions>): CopySettings {
  return { ...settings, copies: stepCopyCount(settings.copies, 0),
    colorMode: options.color ? settings.colorMode : 'black_white', duplex: options.duplex ? settings.duplex : 'simplex' }
}

export interface CopySession {
  input: CreateCopyInput
  copyId: string
  state: CopyJobReceipt['state']
  generation: number
  authorizationVersion: number
  expiresAt: string
  controlToken: string | null
}
interface Snapshot {
  settings: CopySettings
  attempt: CreateCopyInput | null
  session: CopySession | null
  phase: 'idle' | 'creating' | 'ready' | 'unknown' | 'rejected'
  notice: string | null
}
const initial = (): Snapshot => ({ settings: { ...DEFAULT_COPY_SETTINGS }, attempt: null, session: null, phase: 'idle', notice: null })
let snapshot = initial()
let generation = 0
let requestAbort: AbortController | null = null
const listeners = new Set<() => void>()
const publish = (next: Snapshot) => { snapshot = next; for (const listener of listeners) listener() }
export const readCopySnapshot = () => snapshot
export const readCopySession = () => snapshot.session
export function subscribeCopySession(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function hasCopySession(): boolean { return snapshot.attempt !== null || snapshot.session !== null }
export function clearCopySession(): void {
  generation += 1
  requestAbort?.abort()
  requestAbort = null
  publish(initial())
}
export function pickCopySettings(settings: CopySettings): void {
  if (snapshot.attempt) return
  publish({ ...snapshot, settings: { ...settings, copies: stepCopyCount(settings.copies, 0) }, notice: null })
}

/** 不确定重试永远沿用原 key、原参数；飞行中双击以及建单后不再发第二次。 */
export function beginCopyAttempt(terminalId: string): { input: CreateCopyInput; epoch: number; signal: AbortSignal } | null {
  if (snapshot.phase === 'creating' || snapshot.session || !terminalId) return null
  const input = snapshot.attempt ?? { ...snapshot.settings, terminalId, requestKey: crypto.randomUUID() }
  requestAbort = new AbortController()
  publish({ ...snapshot, attempt: input, phase: 'creating', notice: null })
  return { input, epoch: generation, signal: requestAbort.signal }
}
export function acceptCopyReceipt(epoch: number, receipt: CopyJobReceipt): boolean {
  if (epoch !== generation || !snapshot.attempt) return false
  const input = snapshot.attempt
  if (typeof receipt.copyId !== 'string' || !receipt.copyId.trim() || receipt.terminalId !== input.terminalId || !Number.isInteger(receipt.generation)
    || receipt.generation < 1 || !Number.isInteger(receipt.authorizationVersion) || receipt.authorizationVersion < 1
    || !Number.isFinite(Date.parse(receipt.expiresAt)) || Date.parse(receipt.expiresAt) <= Date.now()) {
    rejectCopyAttempt(epoch, 'unknown')
    return false
  }
  const controlToken = typeof receipt.controlToken === 'string' && receipt.controlToken.trim() ? receipt.controlToken : null
  // 只收白名单元数据。不保存文件、路径、报价或服务端任意附加字段。
  const session: CopySession = { input, copyId: receipt.copyId, state: receipt.state,
    generation: receipt.generation, authorizationVersion: receipt.authorizationVersion, expiresAt: receipt.expiresAt, controlToken }
  publish({ ...snapshot, session, phase: controlToken ? 'ready' : 'unknown',
    notice: controlToken ? null : '状态未知。这一次没能确认复印能否继续，请先用面板复印。不要再点开始。' })
  return Boolean(controlToken)
}
export function rejectCopyAttempt(epoch: number, kind: 'limit' | 'denied' | 'unknown' | 'conflict'): void {
  if (epoch !== generation) return
  const uncertain = kind === 'unknown' || kind === 'conflict'
  const notice = kind === 'limit' ? '这一次超过了这台机器能收的大小。这次先停在这里。'
    : kind === 'denied' ? '这台机器暂时只能在打印机面板上复印'
      : '状态未知。这一步的结果还没确认，请先用面板复印。不要更改设置后重新开始。'
  publish({ ...snapshot, attempt: uncertain ? snapshot.attempt : null, phase: uncertain ? 'unknown' : 'rejected', notice })
}
