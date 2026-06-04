import { createHmac } from 'crypto'
import { decryptSecret, encryptSecret } from './secret-cipher'

/**
 * C 端手机号隐私处理(阶段 A)。
 *
 * - phoneHash: HMAC-SHA256(规范化手机号, pepper),唯一查找用,不可逆
 *   pepper 复用 SECRET_ENCRYPTION_KEY,避免新增环境变量;同一手机号稳定映射同一 hash。
 * - phoneEnc:  AES-256-GCM 加密(复用 secret-cipher),仅服务端可解,用于派生脱敏展示。
 * - 不存明文手机号列;API 永不返回明文,前端只见 maskPhone() 结果。
 */

const CN_MOBILE = /^1[3-9]\d{9}$/

/** 去除空格/连字符。校验交给 DTO(@Matches),此处仅兜底。 */
export function normalizePhone(input: string): string {
  return input.replace(/[\s-]/g, '')
}

export function isValidCnMobile(phone: string): boolean {
  return CN_MOBILE.test(phone)
}

/** HMAC-SHA256 手机号 → 唯一查找键。 */
export function hashPhone(phone: string): string {
  const pepper = process.env['SECRET_ENCRYPTION_KEY']
  if (!pepper || pepper.length < 32) {
    throw new Error('SECRET_ENCRYPTION_KEY 未配置或长度不足 32,phoneHash 无法生成。')
  }
  return createHmac('sha256', pepper).update(normalizePhone(phone)).digest('hex')
}

/** 加密手机号(落库 phoneEnc)。 */
export function encryptPhone(phone: string): string {
  return encryptSecret(normalizePhone(phone))
}

/** 脱敏:138****1234。非 11 位一律返回掩码,绝不回明文。 */
export function maskPhone(phone: string): string {
  const p = normalizePhone(phone)
  if (p.length !== 11) return '***'
  return `${p.slice(0, 3)}****${p.slice(7)}`
}

/** 从 phoneEnc 解密并脱敏(给 /me、登录响应用,明文不出服务端)。 */
export function maskPhoneFromEnc(phoneEnc: string): string {
  return maskPhone(decryptSecret(phoneEnc))
}
