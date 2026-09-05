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

function ipv4Number(ip: string): number | null {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return (((parts[0]! * 256 + parts[1]!) * 256 + parts[2]!) * 256 + parts[3]!) >>> 0
}

function inIpv4Cidr(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (value & mask) === (base & mask)
}

const BLOCKED_IPV4_CIDRS: Array<[number, number]> = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
  [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
  [0xc0586300, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24],
  [0xcb007100, 24], [0xe0000000, 4], [0xf0000000, 4],
]

function expandIpv6(ip: string): number[] | null {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]!
  if (!net.isIPv6(normalized)) return null
  const halves = normalized.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null
  const words = [...left, ...Array(missing).fill('0'), ...right]
    .map((word) => Number.parseInt(word || '0', 16))
  return words.length === 8 && words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
    ? words
    : null
}

function embeddedIpv4(words: number[], start: number): string {
  return `${words[start]! >> 8}.${words[start]! & 0xff}.${words[start + 1]! >> 8}.${words[start + 1]! & 0xff}`
}

/**
 * 判断一个 IP(IPv4 或 IPv6)是否属于私有/保留地址。
 */
export function isPrivateOrReserved(ip: string): boolean {
  const normalized = ip.replace(/^\[|\]$/g, '').split('%')[0]!
  const mappedDotted = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
  if (mappedDotted) return isPrivateOrReserved(mappedDotted[1]!)
  if (net.isIPv4(normalized)) {
    const value = ipv4Number(normalized)
    return value === null || BLOCKED_IPV4_CIDRS.some(([base, prefix]) => inIpv4Cidr(value, base, prefix))
  }
  const words = expandIpv6(normalized)
  if (!words) return true
  if (words.every((word) => word === 0) || (words.slice(0, 7).every((word) => word === 0) && words[7] === 1)) return true
  if ((words[0]! & 0xfe00) === 0xfc00 || (words[0]! & 0xffc0) === 0xfe80 || (words[0]! & 0xff00) === 0xff00) return true
  if (words[0] === 0x2001 && words[1] === 0x0db8) return true
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return isPrivateOrReserved(embeddedIpv4(words, 6))
  }
  // RFC 6145 IPv4-translatable form (::ffff:0:0:0/96).
  if (words.slice(0, 4).every((word) => word === 0) && words[4] === 0xffff && words[5] === 0) {
    return isPrivateOrReserved(embeddedIpv4(words, 6))
  }
  if (words[0] === 0x0064 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0)) {
    return isPrivateOrReserved(embeddedIpv4(words, 6))
  }
  // RFC 8215 local-use NAT64 prefix is not globally routable.
  if (words[0] === 0x0064 && words[1] === 0xff9b && words[2] === 0x0001) return true
  if (words[0] === 0x2002) return isPrivateOrReserved(embeddedIpv4(words, 1))
  return false
}

export interface ResolvedPublicUrl {
  url: URL
  address: string
  family: 4 | 6
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
export async function resolvePublicUrl(rawUrl: string): Promise<ResolvedPublicUrl> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`SSRF_INVALID_URL: ${rawUrl.slice(0, 200)}`)
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error(`SSRF_PROTOCOL_NOT_ALLOWED: ${parsed.protocol}`)
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')

  // Reject bare IP literals directly — faster path that skips DNS
  if (net.isIP(hostname)) {
    if (isPrivateOrReserved(hostname)) {
      throw new Error(`SSRF_PRIVATE_IP_BLOCKED: ${hostname}`)
    }
    return { url: parsed, address: hostname, family: net.isIPv4(hostname) ? 4 : 6 }
  }

  let addresses: Array<{ address: string; family: 4 | 6 }>
  try {
    const result = await dns.lookup(hostname, { all: true })
    addresses = result.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }))
  } catch {
    throw new Error(`SSRF_DNS_RESOLUTION_FAILED: ${hostname}`)
  }

  if (addresses.length === 0) {
    throw new Error(`SSRF_DNS_RESOLUTION_FAILED: ${hostname} (no records)`)
  }

  for (const resolved of addresses) {
    if (isPrivateOrReserved(resolved.address)) {
      throw new Error(`SSRF_PRIVATE_IP_BLOCKED: ${hostname} resolves to ${resolved.address}`)
    }
  }
  return { url: parsed, ...addresses[0]! }
}

export async function validatePublicUrl(rawUrl: string): Promise<void> {
  await resolvePublicUrl(rawUrl)
}
