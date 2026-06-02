// 腾讯云 API TC3-HMAC-SHA256 签名 + 调用
// 参考：https://cloud.tencent.com/document/api/647/82518（StartAIConversation）
//       https://cloud.tencent.com/document/api/213/30654（TC3 签名）
//
// SecretId / SecretKey 是腾讯云账号 API 密钥（CAM），只在服务端使用。

import { createHash, createHmac } from 'node:crypto'

const HOST    = 'trtc.tencentcloudapi.com'
const SERVICE = 'trtc'
const VERSION = '2019-07-22'

function sha256hex(msg: string): string {
  return createHash('sha256').update(msg, 'utf8').digest('hex')
}

function hmac(key: Buffer | string, msg: string): Buffer {
  return createHmac('sha256', key).update(msg, 'utf8').digest()
}

interface TencentApiOptions {
  secretId:  string
  secretKey: string
  region:    string
  action:    string
  payload:   Record<string, unknown>
}

/** 调用腾讯云 TRTC API，自动完成 TC3 签名 */
export async function callTencentApi<T = unknown>(opts: TencentApiOptions): Promise<T> {
  const { secretId, secretKey, region, action, payload } = opts

  const timestamp = Math.floor(Date.now() / 1000)
  const date      = new Date(timestamp * 1000).toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
  const body      = JSON.stringify(payload)

  // ── 1. CanonicalRequest ──────────────────────────────────
  const canonicalHeaders =
    `content-type:application/json; charset=utf-8\n` +
    `host:${HOST}\n`
  const signedHeaders = 'content-type;host'
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256hex(body),
  ].join('\n')

  // ── 2. StringToSign ──────────────────────────────────────
  const credentialScope = `${date}/${SERVICE}/tc3_request`
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    sha256hex(canonicalRequest),
  ].join('\n')

  // ── 3. Signature ─────────────────────────────────────────
  const secretDate    = hmac(`TC3${secretKey}`, date)
  const secretService = hmac(secretDate, SERVICE)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature     = createHmac('sha256', secretSigning)
    .update(stringToSign, 'utf8')
    .digest('hex')

  // ── 4. Authorization ─────────────────────────────────────
  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(`https://${HOST}`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json; charset=utf-8',
      'Host':          HOST,
      'X-TC-Action':   action,
      'X-TC-Version':  VERSION,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region':   region,
      'Authorization': authorization,
    },
    body,
  })

  const json = await res.json() as { Response?: { Error?: { Code: string; Message: string } } & T }
  if (json.Response?.Error) {
    throw new Error(`${json.Response.Error.Code}: ${json.Response.Error.Message}`)
  }
  return json.Response as T
}
