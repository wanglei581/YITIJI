import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import * as path from 'path'

/**
 * 本地文件系统存储后端。
 *
 * P0 阶段使用本地 FS,生产可换 MinIO / OSS / S3,接口不变。
 *
 * storageKey 命名规则:`<purpose>/<YYYY-MM-DD>/<cuid>.<ext>`,
 * 例:`resume_upload/2026-05-30/clxxxxxxxxxxxxxxx.pdf`。
 * 这种结构便于按用途 + 日期分桶 + 一眼看出过期文件。
 *
 * **跨平台**:全程 path.join,禁止硬编码分隔符。
 */
export class LocalFileStorage {
  /** 根目录,从 env 读取,默认 ./storage。 */
  private readonly root: string

  constructor(rootDir?: string) {
    this.root = rootDir ?? process.env['FILE_STORAGE_DIR'] ?? path.resolve(process.cwd(), 'storage')
  }

  /**
   * 写入文件 buffer,返回 storageKey + sha256。
   *
   * @param purpose      业务用途,作为顶级目录
   * @param ext          扩展名(不带点)。例 'pdf','jpg'
   * @param id           cuid,作为文件名(避免冲突)
   * @param buffer       文件内容
   */
  async put(purpose: string, ext: string, id: string, buffer: Buffer): Promise<{ storageKey: string; sha256: string }> {
    const day = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const safeExt = ext.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 10) || 'bin'
    const storageKey = `${purpose}/${day}/${id}.${safeExt}`
    const fullPath = this.resolve(storageKey)

    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, buffer)

    const sha256 = createHash('sha256').update(buffer).digest('hex')
    return { storageKey, sha256 }
  }

  /** 读取文件 buffer。 */
  async read(storageKey: string): Promise<Buffer> {
    return fs.readFile(this.resolve(storageKey))
  }

  /** 物理删除文件(不可逆,只在 cron / admin 强制清理时调用)。 */
  async delete(storageKey: string): Promise<void> {
    const fullPath = this.resolve(storageKey)
    try {
      await fs.unlink(fullPath)
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw err
      // 已经物理不存在则忽略(幂等)
    }
  }

  /** 把 storageKey 解析为绝对路径,并防越界(禁止 ../ 跳出 root)。 */
  private resolve(storageKey: string): string {
    const fullPath = path.resolve(this.root, storageKey)
    if (!fullPath.startsWith(path.resolve(this.root) + path.sep) && fullPath !== path.resolve(this.root)) {
      throw new Error(`Storage path escape attempt: ${storageKey}`)
    }
    return fullPath
  }
}
