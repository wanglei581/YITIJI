/**
 * 本地文件系统存储后端(dev / 默认)。
 *
 * 内容不直连下载:下载 / 预览 URL 指向 API 自身 `/files/:id/content` 代理端点,
 * 由 HMAC 签名 + 短 TTL 保护(沿用 BE-1 既有机制)。上传 URL 指向 `/files/:id/raw`。
 *
 * 复用 LocalFileStorage 的 putAtKey/read/delete/head(含路径越界防护)。
 */
import { LocalFileStorage } from '../files/storage'
import { signFileUrl, signRawUploadUrl } from '../files/signing'
import {
  LOCAL_BUCKET_SENTINEL,
  LOCAL_REGION_SENTINEL,
  type DownloadUrlArgs,
  type HeadResult,
  type ObjectStorageBackend,
  type PutResult,
  type SignedUrlResult,
  type StorageDriver,
  type UploadUrlArgs,
  type UploadUrlResult,
} from './storage.interface'

export class LocalStorageBackend implements ObjectStorageBackend {
  readonly driver: StorageDriver = 'local'
  readonly bucket = LOCAL_BUCKET_SENTINEL
  readonly region = LOCAL_REGION_SENTINEL

  private readonly fsStorage = new LocalFileStorage()

  async putObject(objectKey: string, buffer: Buffer): Promise<PutResult> {
    return this.fsStorage.putAtKey(objectKey, buffer)
  }

  async getObject(objectKey: string): Promise<Buffer> {
    return this.fsStorage.read(objectKey)
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.fsStorage.delete(objectKey)
  }

  async headObject(objectKey: string): Promise<HeadResult | null> {
    const head = await this.fsStorage.head(objectKey)
    if (!head) return null
    return { sizeBytes: head.sizeBytes, contentType: null, etag: null }
  }

  getDownloadUrl(args: DownloadUrlArgs): SignedUrlResult {
    const { url, expiresAt } = signFileUrl(args.fileId, args.ttlSeconds * 1000)
    // disposition 仅为展示提示,不参与签名(访问授权完全由 sig 决定)。
    const withDisp = args.disposition === 'attachment' ? `${url}&disposition=attachment` : url
    return { url: withDisp, expiresAt }
  }

  getUploadUrl(args: UploadUrlArgs): UploadUrlResult {
    const { url, expiresAt } = signRawUploadUrl(args.fileId, args.ttlSeconds * 1000)
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': args.contentType },
      expiresAt,
      direct: false,
    }
  }
}
