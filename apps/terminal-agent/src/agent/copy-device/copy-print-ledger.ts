/** 独立于扫描页的耐久墓碑；永不因清场删除，也不据此重新派发。 */
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { createScanTaskDir } from '../scan-device/scan-temp-dir'
import { retainRecoveredCopyPrint } from './copy-print-recovery'
import { warn } from '../../logger'
import { CopyError, type CopyDeps, type CopyPrintState, type CopySession, type CopyView } from './copy-types'

export const COPY_PRINT_LEDGER_DIR = 'print-ledger'
export interface CopyPrintRecord {
  version: 1
  copyId: string
  terminalId: string
  generation: number
  owner: string
  pageCount: number // 实扫页数，绝不是出纸张数。
  state: 'dispatching' | 'spooled' | CopyPrintState
  eventId: string
  errorCode?: string
  attempts: number
  nextRetryAt: number
  acked: boolean
  queueCleanupPending?: boolean
  printerName?: string
}
const terminal = (state: string): state is CopyPrintState => ['handed', 'failed', 'unconfirmed'].includes(state)
export function printRecordView(r: CopyPrintRecord): CopyView {
  return { state: r.state, generation: r.generation, pageCount: r.pageCount, errorCode: r.errorCode ?? null }
}
export function createCopyPrintLedger(deps: CopyDeps, dirId: (id: string, generation: number) => string) {
  const records = new Map<string, CopyPrintRecord>()
  const inflight = new Set<string>()
  let safe = true
  const cleanupWrites = new Map<string, { attempts: number; nextAt: number }>()
  const cleanupRetries: Array<() => Promise<boolean>> = []
  const key = (id: string, generation: number) => dirId(id, generation)
  const directory = () => createScanTaskDir(COPY_PRINT_LEDGER_DIR, { ...deps.tempHooks, root: deps.root })
  const syncDirectory = (dir: string): void => {
    // Windows 不允许以目录 fd fsync；文件本身在任何平台都必须 fsync。
    if (process.platform === 'win32') return
    const fd = fs.openSync(dir, 'r')
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  }
  const persist = (record: CopyPrintRecord, first = false, cleanupCompletion = false): void => {
    // 新派发/结果写入仍 fail closed；已存在墓碑的清理完成可在现场重核后单独重试。
    if (!safe && !cleanupCompletion) throw new CopyError(503, 'COPY_STORAGE_UNSAFE')
    const dir = directory()
    const file = path.join(dir, `${key(record.copyId, record.generation)}.json`)
    const target = first ? file : `${file}.${randomUUID()}.tmp`
    try {
      const fd = fs.openSync(target, 'wx', 0o600)
      try { fs.writeFileSync(fd, JSON.stringify(record)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      if (!first) fs.renameSync(target, file)
      syncDirectory(dir)
      records.set(key(record.copyId, record.generation), record)
    } catch {
      // 清理完成写失败只保留隔离，下一次重新核验现场后可重写；其它写失败仍禁止新派发。
      // 即使 rename 已成功而目录 fsync 失败，内存墓碑仍保留 pending，绝不重派旧单。
      if (!cleanupCompletion) safe = false
      throw new CopyError(503, 'COPY_STORAGE_UNSAFE')
    }
  }
  try {
    const dir = directory()
    for (const name of fs.readdirSync(dir)) {
      if (/^[a-f0-9]{64}\.json\.[a-f0-9-]+\.tmp$/.test(name)) continue
      if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error('invalid ledger entry')
      const file = path.join(dir, name)
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 8192) throw new Error('unsafe ledger')
      const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
      let r: CopyPrintRecord
      try { r = JSON.parse(fs.readFileSync(fd, 'utf8')) as CopyPrintRecord } finally { fs.closeSync(fd) }
      if (r.version !== 1 || !/^[A-Za-z0-9_-]{1,64}$/.test(r.copyId) ||
        typeof r.terminalId !== 'string' || !r.terminalId || typeof r.owner !== 'string' || !r.owner ||
        !Number.isSafeInteger(r.generation) || r.generation < 1 ||
        !Number.isSafeInteger(r.pageCount) || r.pageCount < 1 || r.pageCount > 50 ||
        !['dispatching', 'spooled', 'handed', 'failed', 'unconfirmed'].includes(r.state) ||
        typeof r.eventId !== 'string' || !/^[a-f0-9-]{36}$/.test(r.eventId) ||
        !Number.isSafeInteger(r.attempts) || r.attempts < 0 || r.attempts > 10 ||
        !Number.isFinite(r.nextRetryAt) || typeof r.acked !== 'boolean' ||
        (r.queueCleanupPending !== undefined && typeof r.queueCleanupPending !== 'boolean') ||
        (r.printerName !== undefined && (typeof r.printerName !== 'string' || !r.printerName || r.printerName.length > 512)) ||
        (r.errorCode !== undefined && !/^[A-Za-z0-9_]{1,64}$/.test(r.errorCode)) ||
        name !== `${key(r.copyId, r.generation)}.json`) throw new Error('invalid ledger')
      // 兼容旧 ledger：未确认/未终态也必须重清；确认完成的旧记录不补打。
      r.queueCleanupPending ??= !['handed', 'failed'].includes(r.state)
      records.set(key(r.copyId, r.generation), r)
    }
    for (const r of records.values()) {
      if (!terminal(r.state)) persist({ ...r, state: 'unconfirmed', errorCode: 'COPY_RESTART_UNCONFIRMED',
        acked: false, attempts: 0, nextRetryAt: 0 })
    }
  } catch { safe = false; warn('copy-print: ledger unavailable; copy dispatch blocked') }
  const get = (id: string, generation: number) => records.get(key(id, generation))
  const queueSettled = (id: string, generation: number): void => {
    const r = get(id, generation)
    if (!r?.queueCleanupPending) return
    const entry = key(id, generation)
    const previous = cleanupWrites.get(entry)
    if (previous && deps.clock.now() < previous.nextAt) throw new CopyError(503, 'COPY_STORAGE_UNSAFE')
    try {
      persist({ ...r, queueCleanupPending: false }, false, true)
      cleanupWrites.delete(entry)
      if (previous) warn('copy-print: cleanup completion persisted; print isolation released')
    } catch (error) {
      const attempts = Math.min((previous?.attempts ?? 0) + 1, 6)
      const delay = Math.min(1000 * 2 ** (attempts - 1), 30_000)
      cleanupWrites.set(entry, { attempts, nextAt: deps.clock.now() + delay })
      warn(`copy-print: cleanup completion persist failed; print claims blocked; retry in ${delay}ms after executor/queue recheck; check ledger storage if failure persists`)
      throw error
    }
  }
  for (const [id, r] of records) if (r.queueCleanupPending) {
    cleanupRetries.push(retainRecoveredCopyPrint(deps, r, `copy_${id}`, () => queueSettled(r.copyId, r.generation)))
  }
  const retryCleanup = async (): Promise<void> => {
    for (const retry of cleanupRetries) await retry()
  }
  const begin = (s: CopySession): void => {
    if (get(s.command.copyId, s.command.generation)) throw new CopyError(409, 'COPY_ALREADY_DISPATCHED')
    persist({ version: 1, copyId: s.command.copyId, generation: s.command.generation,
      terminalId: deps.config.terminalId!, owner: s.owner, pageCount: s.pages.length,
      queueCleanupPending: true, printerName: deps.config.printerName,
      state: 'dispatching', eventId: randomUUID(), attempts: 0, nextRetryAt: 0, acked: false }, true)
  }
  const update = (id: string, generation: number, state: CopyPrintRecord['state'], errorCode?: string): void => {
    const r = get(id, generation)
    if (!r || terminal(r.state)) return
    persist({ ...r, state, ...(errorCode ? { errorCode } : {}) })
  }
  const retry = async (): Promise<void> => {
    if (!safe) return
    await Promise.all([...records.values()].map(async (r) => {
      const id = key(r.copyId, r.generation)
      if (!terminal(r.state) || r.acked || r.attempts >= 10 || inflight.has(id) ||
        r.terminalId !== deps.config.terminalId || deps.clock.now() < r.nextRetryAt) return
      inflight.add(id)
      try {
        // 与 offline-queue 相同：最多十次、30 秒指数退避、30 分钟封顶；发请求前耐久计数。
        const attempt = { ...r, attempts: r.attempts + 1,
          nextRetryAt: deps.clock.now() + Math.min(30_000 * 2 ** r.attempts, 30 * 60_000) }
        persist(attempt)
        try {
          await deps.reportPrint(r.copyId, { generation: r.generation, eventId: r.eventId,
            state: r.state as CopyPrintState, ...(r.errorCode ? { errorCode: r.errorCode } : {}) })
          persist({ ...records.get(id)!, acked: true })
        } catch {
          if (attempt.attempts >= 10) warn('copy-print: result retry exhausted; operator reconciliation required')
        }
      } finally { inflight.delete(id) }
    }))
  }
  return { get, begin, update, retry, queueSettled, retryCleanup, pendingDir: (id: string) => records.get(id)?.queueCleanupPending === true, hasDir: (id: string) => records.has(id), isSafe: () => safe }
}
