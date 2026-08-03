/**
 * SSRF 防护守卫。
 *
 * 在向合作机构配置的外部 URL 发起 HTTP 请求前,通过 DNS 解析验证目标 IP 不属于
 * 私有/保留地址段,防止服务端被当作 SSRF 代理访问内网或云平台元数据接口
 * (如 169.254.169.254/latest/meta-data/)。
 *
 * 用法:
 *   await validatePublicUrl(endpoint)   // 首次请求前
 *   await validatePublicUrl(redirectTarget) // 每次跟随重定向前
 *
 * 抛出 Error 而非 NestJS 异常,调用方负责决定如何处理(通常记入 SyncLog)。
 */
import { URL } from 'url'
import { promises as dns } from 'dns'
import * as net from 'net'

/** IPv4 私有/保留地址段正则。 */
const PRIVATE_IPV4_RANGES: RegExp[] = [
  /^127\./,                                   // loopback
  /^10\./,                                    // RFC 1918 Class A
  /^172\.(1[6-9]|2\d|3[01])\./,              // RFC 1918 Class B
  /^192\.168\./,                              // RFC 1918 Class C
  /^169\.254\./,                              // link-local / APIPA
  /^0\./,                                     // "this" network
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // RFC 6598 shared address
]

/**
 * 判断一个 IP(IPv4 或 IPv6)是否属于私有/保留地址。
 */
export function isPrivateOrReserved(ip: string): boolean {
  if (net.isIPv6(ip)) {
    return (
      ip === '::1' ||
      ip.startsWith('fc') ||
      ip.startsWith('fd') ||
      ip.startsWith('fe80') ||
      ip === '::' // unspecified
    )
  }
  return PRIVATE_IPV4_RANGES.some((r) => r.test(ip))
}

/**
 * 验证 URL 合法且解析到公网 IP。
 *
 * - 协议必须是 http: 或 https:
 * - 主机名可解析
 * - 所有解析结果均不在私有/保留地址段
 *
 * @throws Error with code prefix SSRF_* on violation
 */
export async function validatePublicUrl(rawUrl: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`SSRF_INVALID_URL: ${rawUrl.slice(0, 200)}`)
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error(`SSRF_PROTOCOL_NOT_ALLOWED: ${parsed.protocol}`)
  }

  const hostname = parsed.hostname

  // Reject bare IP literals directly — faster path that skips DNS
  if (net.isIP(hostname)) {
    if (isPrivateOrReserved(hostname)) {
      throw new Error(`SSRF_PRIVATE_IP_BLOCKED: ${hostname}`)
    }
    return
  }

  let addresses: string[]
  try {
    const result = await dns.lookup(hostname, { all: true })
    addresses = result.map((r) => r.address)
  } catch {
    throw new Error(`SSRF_DNS_RESOLUTION_FAILED: ${hostname}`)
  }

  if (addresses.length === 0) {
    throw new Error(`SSRF_DNS_RESOLUTION_FAILED: ${hostname} (no records)`)
  }

  for (const addr of addresses) {
    if (isPrivateOrReserved(addr)) {
      throw new Error(`SSRF_PRIVATE_IP_BLOCKED: ${hostname} resolves to ${addr}`)
    }
  }
}
