import { createHmac, timingSafeEqual } from 'crypto'

/**
 * 招聘会活动资料签名 URL(HMAC-SHA256)。
 *
 * 与 content/content-signing.ts(宣传屏素材)同密钥(FILE_SIGNING_SECRET)、同算法,但:
 *   - message 前缀 'fairmat:',独立命名空间,一个签名不能跨用途复用
 *   - 路由独立:/api/v1/job-fairs/materials/:id/content
 *   - Kiosk 浏览 TTL 30 分钟(资料页停留 + 预览即可),Admin 预览 10 分钟
 *
 * 安全:原始 storageKey 绝不出现在响应里,Kiosk/Admin 只拿到签名短时 URL。
 */

const KIOSK_TTL_MS = 30 * 60 * 1000
const PREVIEW_TTL_MS = 10 * 60 * 1000

function getSecret(): string {
  const secret = process.env['FILE_SIGNING_SECRET']
  if (!secret || secret.length < 32) {
    throw new Error('FILE_SIGNING_SECRET environment variable must be set (≥ 32 chars)')
  }
  return secret
}

export function signFairMaterialUrl(
  materialId: string,
  ttlMs: number = KIOSK_TTL_MS,
): { url: string; expiresAt: Date } {
  const expiresAtMs = Date.now() + ttlMs
  const message = `fairmat:${materialId}.${expiresAtMs}`
  const signature = createHmac('sha256', getSecret()).update(message).digest('hex')
  const url = `/api/v1/job-fairs/materials/${materialId}/content?expires=${expiresAtMs}&sig=${signature}`
  return { url, expiresAt: new Date(expiresAtMs) }
}

/** 管理员后台预览用,短 TTL。 */
export function signFairMaterialPreviewUrl(materialId: string): string {
  return signFairMaterialUrl(materialId, PREVIEW_TTL_MS).url
}

export function verifyFairMaterialSignature(materialId: string, expires: string, sig: string): boolean {
  const expiresMs = Number(expires)
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) return false
  const message = `fairmat:${materialId}.${expiresMs}`
  const expected = createHmac('sha256', getSecret()).update(message).digest('hex')
  if (sig.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}
