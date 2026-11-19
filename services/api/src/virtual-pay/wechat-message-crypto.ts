import { createDecipheriv, createHash, timingSafeEqual } from 'crypto'

/** 核对表 4.13、补充规则 4：安全模式用 msg_signature，不要用 signature。 */
export class WechatMessageCryptoError extends Error {
  constructor(readonly code: 'VPAY_DECRYPT_FAILED' | 'VPAY_APPID_MISMATCH') {
    super(code)
  }
}

/** EncodingAESKey 是 43 位，补 '=' 后 base64 必须解出 32 字节。 */
export function isWechatEncodingAesKey(value: string): boolean {
  if (value.length !== 43) return false
  return Buffer.from(`${value}=`, 'base64').length === 32
}

/** SHA1(字典序拼接)。GET 用 token、timestamp、nonce；POST 再加 Encrypt。核对表 4.12、4.13。 */
export function wechatSha1Signature(parts: readonly string[]): string {
  return createHash('sha1').update([...parts].sort().join(''), 'utf8').digest('hex')
}

export function wechatSignaturesMatch(actual: string, expected: string): boolean {
  if (actual.length === 0 || actual.length !== expected.length) return false
  const left = Buffer.from(actual.toLowerCase(), 'utf8')
  const right = Buffer.from(expected.toLowerCase(), 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * 安全模式 AES-256-CBC。密钥是 EncodingAESKey 补 '=' 后的 32 字节，IV 是前 16 字节。
 * 明文：16 字节随机数 + 4 字节大端长度 + 消息 + AppID。填充块大小是 32，不是 Node 默认的 16。
 * 核对表 4.13、补充规则 4。
 */
export function decryptWechatMessage(encryptBase64: string, encodingAesKey: string, expectedAppId: string): string {
  const key = Buffer.from(`${encodingAesKey}=`, 'base64')
  if (key.length !== 32) throw new WechatMessageCryptoError('VPAY_DECRYPT_FAILED')
  let decrypted: Buffer
  try {
    const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16))
    decipher.setAutoPadding(false)
    decrypted = Buffer.concat([decipher.update(Buffer.from(encryptBase64, 'base64')), decipher.final()])
  } catch {
    throw new WechatMessageCryptoError('VPAY_DECRYPT_FAILED')
  }
  const plain = unpad32(decrypted)
  if (plain.length < 20) throw new WechatMessageCryptoError('VPAY_DECRYPT_FAILED')
  const msgLen = plain.readUInt32BE(16)
  if (msgLen < 0 || 20 + msgLen > plain.length) throw new WechatMessageCryptoError('VPAY_DECRYPT_FAILED')
  const message = plain.subarray(20, 20 + msgLen).toString('utf8')
  const appId = plain.subarray(20 + msgLen).toString('utf8')
  if (appId !== expectedAppId) throw new WechatMessageCryptoError('VPAY_APPID_MISMATCH')
  return message
}

function unpad32(buf: Buffer): Buffer {
  if (buf.length === 0 || buf.length % 32 !== 0) throw new WechatMessageCryptoError('VPAY_DECRYPT_FAILED')
  const pad = buf[buf.length - 1] ?? 0
  if (pad < 1 || pad > 32) throw new WechatMessageCryptoError('VPAY_DECRYPT_FAILED')
  for (let i = 0; i < pad; i += 1) {
    if (buf[buf.length - 1 - i] !== pad) throw new WechatMessageCryptoError('VPAY_DECRYPT_FAILED')
  }
  return buf.subarray(0, buf.length - pad)
}
