import { createHmac } from 'crypto'
import { decryptSecret, encryptSecret } from './secret-cipher'

/**
 * 内部运营账号登录邮箱隐私处理（Partner Wave 1）。
 *
 * - emailHash: HMAC-SHA256(规范化邮箱, pepper)，唯一查找用，不可逆
 * - emailEnc: AES-256-GCM 加密，仅服务端可解，用于脱敏展示
 * - 不存明文邮箱列；API 永不返回明文
 *
 * Wave 1 的 emailVerifiedAt 表示 Admin 受托人工核验（admin_manual），
 * 不是 SMTP/OTP 证明邮箱可达。
 */

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

export const EMAIL_VERIFY_METHOD_ADMIN_MANUAL = 'admin_manual' as const
export type EmailVerifyMethod = typeof EMAIL_VERIFY_METHOD_ADMIN_MANUAL

/** trim + lowercase；校验交给 DTO / isValidEmail。 */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  const normalized = normalizeEmail(email)
  if (normalized.length < 5 || normalized.length > 254) return false
  return EMAIL_RE.test(normalized)
}

export function hashEmail(email: string): string {
  const pepper = process.env['SECRET_ENCRYPTION_KEY']
  if (!pepper || pepper.length < 32) {
    throw new Error('SECRET_ENCRYPTION_KEY 未配置或长度不足 32,emailHash 无法生成。')
  }
  return createHmac('sha256', pepper).update(normalizeEmail(email)).digest('hex')
}

export function encryptEmail(email: string): string {
  return encryptSecret(normalizeEmail(email))
}

export function decryptEmail(emailEnc: string): string {
  return decryptSecret(emailEnc)
}

/** 脱敏：ab***@example.com。无法解析时返回 ***。 */
export function maskEmail(email: string): string {
  const normalized = normalizeEmail(email)
  const at = normalized.indexOf('@')
  if (at <= 0 || at === normalized.length - 1) return '***'
  const local = normalized.slice(0, at)
  const domain = normalized.slice(at + 1)
  if (local.length <= 2) return `${local[0] ?? '*'}***@${domain}`
  return `${local.slice(0, 2)}***@${domain}`
}

export function maskEmailFromEnc(emailEnc: string): string {
  return maskEmail(decryptSecret(emailEnc))
}
