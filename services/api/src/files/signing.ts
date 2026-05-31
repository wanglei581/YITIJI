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
