/**
 * 文件查询辅助服务 — 被 upload / access / delete / cleanup 子服务共享的 DB 读取和校验逻辑。
 * 不暴露给 controller 层。
 */
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'

@Injectable()
export class FileQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async requireAlive(fileId: string, options: { allowMemberDataExport?: boolean } = {}) {
    return this.requireFile(fileId, { ...options, allowExpired: false })
  }

  async requireDeletable(fileId: string, options: { allowMemberDataExport?: boolean } = {}) {
    return this.requireFile(fileId, { ...options, allowExpired: true })
  }

  async requireFile(
    fileId: string,
    options: { allowMemberDataExport?: boolean; allowExpired: boolean },
  ) {
    const record = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
    if (
      !record ||
      record.deletedAt ||
      (!options.allowExpired && record.purpose === 'contract_upload' && !record.expiresAt) ||
      (!options.allowExpired && record.expiresAt && record.expiresAt.getTime() <= Date.now()) ||
      (!options.allowMemberDataExport && record.purpose === 'member_data_export')
    ) {
      this.throwFileNotFound()
    }
    // TypeScript narrowing: the `if` above covers the null/falsy cases; cast is safe.
    return record!
  }

  throwFileNotFound(): never {
    throw new NotFoundException({
      error: { code: 'FILE_NOT_FOUND', message: '文件不存在或已被清理' },
    })
  }

  downloadUrlTtlSeconds(expiresAt: Date | null, purpose: string): number {
    if (purpose === 'contract_upload' && !expiresAt) {
      this.throwFileNotFound()
    }
    if (!expiresAt) return this.storage.signTtlSeconds
    const remainingSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000)
    // 对象存储签名的最小安全粒度为 1 秒；不足时禁止调用存储签名。
    if (remainingSeconds < 1) {
      this.throwFileNotFound()
    }
    return Math.min(this.storage.signTtlSeconds, remainingSeconds)
  }

  ensureSignedExpiryWithinFileLifetime(signedExpiresAt: Date, fileExpiresAt: Date | null): Date {
    if (fileExpiresAt && signedExpiresAt.getTime() > fileExpiresAt.getTime()) {
      this.throwFileNotFound()
    }
    return signedExpiresAt
  }
}
