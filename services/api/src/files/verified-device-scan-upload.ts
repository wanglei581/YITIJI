/**
 * 上传落库前的准备，以及屏上扫描凭据放行。
 *
 * 从 FilesService 抽出，是为了把 files.service.ts 压回 1606 行以内。
 * 屏上扫描的校验结果放在 WeakMap 里，键是这里新建的参数对象；公共 upload()
 * 只按这个键取走结果，不接受请求体里的放行字段。建档的 fileObject.create 仍留在
 * FilesService.upload，派生种类门禁只认那一处透传。
 */
import { BadRequestException, ConflictException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import type { UserRole } from '../common/decorators/roles.decorator'
import { generateObjectKey, type FileOwnerType as ObjKeyOwnerType } from '../storage/object-key'
import { isVerifiedDeviceScanDelivery } from '../scan-tasks/scan-device-protocol'
import { sniffDeclaredMimeMismatch } from './content-sniff'
import { recognizeStoredPageCount } from './file-page-count.util'
import {
  RESUME_EXPORT_STAGING_MAX_MS,
  type FileOwnerType,
  type FilePurpose,
  type FileSensitiveLevel,
  type FileUploadResponse,
  type FileAssetCategory,
} from './file.types'
import {
  scanDeviceDeliveryLimits,
  scanDeviceTooManyPagesMessage,
  validateVerifiedDeviceScanUpload,
  type UploadValidationMode,
  type ValidationResult,
} from './file-validation'
import { defaultRetentionForUpload } from './retention-policy'

export type FileUploadArgs = {
  buffer: Buffer
  filename: string
  mimeType: string
  purpose: FilePurpose
  sensitiveLevel?: FileSensitiveLevel
  uploaderId: string | null
  endUserId?: string | null
  assetCategory?: FileAssetCategory
  /** 派生件怎么来的（1.8 P-1）：derived / optimized 必传。 */
  derivationKind?: import('../print-jobs/material-check-policy').DerivationKind
  sourceFileId?: string | null
  actorRole?: UserRole | null
  actorOrgId?: string | null
  createdBy?: string | null
  /** 仅服务端内部调用可设 intent；外部 multipart 调用省略时固定为 proxy(15MB)。 */
  validationMode?: UploadValidationMode
  /** 仅服务端派生成果可收紧默认 system_short 到明确到期时间。 */
  expiresAtOverride?: Date
  /** 只用于这一单的源文件转出来的派生件：系统短期保存并锁定，不进「我的文档」（retention-policy.ts）。 */
  orderOnly?: boolean
  /**
   * 收费导出预写：对象先落库为 uploading + 短寿命，会员列表和访问 URL 看不到。
   * 核销事务提交时再激活并恢复正式保存期限。endUserId 在激活前不写入，
   * 避免会员数据导出按 endUserId 把未付款文件列出来。
   */
  paidExportStaging?: { endUserId: string; expiresAt: Date }
  /**
   * 渲染前已经写进 AIGC.ProduceID 的编号。传入则作为 FileObject.id，
   * 缺省时在这里生成。只接受 32 位十六进制，和对象键里的文件段一致。
   */
  id?: string
}

const verifiedDeviceUploadPlan = new WeakMap<object, ValidationResult>()

export function takeVerifiedDeviceUploadPlan(args: object): ValidationResult | null {
  const planned = verifiedDeviceUploadPlan.get(args) ?? null
  if (planned) verifiedDeviceUploadPlan.delete(args)
  return planned
}

export interface VerifiedDeviceScanUploadDeps {
  rejectDisallowed(args: { purpose: FilePurpose; actorRole?: UserRole | null }): void
  upload(args: FileUploadArgs): Promise<FileUploadResponse>
}

/** 凭据不成立时退回普通 upload。调用方仍是 FilesService.uploadVerifiedDeviceScan。 */
export async function runVerifiedDeviceScanUpload(
  args: FileUploadArgs & { clearance: unknown },
  deps: VerifiedDeviceScanUploadDeps,
): Promise<FileUploadResponse> {
  const { clearance, ...rest } = args
  if (!isVerifiedDeviceScanDelivery(clearance)) {
    return deps.upload(rest)
  }
  deps.rejectDisallowed(rest)
  const validation = validateVerifiedDeviceScanUpload({
    purpose: rest.purpose,
    mimeType: rest.mimeType,
    filename: rest.filename,
    sizeBytes: rest.buffer.length,
  })
  if (!validation.ok) {
    throw new BadRequestException({
      error: { code: validation.code, message: validation.message },
    })
  }
  const tagged: FileUploadArgs = { ...rest }
  verifiedDeviceUploadPlan.set(tagged, validation)
  try {
    return await deps.upload(tagged)
  } finally {
    verifiedDeviceUploadPlan.delete(tagged)
  }
}

export interface UploadStageDeps {
  warn(message: string): void
  resolveSensitiveLevel(purpose: FilePurpose, explicit?: FileSensitiveLevel): FileSensitiveLevel
  deriveOwner(args: {
    endUserId: string | null
    role: UserRole | null
    uploaderId: string | null
    orgId: string | null
  }): { ownerType: FileOwnerType; ownerId: string | null }
  inheritsOrderOnly(sourceFileId?: string | null, derivationKind?: string | null): Promise<boolean>
  putObject(objectKey: string, buffer: Buffer, mimeType: string): Promise<{ sizeBytes: number; sha256: string }>
  bucket: string
  region: string
}

/** 屏上扫描投递在落库前按类型再核页数。普通上传不设页数上限。证件读不出页数也拒。 */
async function resolveStoredPageCount(
  args: { buffer: Buffer; mimeType: string; purpose: FilePurpose },
  capPages: boolean,
): Promise<number | null> {
  const pageCount = await recognizeStoredPageCount(args.buffer, args.mimeType)
  if (!capPages) return pageCount
  const limits = scanDeviceDeliveryLimits(args.purpose)
  const tooMany = args.purpose === 'id_scan'
    ? pageCount === null || pageCount < 1 || pageCount > limits.maxPages
    : pageCount !== null && pageCount > limits.maxPages
  if (tooMany) {
    throw new ConflictException({
      error: {
        code: 'SCAN_DEVICE_TOO_MANY_PAGES',
        message: scanDeviceTooManyPagesMessage(limits.maxPages, pageCount),
      },
    })
  }
  return pageCount
}

export async function stagePreparedUpload(
  args: FileUploadArgs,
  validation: ValidationResult,
  capPages: boolean,
  deps: UploadStageDeps,
) {
  if (!validation.ok) {
    throw new BadRequestException({
      error: { code: validation.code, message: validation.message },
    })
  }
  // 魔数校验:真实字节须与声明 MIME 签名级一致(降低纯客户端声明的混淆空间;
  // 非结构级证明,能力边界见 content-sniff.ts 文件头注释)。
  const sniff = sniffDeclaredMimeMismatch(args.buffer, args.mimeType)
  if (!sniff.ok) {
    deps.warn(
      `Upload content mismatch (purpose=${args.purpose}, declared=${args.mimeType}): ${sniff.reason}`,
    )
    throw new BadRequestException({
      error: {
        code: 'FILE_CONTENT_MISMATCH',
        message: '文件内容与声明的类型不一致，请检查文件后重新上传',
      },
    })
  }

  const staging = args.paidExportStaging
  if (staging) {
    const expiresAtMs = staging.expiresAt?.getTime?.()
    const now = Date.now()
    if (
      !staging.endUserId?.trim() ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= now ||
      expiresAtMs > now + RESUME_EXPORT_STAGING_MAX_MS
    ) {
      throw new BadRequestException({
        error: { code: 'FILE_EXPIRY_INVALID', message: '文件到期时间无效' },
      })
    }
  }
  const sensitiveLevel = deps.resolveSensitiveLevel(args.purpose, args.sensitiveLevel)
  const providedId = args.id?.trim() ?? ''
  const id = providedId.length > 0 ? providedId : randomUUID().replace(/-/g, '')
  if (!/^[0-9a-f]{32}$/.test(id)) {
    throw new Error('FILE_ID_INVALID')
  }
  const ownerEndUserId = staging?.endUserId ?? args.endUserId ?? null
  const owner = deps.deriveOwner({
    endUserId: ownerEndUserId,
    role: args.actorRole ?? null,
    uploaderId: args.uploaderId,
    orgId: args.actorOrgId ?? null,
  })
  const orderOnly = !staging && args.purpose !== 'contract_upload'
    && (Boolean(args.orderOnly) || await deps.inheritsOrderOnly(args.sourceFileId, args.derivationKind))
  const retention = defaultRetentionForUpload({
    purpose: args.purpose,
    sensitiveLevel,
    ownerType: owner.ownerType,
    endUserId: ownerEndUserId,
    orderOnly,
  })
  const expiresAtOverride =
    args.purpose === 'contract_upload' ? undefined : args.expiresAtOverride
  if (
    expiresAtOverride &&
    (!Number.isFinite(expiresAtOverride.getTime()) || expiresAtOverride.getTime() <= Date.now())
  ) {
    throw new BadRequestException({
      error: { code: 'FILE_EXPIRY_INVALID', message: '文件到期时间无效' },
    })
  }
  const objectKey = generateObjectKey({
    purpose: args.purpose,
    ownerType: owner.ownerType as ObjKeyOwnerType,
    ownerId: owner.ownerId,
    fileId: id,
    ext: validation.ext,
  })

  const pageCount = await resolveStoredPageCount(args, capPages)
  const put = await deps.putObject(objectKey, args.buffer, args.mimeType)
  return {
    id,
    objectKey,
    bucket: deps.bucket,
    region: deps.region,
    put,
    owner,
    staging,
    sensitiveLevel,
    pageCount,
    retention,
    expiresAtOverride,
    orderOnly,
  }
}
