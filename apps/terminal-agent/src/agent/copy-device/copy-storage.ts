import fs from 'fs'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import { createScanTaskDir, getScanDeviceRoot, purgeScanTaskDir, scanPageFileName } from '../scan-device/scan-temp-dir'
import { CopyError, type CopyDeletionReason, type CopyDeps, type CopySession } from './copy-types'

export function getCopyDeviceRoot(): string {
  return path.join(path.dirname(getScanDeviceRoot()), 'copy-device')
}
export function copyDirId(copyId: string, generation: number): string {
  return createHash('sha256').update(`copy-session-v1\0${copyId}\0${generation}`).digest('hex')
}
export function createCopyStorage(deps: CopyDeps) {
  const hooks = { ...deps.tempHooks, root: deps.root, now: deps.clock.now }
  const pending = new Map<string, CopyDeletionReason>()
  const purge = (id: string, reason: CopyDeletionReason): boolean => {
    pending.set(id, reason)
    try {
      if (fs.existsSync(deps.root)) {
        const rootStat = fs.lstatSync(deps.root)
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false
      }
      const result = purgeScanTaskDir(id, reason, hooks)
      if (result.status === 'failed') return false
      pending.delete(id)
      return true
    } catch {
      return false
    }
  }
  return {
    create(id: string): string { return createScanTaskDir(id, hooks) },
    purge,
    retry(): void { for (const [id, reason] of pending) purge(id, reason) },
    sweep(): void {
      if (!fs.existsSync(deps.root)) return
      // 根目录先经 A2 的真实目录和 ACL 校验，绝不遍历符号链接指向的外部目录。
      const guard = createScanTaskDir(randomUUID(), hooks)
      fs.rmdirSync(guard)
      for (const id of fs.readdirSync(deps.root)) {
        if (/^[A-Za-z0-9_-]{1,64}$/.test(id)) purge(id, 'COPY_STARTUP_RESIDUE')
        else {
          // 未知零散项也清掉；先在同一私有根内改为无内容标识的名字，审计不收原文件名。
          const isolated = randomUUID()
          fs.renameSync(path.join(deps.root, id), path.join(deps.root, isolated))
          purge(isolated, 'COPY_STARTUP_RESIDUE')
        }
      }
    },
    prepareCompose(s: CopySession): void {
      for (let page = 1; page <= s.pages.length; page += 1) this.read(s, page)
      try {
        const pdf = fs.lstatSync(path.join(s.dir, 'scan.pdf'))
        if (!pdf.isFile() || pdf.isSymbolicLink() || pdf.nlink !== 1) throw new CopyError(503, 'COPY_STORAGE_UNSAFE')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    },
    read(s: CopySession, page: number): Buffer {
      if (!Number.isSafeInteger(page) || page < 1 || page > s.pages.length) throw new CopyError(400, 'COPY_BAD_REQUEST')
      // 每次读取重新核对目录；页只按固定页序定位，不接受客户端路径。
      createScanTaskDir(s.dirId, hooks)
      const file = path.join(s.dir, scanPageFileName(page))
      const before = fs.lstatSync(file)
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new CopyError(503, 'COPY_STORAGE_UNSAFE')
      const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
      try {
        const stat = fs.fstatSync(fd)
        if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > s.byteBudget) {
          throw new CopyError(503, 'COPY_STORAGE_UNSAFE')
        }
        const bytes = fs.readFileSync(fd)
        if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new CopyError(503, 'COPY_STORAGE_UNSAFE')
        return bytes
      } finally { fs.closeSync(fd) }
    },
  }
}
