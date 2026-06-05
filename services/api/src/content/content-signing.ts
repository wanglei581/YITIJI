import { createHmac, timingSafeEqual } from 'crypto'

/**
 * 宣传屏素材签名 URL(HMAC-SHA256)。
 *
 * 与 files/signing.ts 同密钥(FILE_SIGNING_SECRET)、同算法,但:
 *   - message 前缀 'ad:',与文件签名命名空间隔离(一个签名不能跨用途复用)
 *   - 默认 TTL 更长(1 小时):屏保素材轮播周期可能较长,短 TTL 会导致
 *     视频播到一半签名过期而中断(评审 bug #7)
 *   - 路由独立:/api/v1/ad-assets/:id/content
 *
 * Kiosk 端缓存 key 用 assetId / sha256,绝不用签名 URL(URL 每次签发都变)。
 */

const KIOSK_TTL_MS = 60 * 60 * 1000 // 1 小时,供 Kiosk 播放
const PREVIEW_TTL_MS = 10 * 60 * 1000 // 10 分钟,供管理员后台预览

function getSecret(): string {
  const secret = process.env['FILE_SIGNING_SECRET']
  if (!secret || secret.length < 32) {
    throw new Error('FILE_SIGNING_SECRET environment variable must be set (≥ 32 chars)')
  }
  return secret
}

export function signAdAssetUrl(
  assetId: string,
  ttlMs: number = KIOSK_TTL_MS,
): { url: string; expiresAt: Date } {
  const expiresAtMs = Date.now() + ttlMs
  const message = `ad:${assetId}.${expiresAtMs}`
  const signature = createHmac('sha256', getSecret()).update(message).digest('hex')
  const url = `/api/v1/ad-assets/${assetId}/content?expires=${expiresAtMs}&sig=${signature}`
  return { url, expiresAt: new Date(expiresAtMs) }
}

/** 管理员预览用,短 TTL。 */
export function signAdAssetPreviewUrl(assetId: string): string {
  return signAdAssetUrl(assetId, PREVIEW_TTL_MS).url
}

export function verifyAdAssetSignature(assetId: string, expires: string, sig: string): boolean {
  const expiresMs = Number(expires)
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) return false
  const message = `ad:${assetId}.${expiresMs}`
  const expected = createHmac('sha256', getSecret()).update(message).digest('hex')
  if (sig.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}
