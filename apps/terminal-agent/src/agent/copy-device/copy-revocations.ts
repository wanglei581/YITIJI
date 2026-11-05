import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { createScanTaskDir } from '../scan-device/scan-temp-dir'
import { CopyError, type CopyCommand, type CopyDeps } from './copy-types'

export const COPY_REVOCATIONS_DIR = 'copy-revocations'
export const COPY_REVOCATION_TTL_MS = 180_000
const MAX_RECORDS = 4096

/** 与材料分开保存短期撤销墓碑；重启后也拒绝网络中迟到的旧 start。 */
export function createCopyRevocations(deps: CopyDeps, key: (id: string, generation: number) => string) {
  const records = new Map<string, number>()
  const pending = new Map<string, Set<{ revoked: boolean }>>()
  let loaded = true
  let dirty = false
  const directory = () => createScanTaskDir(COPY_REVOCATIONS_DIR, { ...deps.tempHooks, root: deps.root })
  const persist = (): void => {
    if (!loaded) throw new CopyError(503, 'COPY_STORAGE_UNSAFE')
    const dir = directory()
    const file = path.join(dir, 'revoked.json')
    const temp = path.join(dir, `${randomUUID()}.tmp`)
    try {
      const fd = fs.openSync(temp, 'wx', 0o600)
      try { fs.writeFileSync(fd, JSON.stringify([...records])); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      fs.renameSync(temp, file)
      if (process.platform !== 'win32') {
        const fd = fs.openSync(dir, 'r')
        try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      }
      dirty = false
    } catch { throw new CopyError(503, 'COPY_STORAGE_UNSAFE') }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
  }
  try {
    const dir = directory()
    for (const name of fs.readdirSync(dir)) {
      if (/^[a-f0-9-]{36}\.tmp$/.test(name)) { fs.unlinkSync(path.join(dir, name)); continue }
      if (name !== 'revoked.json') throw new Error('invalid revocation entry')
      const file = path.join(dir, name)
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 512 * 1024) throw new Error('unsafe revocations')
      const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
      let rows: unknown
      try { rows = JSON.parse(fs.readFileSync(fd, 'utf8')) } finally { fs.closeSync(fd) }
      if (!Array.isArray(rows) || rows.length > MAX_RECORDS) throw new Error('invalid revocations')
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' ||
          !/^[a-f0-9]{64}$/.test(row[0]) || !Number.isFinite(row[1])) throw new Error('invalid revocation')
        records.set(row[0], row[1] as number)
      }
    }
  } catch { loaded = false }
  const prune = (): void => {
    for (const [id, expiresAt] of records) if (deps.clock.now() >= expiresAt) {
      records.delete(id); dirty = true
    }
    if (dirty) { try { persist() } catch { /* 保留 dirty，阻止开扫并在下一次 tick 重试。 */ } }
  }
  const has = (c: CopyCommand): boolean => (records.get(key(c.copyId, c.generation)) ?? 0) > deps.clock.now()
  return {
    prune,
    has,
    revoke(c: CopyCommand): void {
      const id = key(c.copyId, c.generation)
      // 正在 tick 中的 start 持有独立标记，墓碑到期后也不能复活它。
      for (const attempt of pending.get(id) ?? []) attempt.revoked = true
      prune()
      if (!records.has(id) && records.size >= MAX_RECORDS) throw new CopyError(503, 'COPY_OPERATION_LIMIT')
      records.set(id, deps.clock.now() + COPY_REVOCATION_TTL_MS)
      dirty = true
      persist()
    },
    track(c: CopyCommand) {
      const id = key(c.copyId, c.generation)
      const attempt = { revoked: has(c) }
      const group = pending.get(id) ?? new Set<{ revoked: boolean }>()
      group.add(attempt); pending.set(id, group)
      return {
        assertLive(): void {
          if (attempt.revoked || has(c)) throw new CopyError(410, 'COPY_EXPIRED')
          if (!loaded || dirty) throw new CopyError(503, 'COPY_STORAGE_UNSAFE')
        },
        release(): void { group.delete(attempt); if (!group.size) pending.delete(id) },
      }
    },
  }
}
