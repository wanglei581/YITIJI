import { stringify } from 'querystring'
import * as BaiduBCE from '@baiducloud/sdk'

export interface BosSigningConfig {
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  endpoint: string
}

export function normalizeBosEndpoint(endpoint: string): string {
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    throw new Error('BOS_ENDPOINT_INVALID')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('BOS_ENDPOINT_INVALID')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('BOS_ENDPOINT_INVALID')
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('BOS_ENDPOINT_INVALID')
  }
  return parsed.origin
}

function resourcePath(bucket: string, objectKey: string): string {
  const safeBucket = encodeURIComponent(bucket)
  const safeKey = objectKey.split('/').map((part) => encodeURIComponent(part)).join('/')
  return `/v1/${safeBucket}/${safeKey}`
}

/**
 * 生成 BCE V1 query authorization URL。
 *
 * 固定使用 path-style regional endpoint，避免 bucket virtual-host 与自定义 endpoint
 * 组合时出现双重 bucket。签名算法由百度官方 SDK 的 Auth 实现提供。
 */
export function buildBosPresignedUrl(args: {
  config: BosSigningConfig
  method: 'GET' | 'PUT'
  objectKey: string
  ttlSeconds: number
  contentType?: string
  query?: Record<string, string>
  nowSeconds?: number
}): string {
  const endpoint = normalizeBosEndpoint(args.config.endpoint)
  const resource = resourcePath(args.config.bucket, args.objectKey)
  const headers: Record<string, string> = { Host: new URL(endpoint).host }
  const headersToSign = ['host']
  if (args.contentType) {
    headers['Content-Type'] = args.contentType
    headersToSign.push('content-type')
  }

  const query = { ...(args.query ?? {}) }
  const auth = new BaiduBCE.Auth(args.config.accessKeyId, args.config.secretAccessKey)
  const authorization = auth.generateAuthorization(
    args.method,
    resource,
    query,
    headers,
    args.nowSeconds,
    args.ttlSeconds,
    headersToSign,
  )

  return `${endpoint}${resource}?${stringify({ ...query, authorization })}`
}
