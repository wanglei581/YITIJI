/**
 * 统一对象存储服务。
 *
 * 职责:
 *   - 按 FILE_STORAGE_DRIVER(local|cos)选默认后端供新上传使用。
 *   - 按文件记录的 bucket 路由读 / 删 / 签名,兼容"先本地后切 COS"的混合数据。
 *   - 统一签名 URL TTL,强制 ≤ TENCENT_COS_SIGN_URL_EXPIRES_SECONDS(默认 1800,
 *     合规上限 30 分钟,见 CLAUDE.md §11)。
 *
 * 凭证(SecretId/SecretKey)只在 CosStorageBackend 内持有,本服务不暴露。
 */
import { Injectable, Logger } from '@nestjs/common'
import { CosStorageBackend } from './cos-storage.backend'
import { LocalStorageBackend } from './local-storage.backend'
import {
  LOCAL_BUCKET_SENTINEL,
  type DownloadUrlArgs,
  type HeadResult,
  type ObjectStorageBackend,
  type PutResult,
  type SignedUrlResult,
  type StorageDriver,
  type UploadUrlArgs,
  type UploadUrlResult,
} from './storage.interface'

/** 合规硬上限:签名 URL TTL 不得超过 30 分钟。 */
const MAX_SIGN_TTL_SECONDS = 30 * 60

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name)
  private readonly local = new LocalStorageBackend()
  private readonly cos: CosStorageBackend | null
  private readonly defaultBackend: ObjectStorageBackend
  private readonly signTtl: number

  constructor() {
    const driver = (process.env['FILE_STORAGE_DRIVER']?.trim() || 'local') as StorageDriver

    const secretId = process.env['TENCENT_COS_SECRET_ID']?.trim()
    const secretKey = process.env['TENCENT_COS_SECRET_KEY']?.trim()
    const bucket = process.env['TENCENT_COS_BUCKET']?.trim()
    const region = process.env['TENCENT_COS_REGION']?.trim()

    const cosConfigured = Boolean(secretId && secretKey && bucket && region)
    // 凭证齐全则构造 COS 后端(即使 driver=local,也便于读回已落 COS 的历史文件)。
    this.cos = cosConfigured
      ? new CosStorageBackend({ secretId: secretId!, secretKey: secretKey!, bucket: bucket!, region: region! })
      : null

    if (driver === 'cos') {
      if (!this.cos) {
        throw new Error(
          'FILE_STORAGE_DRIVER=cos 需要 TENCENT_COS_SECRET_ID / TENCENT_COS_SECRET_KEY / TENCENT_COS_BUCKET / TENCENT_COS_REGION 全部配置',
        )
      }
      this.defaultBackend = this.cos
    } else {
      this.defaultBackend = this.local
    }

    const ttlEnv = Number(process.env['TENCENT_COS_SIGN_URL_EXPIRES_SECONDS'])
    this.signTtl = Number.isFinite(ttlEnv) && ttlEnv > 0 ? Math.min(ttlEnv, MAX_SIGN_TTL_SECONDS) : MAX_SIGN_TTL_SECONDS

    this.logger.log(
      `StorageService driver=${this.defaultBackend.driver} bucket=${this.defaultBackend.bucket} region=${this.defaultBackend.region} signTtl=${this.signTtl}s cosAvailable=${Boolean(this.cos)}`,
    )
  }

  /** 新上传落到的默认 bucket / region(写入 FileObject)。 */
  get defaultBucket(): string {
    return this.defaultBackend.bucket
  }
  get defaultRegion(): string {
    return this.defaultBackend.region
  }
  get driver(): StorageDriver {
    return this.defaultBackend.driver
  }
  /** 配置的签名 URL TTL(秒,已 clamp ≤ 1800)。 */
  get signTtlSeconds(): number {
    return this.signTtl
  }

  /** 按文件记录的 bucket 选后端;未知 / 未提供回退默认后端。 */
  private backendFor(bucket?: string | null): ObjectStorageBackend {
    if (!bucket) return this.defaultBackend
    if (bucket === LOCAL_BUCKET_SENTINEL) return this.local
    if (this.cos && bucket === this.cos.bucket) return this.cos
    // 文件记录在某 COS bucket 但当前未配置 COS → 明确报错,不静默回退本地。
    if (bucket !== this.local.bucket && !this.cos) {
      throw new Error(`STORAGE_BACKEND_UNAVAILABLE: bucket=${bucket} 未配置 COS,无法访问`)
    }
    return this.defaultBackend
  }

  putObject(objectKey: string, buffer: Buffer, contentType: string, bucket?: string | null): Promise<PutResult> {
    return this.backendFor(bucket).putObject(objectKey, buffer, contentType)
  }
  getObject(objectKey: string, bucket?: string | null): Promise<Buffer> {
    return this.backendFor(bucket).getObject(objectKey)
  }
  deleteObject(objectKey: string, bucket?: string | null): Promise<void> {
    return this.backendFor(bucket).deleteObject(objectKey)
  }
  headObject(objectKey: string, bucket?: string | null): Promise<HeadResult | null> {
    return this.backendFor(bucket).headObject(objectKey)
  }

  getDownloadUrl(args: DownloadUrlArgs, bucket?: string | null): SignedUrlResult {
    return this.backendFor(bucket).getDownloadUrl(args)
  }
  getUploadUrl(args: UploadUrlArgs, bucket?: string | null): UploadUrlResult {
    return this.backendFor(bucket).getUploadUrl(args)
  }
}
