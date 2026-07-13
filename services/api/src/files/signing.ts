import { createHmac, timingSafeEqual } from 'crypto'

/**
 * 文件签名 URL(HMAC-SHA256)。
 *
 * 合规要求(CLAUDE.md §11/§12):
 *   - 文件 URL 必须临时,默认 TTL 5 分钟
 *   - 签名密钥仅服务端持有(环境变量 FILE_SIGNING_SECRET)
 *   - 校验失败 / 过期返回 401,且不暴露区分原因(防探测)
 *
 * 签名规则:
 *   message = `${fileId}.${expiresAt}`         (毫秒时间戳)
 *   signature = hex(HMAC_SHA256(secret, message))
 *
 * URL 形如:
 *   /api/v1/files/<fileId>/content?expires=<ms>&sig=<hex>
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 分钟

function getSecret(): string {
  const secret = process.env['FILE_SIGNING_SECRET']
  if (!secret || secret.length < 32) {
    throw new Error('FILE_SIGNING_SECRET environment variable must be set (≥ 32 chars)')
  }
  return secret
}

/** 生成签名 URL(返回 path + query,不含 host,host 由前端 / API_BASE_URL 拼)。 */
export function signFileUrl(fileId: string, ttlMs: number = DEFAULT_TTL_MS): { url: string; expiresAt: Date } {
  const expiresAtMs = Date.now() + ttlMs
  const message = `${fileId}.${expiresAtMs}`
  const signature = createHmac('sha256', getSecret()).update(message).digest('hex')
  const url = `/api/v1/files/${fileId}/content?expires=${expiresAtMs}&sig=${signature}`
  return { url, expiresAt: new Date(expiresAtMs) }
}

/**
 * 校验签名 URL 的参数。返回 true 表示有效。
 * 用 timingSafeEqual 防侧信道(虽然 hex string 比较的实际收益有限,但合规上必须)。
 */
export function verifyFileSignature(fileId: string, expires: string, sig: string): boolean {
  const expiresMs = Number(expires)
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
    return false
  }
  const message = `${fileId}.${expiresMs}`
  const expected = createHmac('sha256', getSecret()).update(message).digest('hex')

  if (sig.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

/**
 * 仅解析本系统 content URL 中的文件 ID，不验签、不访问存储。
 * 用于已持久化 PrintTask 的内部关联；新建任务仍必须调用 verifyFileSignature。
 */
export function parseContentFileId(fileUrl: string): string | null {
  try {
    const pathname = new URL(fileUrl, 'http://internal.local').pathname
    return pathname.match(/\/files\/([^/]+)\/content$/)?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * 原始字节直传签名(本地后端 upload-intent 用)。
 *
 * COS 后端的 upload-intent 直接返回 COS 预签名 PUT URL;本地后端没有 COS,
 * 故返回一个指向 API 自身 `PUT /files/:id/raw` 的短期签名 URL,让"创建意图 →
 * 客户端直传 → complete"在 dev 与生产保持同一套前端流程。
 *
 * 与下载签名隔离 message 命名空间(前缀 'raw-upload.'),避免下载签名被复用为写入。
 */
export function signRawUploadUrl(fileId: string, ttlMs: number = DEFAULT_TTL_MS): { url: string; expiresAt: Date } {
  const expiresAtMs = Date.now() + ttlMs
  const message = `raw-upload.${fileId}.${expiresAtMs}`
  const signature = createHmac('sha256', getSecret()).update(message).digest('hex')
  const url = `/api/v1/files/${fileId}/raw?expires=${expiresAtMs}&sig=${signature}`
  return { url, expiresAt: new Date(expiresAtMs) }
}

/** 校验原始直传签名。 */
export function verifyRawUploadSignature(fileId: string, expires: string, sig: string): boolean {
  const expiresMs = Number(expires)
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
    return false
  }
  const message = `raw-upload.${fileId}.${expiresMs}`
  const expected = createHmac('sha256', getSecret()).update(message).digest('hex')
  if (sig.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

/**
 * 解析并验签本系统内部 content URL（/files/:id/content?expires&sig）。
 * 返回 { fileId } 表示签名有效且未过期；null 表示格式非法/验签失败/已过期。
 * 供签章等"以 URL 为访问凭证"的内部文件变换端点使用；仅校验、不读取存储。
 * （print-conversion / print-jobs / print-page-count 各自的私有解析器收敛
 *   到本函数属独立重构任务，本次不动它们 —— 见 sign-stamp 设计 §九。）
 */
export function parseAndVerifySignedContentUrl(url: string): { fileId: string } | null {
  try {
    const parsed = new URL(url, 'http://internal.local')
    const match = parsed.pathname.match(/\/files\/([^/]+)\/content$/)
    const expires = parsed.searchParams.get('expires')
    const sig = parsed.searchParams.get('sig')
    if (!match || !expires || !sig) return null
    const fileId = match[1]!
    return verifyFileSignature(fileId, expires, sig) ? { fileId } : null
  } catch {
    return null
  }
}
