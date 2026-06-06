/**
 * 对象存储后端抽象。
 *
 * 两个实现:
 *   - LocalStorageBackend:本地文件系统(dev / 默认),内容经 API 代理签名 URL 提供。
 *   - CosStorageBackend:腾讯云 COS(生产),内容经 COS 预签名 URL 直连。
 *
 * StorageService 按 FILE_STORAGE_DRIVER 选默认后端,并按文件记录的 bucket
 * 路由读/删,从而兼容"先本地后切 COS"的混合环境。
 */

/** 后端类型标识,落库到 FileObject.bucket 区分(本地用哨兵值)。 */
export const LOCAL_BUCKET_SENTINEL = 'local-fs'
export const LOCAL_REGION_SENTINEL = 'local'

export type StorageDriver = 'local' | 'cos'

export interface PutResult {
  /** 上传内容的 sha256(hex)。COS / 本地均由服务端就 buffer 计算。 */
  sha256: string
  sizeBytes: number
}

export interface HeadResult {
  sizeBytes: number
  contentType: string | null
  etag: string | null
}

export interface SignedUrlResult {
  url: string
  expiresAt: Date
}

export interface DownloadUrlArgs {
  objectKey: string
  /** 本地后端用 fileId 走 /files/:id/content 代理签名;COS 后端忽略。 */
  fileId: string
  filename: string
  mimeType: string
  ttlSeconds: number
  /** 'inline'(预览)| 'attachment'(下载)。 */
  disposition: 'inline' | 'attachment'
}

export interface UploadUrlArgs {
  objectKey: string
  /** 本地后端用 fileId 走 /files/:id/raw 代理写入;COS 后端忽略。 */
  fileId: string
  contentType: string
  ttlSeconds: number
}

export interface UploadUrlResult {
  url: string
  method: 'PUT'
  /** 客户端 PUT 时应带的请求头(如 Content-Type)。 */
  headers: Record<string, string>
  expiresAt: Date
  /** 直传是否落到 COS(true)还是回 API 代理写入(false,本地)。 */
  direct: boolean
}

export interface ObjectStorageBackend {
  readonly driver: StorageDriver
  /** 落库用:此后端的 bucket 标识。 */
  readonly bucket: string
  readonly region: string

  /** 服务端直接写入对象(校验后的 buffer)。 */
  putObject(objectKey: string, buffer: Buffer, contentType: string): Promise<PutResult>
  /** 服务端读取对象内容(供 /content 代理、打印兜底)。 */
  getObject(objectKey: string): Promise<Buffer>
  /** 物理删除对象(幂等)。 */
  deleteObject(objectKey: string): Promise<void>
  /** 获取对象元信息;不存在返回 null。 */
  headObject(objectKey: string): Promise<HeadResult | null>

  /** 生成短期下载 / 预览 URL。 */
  getDownloadUrl(args: DownloadUrlArgs): SignedUrlResult
  /** 生成短期上传 URL(直传凭证)。 */
  getUploadUrl(args: UploadUrlArgs): UploadUrlResult
}
