import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { createHash, randomUUID, timingSafeEqual } from 'crypto'
import { FilesService } from '../files/files.service'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { parseContentFileId, signFileUrl } from '../files/signing'

const FAIR_MATERIAL_MAX_BYTES = 20 * 1024 * 1024
const BRIDGE_FILE_TTL_MS = 60 * 60 * 1000
const MIN_REMAINING_TTL_MS = 30 * 60 * 1000
const LEASE_TTL_MS = 2 * 60 * 1000
const READY_RECHECK_ATTEMPTS = 4
const READY_RECHECK_DELAY_MS = 25
const ACTIVE_PRINT_STATUSES = ['pending', 'claimed', 'printing']

export interface FairMaterialPrintView {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  pageCount: number
  printFileUrl: string
}

interface EligibleMaterial {
  id: string
  name: string
  storageKey: string
  mimeType: string
  sizeBytes: number
  sha256: string
  pageCount: number
}

@Injectable()
export class FairMaterialPrintBridgeService {
  private readonly logger = new Logger(FairMaterialPrintBridgeService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly files: FilesService,
  ) {}

  async prepare(fairId: string, materialId: string): Promise<FairMaterialPrintView> {
    const material = await this.requireEligibleMaterial(fairId, materialId)
    const now = new Date()
    const minReusableExpiry = new Date(now.getTime() + MIN_REMAINING_TTL_MS)

    const reusable = await this.findReusable(material, minReusableExpiry)
    if (reusable?.fileObjectId) return this.toView(material, reusable.fileObjectId)

    await this.expireInsufficientTtlBridges(material, minReusableExpiry)
    const leaseToken = randomUUID()
    const claimed = await this.claimCreationLease(material, leaseToken, now)
    if (!claimed) {
      const afterWait = await this.waitForReady(material, minReusableExpiry)
      const afterWaitFileId = afterWait?.fileObjectId
      if (afterWaitFileId) return this.toView(material, afterWaitFileId)
      throw preparingError()
    }

    let uploadedFileId: string | null = null
    try {
      const buffer = await this.storage.getObject(material.storageKey)
      this.assertSourceIntegrity(material, buffer)
      const expiresAt = new Date(Date.now() + BRIDGE_FILE_TTL_MS)
      const uploaded = await this.files.upload({
        buffer,
        filename: material.name,
        mimeType: material.mimeType,
        purpose: 'fair_material',
        uploaderId: null,
        assetCategory: 'derived',
        createdBy: null,
        validationMode: 'intent',
        expiresAtOverride: expiresAt,
      })
      uploadedFileId = uploaded.fileId

      await this.requireEligibleMaterial(fairId, materialId, material)
      const finalized = await this.prisma.fairMaterialPrintBridge.updateMany({
        where: { id: claimed.id, status: 'creating', leaseToken, activeKey: activeKey(material) },
        data: {
          fileObjectId: uploaded.fileId,
          status: 'ready',
          expiresAt,
          leaseUntil: null,
          leaseToken: null,
        },
      })
      if (finalized.count !== 1) {
        await this.deleteBridgeFile(uploaded.fileId, 'fair material bridge lease lost')
        throw preparingError()
      }
      return this.toView(material, uploaded.fileId)
    } catch (error) {
      if (uploadedFileId) await this.deleteBridgeFile(uploadedFileId, 'fair material bridge creation failed')
      await this.prisma.fairMaterialPrintBridge.updateMany({
        where: { id: claimed.id, status: 'creating', leaseToken },
        data: {
          activeKey: null,
          status: 'failed',
          revokedAt: new Date(),
          revokeReason: integrityCode(error) ?? 'bridge_creation_failed',
          leaseUntil: null,
          leaseToken: null,
        },
      })
      throw error
    }
  }

  async revokeForMaterial(materialId: string, reason: string): Promise<number> {
    const active = await this.prisma.fairMaterialPrintBridge.findMany({
      where: { materialId, activeKey: { not: null }, status: { in: ['creating', 'ready'] } },
      select: { id: true, fileObjectId: true },
    })
    if (active.length === 0) return 0
    const revokedAt = new Date()
    await this.prisma.fairMaterialPrintBridge.updateMany({
      where: { id: { in: active.map((row) => row.id) }, activeKey: { not: null } },
      data: {
        activeKey: null,
        status: 'revoked',
        revokedAt,
        revokeReason: reason,
        leaseUntil: null,
        leaseToken: null,
      },
    })
    for (const row of active) {
      if (row.fileObjectId) await this.reclaimIfSafe(row.fileObjectId, `fair material bridge revoked: ${reason}`)
    }
    return active.length
  }

  async revokeForFair(fairId: string, reason: string): Promise<number> {
    const materials = await this.prisma.fairMaterial.findMany({
      where: { jobFairId: fairId },
      select: { id: true },
    })
    let revoked = 0
    for (const material of materials) {
      revoked += await this.revokeForMaterial(material.id, reason)
    }
    return revoked
  }

  /** 每小时回收过期/撤销 bridge；活跃 PrintTask 存在时保留履约文件。 */
  async cleanupStaleBridges(): Promise<number> {
    const now = new Date()
    await this.prisma.fairMaterialPrintBridge.updateMany({
      where: { status: 'ready', expiresAt: { lte: now }, activeKey: { not: null } },
      data: {
        activeKey: null,
        status: 'expired',
        revokedAt: now,
        revokeReason: 'bridge_expired',
      },
    })
    await this.prisma.fairMaterialPrintBridge.updateMany({
      where: { status: 'creating', leaseUntil: { lte: now }, activeKey: { not: null } },
      data: {
        activeKey: null,
        status: 'failed',
        revokedAt: now,
        revokeReason: 'creation_lease_expired',
        leaseUntil: null,
        leaseToken: null,
      },
    })

    const ready = await this.prisma.fairMaterialPrintBridge.findMany({
      where: { status: 'ready', activeKey: { not: null } },
      include: { material: { include: { jobFair: true } } },
    })
    for (const row of ready) {
      const material = row.material
      if (
        material.deletedAt ||
        !material.allowPrint ||
        material.publishStatus !== 'published' ||
        material.jobFair.reviewStatus !== 'approved' ||
        material.jobFair.publishStatus !== 'published'
      ) {
        await this.revokeForMaterial(material.id, 'source_not_printable')
      }
    }

    const reclaimable = await this.prisma.fairMaterialPrintBridge.findMany({
      where: {
        status: { in: ['revoked', 'expired', 'failed'] },
        fileObjectId: { not: null },
      },
      select: { fileObjectId: true },
    })
    let reclaimed = 0
    for (const row of reclaimable) {
      if (row.fileObjectId && await this.reclaimIfSafe(row.fileObjectId, 'fair material bridge lifecycle cleanup')) {
        reclaimed += 1
      }
    }
    return reclaimed
  }

  private async requireEligibleMaterial(
    fairId: string,
    materialId: string,
    expected?: EligibleMaterial,
  ): Promise<EligibleMaterial> {
    const material = await this.prisma.fairMaterial.findFirst({
      where: {
        id: materialId,
        jobFairId: fairId,
        deletedAt: null,
        publishStatus: 'published',
        allowPrint: true,
        jobFair: { reviewStatus: 'approved', publishStatus: 'published' },
      },
      select: {
        id: true,
        name: true,
        storageKey: true,
        mimeType: true,
        sizeBytes: true,
        sha256: true,
        pageCount: true,
      },
    })
    if (!material || material.storageKey.startsWith('pending:')) throw materialNotPrintableError()
    if (
      expected &&
      (material.sha256 !== expected.sha256 || material.sizeBytes !== expected.sizeBytes || material.mimeType !== expected.mimeType)
    ) {
      throw materialNotPrintableError()
    }
    return material
  }

  private async findReusable(material: EligibleMaterial, minExpiry: Date) {
    const bridge = await this.prisma.fairMaterialPrintBridge.findFirst({
      where: {
        materialId: material.id,
        sourceSha256: material.sha256,
        sourceSizeBytes: material.sizeBytes,
        sourceMimeType: material.mimeType,
        status: 'ready',
        activeKey: activeKey(material),
        revokedAt: null,
        expiresAt: { gt: minExpiry },
      },
      include: { fileObject: true },
    })
    if (
      !bridge?.fileObjectId ||
      !bridge.fileObject ||
      bridge.fileObject.deletedAt ||
      bridge.fileObject.status !== 'active' ||
      !bridge.fileObject.expiresAt ||
      bridge.fileObject.expiresAt <= minExpiry
    ) return null
    return bridge
  }

  private async expireInsufficientTtlBridges(material: EligibleMaterial, minExpiry: Date): Promise<void> {
    const stale = await this.prisma.fairMaterialPrintBridge.findMany({
      where: {
        materialId: material.id,
        sourceSha256: material.sha256,
        status: 'ready',
        activeKey: activeKey(material),
        expiresAt: { lte: minExpiry },
      },
      select: { id: true, fileObjectId: true },
    })
    if (stale.length === 0) return
    await this.prisma.fairMaterialPrintBridge.updateMany({
      where: { id: { in: stale.map((row) => row.id) }, status: 'ready', activeKey: activeKey(material) },
      data: {
        activeKey: null,
        status: 'expired',
        revokedAt: new Date(),
        revokeReason: 'insufficient_remaining_ttl',
      },
    })
    for (const row of stale) {
      if (row.fileObjectId) await this.reclaimIfSafe(row.fileObjectId, 'fair material bridge insufficient TTL')
    }
  }

  private async claimCreationLease(material: EligibleMaterial, leaseToken: string, now: Date) {
    const key = activeKey(material)
    const leaseUntil = new Date(now.getTime() + LEASE_TTL_MS)
    try {
      return await this.prisma.fairMaterialPrintBridge.create({
        data: {
          materialId: material.id,
          sourceSha256: material.sha256,
          sourceSizeBytes: material.sizeBytes,
          sourceMimeType: material.mimeType,
          activeKey: key,
          status: 'creating',
          expiresAt: new Date(now.getTime() + BRIDGE_FILE_TTL_MS),
          leaseUntil,
          leaseToken,
        },
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
    }

    const existing = await this.prisma.fairMaterialPrintBridge.findFirst({ where: { activeKey: key } })
    if (!existing || existing.status !== 'creating' || !existing.leaseUntil || existing.leaseUntil > now) return null
    const takeover = await this.prisma.fairMaterialPrintBridge.updateMany({
      where: { id: existing.id, status: 'creating', activeKey: key, leaseUntil: { lte: now } },
      data: { leaseUntil, leaseToken, expiresAt: new Date(now.getTime() + BRIDGE_FILE_TTL_MS) },
    })
    return takeover.count === 1
      ? this.prisma.fairMaterialPrintBridge.findUnique({ where: { id: existing.id } })
      : null
  }

  private async waitForReady(material: EligibleMaterial, minExpiry: Date) {
    for (let attempt = 0; attempt < READY_RECHECK_ATTEMPTS; attempt += 1) {
      await delay(READY_RECHECK_DELAY_MS)
      const ready = await this.findReusable(material, minExpiry)
      if (ready) return ready
      const active = await this.prisma.fairMaterialPrintBridge.findFirst({
        where: { activeKey: activeKey(material) },
        select: { status: true },
      })
      if (!active || active.status !== 'creating') return null
    }
    return null
  }

  private assertSourceIntegrity(material: EligibleMaterial, buffer: Buffer): void {
    const sniffed = sniffMaterialMime(buffer)
    const actualSha = createHash('sha256').update(buffer).digest()
    const expectedSha = /^[a-f0-9]{64}$/i.test(material.sha256) ? Buffer.from(material.sha256, 'hex') : Buffer.alloc(0)
    const hashMatches = expectedSha.length === actualSha.length && timingSafeEqual(expectedSha, actualSha)
    if (
      buffer.length <= 0 ||
      buffer.length > FAIR_MATERIAL_MAX_BYTES ||
      buffer.length !== material.sizeBytes ||
      !sniffed ||
      sniffed !== material.mimeType ||
      !hashMatches
    ) {
      throw new ConflictException({
        error: { code: 'MATERIAL_INTEGRITY_FAILED', message: '资料完整性校验失败，请联系管理员重新上传' },
      })
    }
  }

  private async reclaimIfSafe(fileId: string, reason: string): Promise<boolean> {
    const activeTasks = await this.prisma.printTask.findMany({
      where: { status: { in: ACTIVE_PRINT_STATUSES } },
      select: { fileUrl: true },
    })
    if (activeTasks.some((task) => parseContentFileId(task.fileUrl) === fileId)) return false
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId }, select: { deletedAt: true } })
    if (!file || file.deletedAt) return false
    await this.deleteBridgeFile(fileId, reason)
    return true
  }

  private async deleteBridgeFile(fileId: string, reason: string): Promise<void> {
    try {
      await this.files.systemDelete(fileId, reason)
    } catch (error) {
      // 保留 bridge 记录供后续 cleanup 重试；不得静默制造不可观测孤儿。
      this.logger.warn(`Bridge file cleanup deferred: file=${fileId} reason=${reason} error=${error instanceof Error ? error.message : 'unknown'}`)
    }
  }

  private toView(material: Pick<EligibleMaterial, 'name' | 'mimeType' | 'sizeBytes' | 'pageCount'>, fileId: string): FairMaterialPrintView {
    return {
      fileId,
      filename: material.name,
      sizeBytes: material.sizeBytes,
      mimeType: material.mimeType,
      pageCount: material.pageCount,
      printFileUrl: signFileUrl(fileId).url,
    }
  }
}

function activeKey(material: Pick<EligibleMaterial, 'id' | 'sha256'>): string {
  return `${material.id}:${material.sha256.toLowerCase()}`
}

function sniffMaterialMime(buffer: Buffer): string | null {
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf'
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  return null
}

function isUniqueConstraintError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002'
}

function materialNotPrintableError(): NotFoundException {
  return new NotFoundException({
    error: { code: 'MATERIAL_NOT_PRINTABLE', message: '资料不存在、未发布或暂不开放打印' },
  })
}

function preparingError(): ConflictException {
  return new ConflictException({
    error: { code: 'MATERIAL_PRINT_PREPARING', message: '打印文件正在准备，请稍后重试' },
  })
}

function integrityCode(error: unknown): string | null {
  const response = (error as { getResponse?: () => unknown })?.getResponse?.() as { error?: { code?: string } } | undefined
  return response?.error?.code ?? null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
