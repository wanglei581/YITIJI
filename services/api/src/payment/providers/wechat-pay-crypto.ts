/**
 * 微信支付回调的验签串与 resource 加解密（从 wechat-pay.provider.ts 拆出，口径不变）。
 * encryptWechatCallbackResource 只给 verify 脚本模拟渠道侧用；生产回调只做解密。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/** 回调验签 base（与微信支付平台侧构造一致；verify 脚本模拟渠道侧时共用，避免口径漂移）。 */
export function buildWechatCallbackVerifyBase(input: {
  timestamp: string
  nonce: string
  rawBody: Buffer | string
}): string {
  const body = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8')
  return `${input.timestamp}\n${input.nonce}\n${body}\n`
}

/**
 * AES-256-GCM 加密交易对象为回调 resource（**仅 verify 脚本模拟渠道侧使用**；
 * 生产回调只做解密）。与 decryptWechatResource 同一口径。
 */
export function encryptWechatCallbackResource(
  plaintext: string,
  apiV3Key: string,
  associatedData = 'transaction',
): { ciphertext: string; nonce: string; associated_data: string } {
  // nonce 用 ASCII 串（与真实回调一致），解密侧按 utf8 还原为同一 iv 字节序列。
  const nonceStr = randomBytes(8).toString('hex') // 16 ASCII chars
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(nonceStr, 'utf8'))
  cipher.setAAD(Buffer.from(associatedData, 'utf8'))
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: Buffer.concat([encrypted, tag]).toString('base64'),
    nonce: nonceStr,
    associated_data: associatedData,
  }
}

export function decryptWechatResource(
  resource: { ciphertext: string; nonce: string; associated_data?: string },
  apiV3Key: string,
): string | null {
  try {
    const buf = Buffer.from(resource.ciphertext, 'base64')
    if (buf.length < 16) return null
    const data = buf.subarray(0, buf.length - 16)
    const tag = buf.subarray(buf.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(resource.nonce, 'utf8'))
    if (resource.associated_data) decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return null // 解密失败（密钥不符/报文被改）→ 上层返回明确错误码，绝不半解析
  }
}
