/**
 * 腾讯云 COS 请求签名(预签名 URL)。
 *
 * 严格复刻官方算法,见:
 *   https://cloud.tencent.com/document/product/436/7778
 * 并对齐官方 cos-js-sdk-v5 `util.getAuth` 的实现细节(键名小写排序、
 * camSafeUrlEncode、formatString 中 pathname 不做 URL 编码、签名时间回拨 1 秒)。
 *
 * 安全约束(CLAUDE.md §12、用户需求六):
 *   - SecretId / SecretKey 只存服务端,绝不下发前端、绝不写日志。
 *   - 预签名 URL 短 TTL(默认 ≤ 30 分钟,由 StorageService 控制)。
 *
 * 设计为**纯函数**(签名时间由参数注入),便于离线单测确定性复现,
 * 运行期由 CosStorageBackend 传入 `Math.floor(Date.now()/1000)`。
 */

import { createHash, createHmac } from 'crypto'

export interface CosSignParams {
  secretId: string
  secretKey: string
  bucket: string
  region: string
  /** HTTP 方法:GET | PUT | DELETE | HEAD(大小写不敏感)。 */
  method: string
  /** 对象键,不带前导 '/'。例:'users/u1/resumes/abc.pdf'。 */
  objectKey: string
  /** 有效期(秒)。 */
  ttlSeconds: number
  /** 需要随 URL 一起签名并发送的查询参数(如 response-content-disposition)。 */
  query?: Record<string, string>
  /** 签名起始时间(epoch 秒)。由调用方注入以保证可测;留空抛错。 */
  signTimeSec: number
}

/** RFC3986 URL 编码(对齐 COS camSafeUrlEncode)。 */
function camSafeUrlEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
}

/** 键名小写后升序排序,返回 { listStr: 'a;b;c', kvStr: 'a=1&b=2' }(均经 camSafeUrlEncode)。 */
function buildSortedParams(obj: Record<string, string>): { listStr: string; kvStr: string } {
  const lowered: Array<{ key: string; value: string }> = Object.keys(obj).map((k) => ({
    key: k.toLowerCase(),
    value: obj[k] ?? '',
  }))
  lowered.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const listStr = lowered.map((p) => p.key).join(';')
  const kvStr = lowered.map((p) => `${camSafeUrlEncode(p.key)}=${camSafeUrlEncode(p.value)}`).join('&')
  return { listStr, kvStr }
}

function hmacSha1Hex(key: string, data: string): string {
  return createHmac('sha1', key).update(data).digest('hex')
}

function sha1Hex(data: string): string {
  return createHash('sha1').update(data).digest('hex')
}

/** COS host:`{bucket}.cos.{region}.myqcloud.com`。 */
export function cosHost(bucket: string, region: string): string {
  return `${bucket}.cos.${region}.myqcloud.com`
}

/** objectKey → URL path(逐段编码,保留 '/';前导加 '/')。 */
export function objectKeyToUrlPath(objectKey: string): string {
  const key = objectKey.replace(/^\/+/, '')
  return '/' + key.split('/').map((seg) => camSafeUrlEncode(seg)).join('/')
}

/**
 * 仅生成 Authorization 字符串(q-sign-algorithm=...&...&q-signature=...)。
 * formatString 中 pathname 使用未编码的 `/{objectKey}`(与 cos-js-sdk 一致)。
 */
export function buildCosAuthorization(p: CosSignParams): string {
  if (!p.secretId || !p.secretKey) throw new Error('COS_CREDENTIALS_MISSING')
  if (!Number.isFinite(p.signTimeSec)) throw new Error('COS_SIGN_TIME_REQUIRED')

  // 回拨 1 秒以容忍轻微时钟偏差(对齐官方 SDK now = ...-1)。
  const now = Math.floor(p.signTimeSec) - 1
  const exp = now + Math.max(1, Math.floor(p.ttlSeconds))
  const keyTime = `${now};${exp}`

  const method = p.method.toLowerCase()
  const pathname = '/' + p.objectKey.replace(/^\/+/, '')

  const query = p.query ?? {}
  const { listStr: urlParamList, kvStr: httpParameters } = buildSortedParams(query)
  // 预签名模式不签 header(host 由 URL 隐含),qHeaderList 为空。
  const headerList = ''
  const httpHeaders = ''

  const signKey = hmacSha1Hex(p.secretKey, keyTime)
  const formatString = [method, pathname, httpParameters, httpHeaders, ''].join('\n')
  const stringToSign = ['sha1', keyTime, sha1Hex(formatString), ''].join('\n')
  const signature = hmacSha1Hex(signKey, stringToSign)

  return [
    'q-sign-algorithm=sha1',
    `q-ak=${p.secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    `q-url-param-list=${urlParamList}`,
    `q-signature=${signature}`,
  ].join('&')
}

/**
 * 生成完整预签名 URL(https)。
 * 已签名的 query 参数会随 URL 一并发送(顺序无关,但必须与签名一致)。
 */
export function buildCosPresignedUrl(p: CosSignParams): string {
  const authorization = buildCosAuthorization(p)
  const host = cosHost(p.bucket, p.region)
  const path = objectKeyToUrlPath(p.objectKey)

  const query = p.query ?? {}
  const { kvStr } = buildSortedParams(query)
  const queryPrefix = kvStr.length > 0 ? `${kvStr}&` : ''
  return `https://${host}${path}?${queryPrefix}${authorization}`
}
