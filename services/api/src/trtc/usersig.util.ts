// TRTC UserSig 生成 — TLSSigAPIv2 算法
// 参考：https://cloud.tencent.com/document/product/647/17275
//
// 算法：
//   sig = base64( HMAC-SHA256( secretKey, contentToBeSigned ) )
//   doc = { TLS.ver, TLS.identifier, TLS.sdkappid, TLS.expire, TLS.time, TLS.sig }
//   userSig = base64url( zlib.deflate( JSON.stringify(doc) ) )
//
// SDKSecretKey 只在服务端使用，绝不下发前端。

import { createHmac, type BinaryLike } from 'node:crypto'
import { deflateSync } from 'node:zlib'

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '*')
    .replace(/\//g, '-')
    .replace(/=/g, '_')
}

function hmacSha256(
  key: BinaryLike,
  sdkAppId: number,
  userId: string,
  currTime: number,
  expire: number,
): string {
  const contentToBeSigned =
    `TLS.identifier:${userId}\n` +
    `TLS.sdkappid:${sdkAppId}\n` +
    `TLS.time:${currTime}\n` +
    `TLS.expire:${expire}\n`
  return createHmac('sha256', key)
    .update(contentToBeSigned)
    .digest('base64')
}

/**
 * 生成 TRTC UserSig
 * @param sdkAppId   应用 ID
 * @param secretKey  应用密钥（仅服务端）
 * @param userId     用户 ID
 * @param expire     有效期（秒），默认 300 秒（5 分钟）
 *                   Kiosk 公共终端场景：短 TTL 防止 UserSig 被截获后长期复用。
 *                   如果 AI 会话超过 5 分钟，前端应在到期前重新请求 session 端点。
 */
export function genUserSig(
  sdkAppId: number,
  secretKey: string,
  userId: string,
  expire = 300,
): string {
  const currTime = Math.floor(Date.now() / 1000)
  const sig = hmacSha256(secretKey, sdkAppId, userId, currTime, expire)

  const sigDoc: Record<string, unknown> = {
    'TLS.ver':        '2.0',
    'TLS.identifier': userId,
    'TLS.sdkappid':   sdkAppId,
    'TLS.expire':     expire,
    'TLS.time':       currTime,
    'TLS.sig':        sig,
  }

  const compressed = deflateSync(Buffer.from(JSON.stringify(sigDoc), 'utf8'))
  return base64url(compressed)
}
