import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

/**
 * 凭证加密层(AES-256-GCM)。
 *
 * 用于 JobSource.encryptedCredential — 企业 API token、OAuth refresh token、
 * Webhook 接收密钥等敏感凭证落库前必须经此加密。
 *
 * 密钥来源:env `SECRET_ENCRYPTION_KEY`,32 字节以上的随机串(推荐 64 hex)。
 * 用 scrypt 派生固定 32 字节 key,避免直接拿用户给的密钥做 AES key 的对齐风险。
 *
 * 数据格式(返回 / 接受):base64 串拼接 `{iv}:{ciphertext}:{authTag}`
 *   - iv: 12 字节(GCM 推荐)
 *   - authTag: 16 字节
 *
 * 不返回前端,不出现在日志,不打印到 stdout。
 */

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const SALT = Buffer.from('ai-job-print-cipher-salt-v1', 'utf-8')  // 应用级常量盐(可换密钥时改版本)

let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (cachedKey) return cachedKey
  const raw = process.env['SECRET_ENCRYPTION_KEY']
  if (!raw || raw.length < 32) {
    throw new Error('SECRET_ENCRYPTION_KEY env var must be set (≥ 32 chars)')
  }
  // scrypt 把任意长度输入派生为固定 32 字节,适合 AES-256
  cachedKey = scryptSync(raw, SALT, 32)
  return cachedKey
}

/** 加密任意 UTF-8 明文 → base64 容器(iv:ct:tag)。 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, getKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`
}

/** 解密容器 → 原文。容器损坏 / 篡改 / 解 key 不对 一律抛 'CIPHER_FAILED'(不暴露原因)。 */
export function decryptSecret(packed: string): string {
  const parts = packed.split(':')
  if (parts.length !== 3) throw new Error('CIPHER_FAILED')
  try {
    const iv = Buffer.from(parts[0]!, 'base64')
    const ct = Buffer.from(parts[1]!, 'base64')
    const tag = Buffer.from(parts[2]!, 'base64')
    if (iv.length !== IV_LEN || tag.length !== 16) throw new Error('CIPHER_FAILED')
    const decipher = createDecipheriv(ALGO, getKey(), iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(ct), decipher.final()])
    return plain.toString('utf-8')
  } catch {
    throw new Error('CIPHER_FAILED')
  }
}

/** 生成 32 字符随机 webhook 密钥(供"重新生成"操作)。 */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('base64url')
}
