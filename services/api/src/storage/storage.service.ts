/** 统一对象存储服务：local / 腾讯 COS / 百度 BOS。 */
import { Injectable, Logger } from '@nestjs/common'
import { BosStorageBackend } from './bos-storage.backend'
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
  type StorageProvider,
  type UploadUrlArgs,
  type UploadUrlResult,
} from './storage.interface'

const MAX_SIGN_TTL_SECONDS = 30 * 60
const SUPPORTED_DRIVERS: readonly StorageDriver[] = ['local', 'cos', 'bos']

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name)
  private readonly local = new LocalStorageBackend()
  private readonly cos: CosStorageBackend | null
  private readonly bos: BosStorageBackend | null
  private readonly defaultBackend: ObjectStorageBackend
  private readonly legacyBackend: ObjectStorageBackend
  private readonly signTtl: number

  constructor() {
    const driver = parseDriver(process.env['FILE_STORAGE_DRIVER']?.trim() || 'local')

    const cosSecretId = process.env['TENCENT_COS_SECRET_ID']?.trim()
    const cosSecretKey = process.env['TENCENT_COS_SECRET_KEY']?.trim()
    const cosBucket = process.env['TENCENT_COS_BUCKET']?.trim()
    const cosRegion = process.env['TENCENT_COS_REGION']?.trim()
    this.cos = cosSecretId && cosSecretKey && cosBucket && cosRegion
      ? new CosStorageBackend({
          secretId: cosSecretId,
          secretKey: cosSecretKey,
          bucket: cosBucket,
          region: cosRegion,
        })
      : null

    const bosAccessKeyId = process.env['BAIDU_BOS_ACCESS_KEY_ID']?.trim()
    const bosSecretAccessKey = process.env['BAIDU_BOS_SECRET_ACCESS_KEY']?.trim()
    const bosBucket = process.env['BAIDU_BOS_BUCKET']?.trim()
    const bosRegion = process.env['BAIDU_BOS_REGION']?.trim()
    const bosEndpoint = process.env['BAIDU_BOS_ENDPOINT']?.trim()
    this.bos = bosAccessKeyId && bosSecretAccessKey && bosBucket && bosRegion && bosEndpoint
      ? new BosStorageBackend({
          accessKeyId: bosAccessKeyId,
          secretAccessKey: bosSecretAccessKey,
          bucket: bosBucket,
          region: bosRegion,
          endpoint: bosEndpoint,
        })
      : null

    this.defaultBackend = this.requireConfiguredBackend(driver)

    const legacyDriverValue = process.env['FILE_STORAGE_LEGACY_DRIVER']?.trim()
    if (legacyDriverValue) {
      this.legacyBackend = this.requireConfiguredBackend(parseDriver(legacyDriverValue))
    } else {
      // 旧 FairMaterial / AdAsset 没有 bucket provenance。切 BOS 时默认继续从已配置
      // 的 COS 读取；无 COS 的开发环境安全回到本地。
      this.legacyBackend = this.cos ?? this.local
    }

    const ttlEnv = Number(
      process.env['FILE_STORAGE_SIGN_URL_EXPIRES_SECONDS'] ??
      (driver === 'bos'
        ? process.env['BAIDU_BOS_SIGN_URL_EXPIRES_SECONDS']
        : process.env['TENCENT_COS_SIGN_URL_EXPIRES_SECONDS']),
    )
    this.signTtl = Number.isFinite(ttlEnv) && ttlEnv > 0
      ? Math.min(ttlEnv, MAX_SIGN_TTL_SECONDS)
      : MAX_SIGN_TTL_SECONDS

    this.logger.log(
      `StorageService driver=${this.defaultBackend.driver} bucket=${this.defaultBackend.bucket} ` +
      `region=${this.defaultBackend.region} signTtl=${this.signTtl}s ` +
      `cosAvailable=${Boolean(this.cos)} bosAvailable=${Boolean(this.bos)} legacy=${this.legacyBackend.driver}`,
    )
  }

  get defaultBucket(): string {
    return this.defaultBackend.bucket
  }

  get defaultRegion(): string {
    return this.defaultBackend.region
  }

  get driver(): StorageDriver {
    return this.defaultBackend.driver
  }

  get signTtlSeconds(): number {
    return this.signTtl
  }

  private requireConfiguredBackend(driver: StorageDriver): ObjectStorageBackend {
    if (driver === 'local') return this.local
    if (driver === 'cos') {
      if (!this.cos) {
        throw new Error(
          'FILE_STORAGE_DRIVER=cos 需要 TENCENT_COS_SECRET_ID / TENCENT_COS_SECRET_KEY / TENCENT_COS_BUCKET / TENCENT_COS_REGION 全部配置',
        )
      }
      return this.cos
    }
    if (!this.bos) {
      throw new Error(
        'FILE_STORAGE_DRIVER=bos 需要 BAIDU_BOS_ACCESS_KEY_ID / BAIDU_BOS_SECRET_ACCESS_KEY / BAIDU_BOS_BUCKET / BAIDU_BOS_REGION / BAIDU_BOS_ENDPOINT 全部配置',
      )
    }
    return this.bos
  }

  private backendFor(bucket?: string | null, provider?: StorageProvider | string | null): ObjectStorageBackend {
    if (provider === 'legacy') return this.legacyBackend
    if (provider === 'local') return this.local
    if (provider === 'cos') return this.assertBucket(this.requireConfiguredBackend('cos'), bucket)
    if (provider === 'bos') return this.assertBucket(this.requireConfiguredBackend('bos'), bucket)
    if (provider) throw new Error(`STORAGE_PROVIDER_UNSUPPORTED: provider=${provider}`)

    // 兼容 storageProvider 字段上线前的 FileObject 与旧调用方。
    if (!bucket) return this.defaultBackend
    if (bucket === LOCAL_BUCKET_SENTINEL) return this.local
    if (this.cos && bucket === this.cos.bucket) return this.cos
    if (this.bos && bucket === this.bos.bucket) return this.bos
    throw new Error(`STORAGE_BACKEND_UNAVAILABLE: bucket=${bucket}`)
  }

  private assertBucket(backend: ObjectStorageBackend, bucket?: string | null): ObjectStorageBackend {
    if (bucket && bucket !== backend.bucket) {
      throw new Error(`STORAGE_BUCKET_UNAVAILABLE: provider=${backend.driver} bucket=${bucket}`)
    }
    return backend
  }

  putObject(
    objectKey: string,
    buffer: Buffer,
    contentType: string,
    bucket?: string | null,
    provider?: StorageProvider | string | null,
  ): Promise<PutResult> {
    return this.backendFor(bucket, provider).putObject(objectKey, buffer, contentType)
  }

  getObject(
    objectKey: string,
    bucket?: string | null,
    provider?: StorageProvider | string | null,
  ): Promise<Buffer> {
    return this.backendFor(bucket, provider).getObject(objectKey)
  }

  deleteObject(
    objectKey: string,
    bucket?: string | null,
    provider?: StorageProvider | string | null,
  ): Promise<void> {
    return this.backendFor(bucket, provider).deleteObject(objectKey)
  }

  headObject(
    objectKey: string,
    bucket?: string | null,
    provider?: StorageProvider | string | null,
  ): Promise<HeadResult | null> {
    return this.backendFor(bucket, provider).headObject(objectKey)
  }

  getDownloadUrl(
    args: DownloadUrlArgs,
    bucket?: string | null,
    provider?: StorageProvider | string | null,
  ): SignedUrlResult {
    return this.backendFor(bucket, provider).getDownloadUrl(args)
  }

  getUploadUrl(
    args: UploadUrlArgs,
    bucket?: string | null,
    provider?: StorageProvider | string | null,
  ): UploadUrlResult {
    return this.backendFor(bucket, provider).getUploadUrl(args)
  }
}

function parseDriver(value: string): StorageDriver {
  if ((SUPPORTED_DRIVERS as readonly string[]).includes(value)) return value as StorageDriver
  throw new Error(`FILE_STORAGE_DRIVER_UNSUPPORTED: ${value}`)
}
