/** 百度智能云 BOS 对象存储后端。 */
import { createHash } from 'crypto'
import * as BaiduBCE from '@baiducloud/sdk'
import { buildBosPresignedUrl, normalizeBosEndpoint, type BosSigningConfig } from './bos-signing'
import type {
  DownloadUrlArgs,
  HeadResult,
  ObjectStorageBackend,
  PutResult,
  SignedUrlResult,
  StorageDriver,
  UploadUrlArgs,
  UploadUrlResult,
} from './storage.interface'

export interface BosBackendConfig {
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  region: string
  endpoint: string
}

type BosResponse = {
  body?: Buffer
  http_headers?: Record<string, string | undefined>
}

export interface BosClientLike {
  putObject(bucket: string, key: string, body: Buffer, options?: Record<string, unknown>): Promise<BosResponse>
  getObject(bucket: string, key: string): Promise<BosResponse>
  getObjectMetadata(bucket: string, key: string): Promise<BosResponse>
  deleteObject(bucket: string, key: string): Promise<BosResponse>
}

export class BosStorageBackend implements ObjectStorageBackend {
  readonly driver: StorageDriver = 'bos'
  readonly bucket: string
  readonly region: string
  readonly endpoint: string

  private readonly signing: BosSigningConfig
  private readonly client: BosClientLike

  constructor(cfg: BosBackendConfig, client?: BosClientLike) {
    if (!cfg.accessKeyId || !cfg.secretAccessKey) throw new Error('BOS_CREDENTIALS_MISSING')
    if (!cfg.bucket || !cfg.region || !cfg.endpoint) throw new Error('BOS_BUCKET_REGION_OR_ENDPOINT_MISSING')
    this.bucket = cfg.bucket
    this.region = cfg.region
    this.endpoint = normalizeBosEndpoint(cfg.endpoint)
    this.signing = {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      bucket: cfg.bucket,
      endpoint: this.endpoint,
    }
    this.client = client ?? new BaiduBCE.BosClient({
      endpoint: this.endpoint,
      credentials: { ak: cfg.accessKeyId, sk: cfg.secretAccessKey },
      pathStyleEnable: true,
    })
  }

  async putObject(objectKey: string, buffer: Buffer, contentType: string): Promise<PutResult> {
    try {
      await this.client.putObject(this.bucket, objectKey, buffer, {
        'Content-Length': buffer.length,
        'Content-Type': contentType || 'application/octet-stream',
      })
    } catch (error) {
      throw bosOperationError('PUT', error)
    }
    return {
      sha256: createHash('sha256').update(buffer).digest('hex'),
      sizeBytes: buffer.length,
    }
  }

  async getObject(objectKey: string): Promise<Buffer> {
    try {
      const response = await this.client.getObject(this.bucket, objectKey)
      if (!Buffer.isBuffer(response.body)) throw new Error('BOS_GET_EMPTY_BODY')
      return response.body
    } catch (error) {
      throw bosOperationError('GET', error)
    }
  }

  async deleteObject(objectKey: string): Promise<void> {
    try {
      await this.client.deleteObject(this.bucket, objectKey)
    } catch (error) {
      if (bosStatusCode(error) === 404) return
      throw bosOperationError('DELETE', error)
    }
  }

  async headObject(objectKey: string): Promise<HeadResult | null> {
    try {
      const response = await this.client.getObjectMetadata(this.bucket, objectKey)
      const headers = response.http_headers ?? {}
      const size = Number(headers['content-length'] ?? 0)
      return {
        sizeBytes: Number.isFinite(size) ? size : 0,
        contentType: headers['content-type'] ?? null,
        etag: headers['etag'] ?? null,
      }
    } catch (error) {
      if (bosStatusCode(error) === 404) return null
      throw bosOperationError('HEAD', error)
    }
  }

  getDownloadUrl(args: DownloadUrlArgs): SignedUrlResult {
    // BOS 官方域名支持 responseContentType，但不支持动态 responseContentDisposition。
    // 文件名/强制附件行为必须由调用侧 download 属性或后续受控 API 代理处理，不能伪造已生效。
    const query: Record<string, string> = {}
    if (args.mimeType) query['responseContentType'] = args.mimeType
    const url = buildBosPresignedUrl({
      config: this.signing,
      method: 'GET',
      objectKey: args.objectKey,
      ttlSeconds: args.ttlSeconds,
      query,
    })
    return { url, expiresAt: new Date(Date.now() + args.ttlSeconds * 1000) }
  }

  getUploadUrl(args: UploadUrlArgs): UploadUrlResult {
    const contentType = args.contentType || 'application/octet-stream'
    const url = buildBosPresignedUrl({
      config: this.signing,
      method: 'PUT',
      objectKey: args.objectKey,
      ttlSeconds: args.ttlSeconds,
      contentType,
    })
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + args.ttlSeconds * 1000),
      direct: true,
    }
  }
}

function bosStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as Record<string, unknown>
  for (const key of ['status_code', 'statusCode', 'x-status-code']) {
    const value = Number(candidate[key])
    if (Number.isFinite(value)) return value
  }
  return null
}

function bosOperationError(operation: string, error: unknown): Error {
  const status = bosStatusCode(error)
  return new Error(`BOS_${operation}_FAILED${status ? `: status=${status}` : ''}`)
}
