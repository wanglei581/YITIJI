/**
 * 腾讯云 COS 存储后端(生产)。
 *
 * 所有操作统一走"预签名 URL + fetch"一条代码路径(put/get/delete/head),
 * 下载 / 预览 / 上传也复用同一签名器,降低出错面。
 *
 * 安全(CLAUDE.md §12、用户需求六):
 *   - SecretId / SecretKey 仅在本后端持有,来自环境变量,绝不下发 / 入日志。
 *   - 所有对外 URL 均为短期预签名 URL,无永久公开链接。
 */
import { createHash } from 'crypto'
import { buildCosPresignedUrl, cosHost } from './cos-signing'
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

export interface CosBackendConfig {
  secretId: string
  secretKey: string
  bucket: string
  region: string
}

export class CosStorageBackend implements ObjectStorageBackend {
  readonly driver: StorageDriver = 'cos'
  readonly bucket: string
  readonly region: string

  private readonly secretId: string
  private readonly secretKey: string

  constructor(cfg: CosBackendConfig) {
    if (!cfg.secretId || !cfg.secretKey) throw new Error('COS_CREDENTIALS_MISSING')
    if (!cfg.bucket || !cfg.region) throw new Error('COS_BUCKET_OR_REGION_MISSING')
    this.secretId = cfg.secretId
    this.secretKey = cfg.secretKey
    this.bucket = cfg.bucket
    this.region = cfg.region
  }

  private nowSec(): number {
    return Math.floor(Date.now() / 1000)
  }

  private presign(method: string, objectKey: string, ttlSeconds: number, query?: Record<string, string>): string {
    return buildCosPresignedUrl({
      secretId: this.secretId,
      secretKey: this.secretKey,
      bucket: this.bucket,
      region: this.region,
      method,
      objectKey,
      ttlSeconds,
      query,
      signTimeSec: this.nowSec(),
    })
  }

  async putObject(objectKey: string, buffer: Buffer, contentType: string): Promise<PutResult> {
    const url = this.presign('PUT', objectKey, 300)
    const res = await fetch(url, {
      method: 'PUT',
      body: buffer,
      headers: { 'Content-Type': contentType || 'application/octet-stream' },
    })
    if (!res.ok) {
      const detail = await safeBody(res)
      throw new Error(`COS_PUT_FAILED: ${res.status} ${detail}`)
    }
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    return { sha256, sizeBytes: buffer.length }
  }

  async getObject(objectKey: string): Promise<Buffer> {
    const url = this.presign('GET', objectKey, 300)
    const res = await fetch(url, { method: 'GET' })
    if (!res.ok) {
      const detail = await safeBody(res)
      throw new Error(`COS_GET_FAILED: ${res.status} ${detail}`)
    }
    return Buffer.from(await res.arrayBuffer())
  }

  async deleteObject(objectKey: string): Promise<void> {
    const url = this.presign('DELETE', objectKey, 300)
    const res = await fetch(url, { method: 'DELETE' })
    // 204(成功)/ 404(已不存在)均视为幂等成功。
    if (!res.ok && res.status !== 404) {
      const detail = await safeBody(res)
      throw new Error(`COS_DELETE_FAILED: ${res.status} ${detail}`)
    }
  }

  async headObject(objectKey: string): Promise<HeadResult | null> {
    const url = this.presign('HEAD', objectKey, 300)
    const res = await fetch(url, { method: 'HEAD' })
    if (res.status === 404) return null
    if (!res.ok) {
      throw new Error(`COS_HEAD_FAILED: ${res.status}`)
    }
    const len = res.headers.get('content-length')
    return {
      sizeBytes: len ? Number(len) : 0,
      contentType: res.headers.get('content-type'),
      etag: res.headers.get('etag'),
    }
  }

  getDownloadUrl(args: DownloadUrlArgs): SignedUrlResult {
    const filenameStar = encodeURIComponent(args.filename)
    const dispValue =
      args.disposition === 'attachment'
        ? `attachment; filename*=UTF-8''${filenameStar}`
        : `inline; filename*=UTF-8''${filenameStar}`
    const query: Record<string, string> = {
      'response-content-disposition': dispValue,
    }
    if (args.mimeType) query['response-content-type'] = args.mimeType
    const url = this.presign('GET', args.objectKey, args.ttlSeconds, query)
    return { url, expiresAt: new Date(Date.now() + args.ttlSeconds * 1000) }
  }

  getUploadUrl(args: UploadUrlArgs): UploadUrlResult {
    const url = this.presign('PUT', args.objectKey, args.ttlSeconds)
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': args.contentType || 'application/octet-stream' },
      expiresAt: new Date(Date.now() + args.ttlSeconds * 1000),
      direct: true,
    }
  }

  /** host(诊断 / 日志用,不含凭证)。 */
  host(): string {
    return cosHost(this.bucket, this.region)
  }
}

/** 读取错误响应体(截断),绝不抛二次错误。 */
async function safeBody(res: Response): Promise<string> {
  try {
    const text = await res.text()
    return text.slice(0, 300)
  } catch {
    return ''
  }
}
