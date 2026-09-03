/**
 * Webhook HMAC 密钥写入时的强度规则。
 *
 * 只用于 **create / rotate 写路径**。验签（sync.service）不得调用本文件——
 * 库里可能仍有历史短密钥，改验签规则会让既有对接方推送当场全 401。
 *
 * 服务端生成的密钥是 `randomBytes(32).toString('base64url')`（43 字符、~256 bit）。
 * 机构自填时达不到同样的 CSPRNG，但必须挡住「8 个可打印字符 ≈ HMAC 密钥熵」
 * 那种可离线撞库的空间。
 */

export const WEBHOOK_SECRET_MIN_LENGTH = 32
export const WEBHOOK_SECRET_MIN_ENTROPY_BITS = 128

export type WebhookSecretStrengthIssue = 'too_short' | 'low_entropy'

/** 经验香农熵（bit）= -Σ p log2 p × 长度。全相同字符为 0；均匀 hex 32 位约为 128。 */
export function estimateShannonBits(secret: string): number {
  if (secret.length === 0) return 0
  const freq = new Map<string, number>()
  for (const ch of secret) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1)
  }
  let shannon = 0
  const n = secret.length
  for (const count of freq.values()) {
    const p = count / n
    shannon -= p * Math.log2(p)
  }
  return shannon * n
}

export function webhookSecretStrengthIssue(secret: string): WebhookSecretStrengthIssue | null {
  if (secret.length < WEBHOOK_SECRET_MIN_LENGTH) return 'too_short'
  if (estimateShannonBits(secret) < WEBHOOK_SECRET_MIN_ENTROPY_BITS) return 'low_entropy'
  return null
}

/** 空白视为未提供，让 webhook 走服务端 CSPRNG、API 走「缺凭证」。 */
export function normalizeOptionalSecret(raw: string | undefined | null): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
