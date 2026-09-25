import { isIP } from 'node:net'

/**
 * 注册域（eTLD+1）比对。
 * 不用字符串前缀或后缀：evil-example.com.cn 会冒充 example.com.cn，
 * example.com.attacker.cn 会冒充 example.com。
 */
const MULTI_LABEL_PUBLIC_SUFFIXES = new Set<string>([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn', 'mil.cn',
  'com.hk', 'edu.hk', 'gov.hk', 'com.tw', 'edu.tw', 'gov.tw',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au', 'edu.au',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  ...[
    'ah', 'bj', 'cq', 'fj', 'gd', 'gs', 'gx', 'gz', 'ha', 'hb', 'he', 'hi',
    'hl', 'hn', 'jl', 'js', 'jx', 'ln', 'nm', 'nx', 'qh', 'sc', 'sd', 'sh',
    'sn', 'sx', 'tj', 'xj', 'xz', 'yn', 'zj',
  ].map((label) => `${label}.cn`),
])

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export const COMMERCIAL_RECRUITMENT_REGISTRABLE_DOMAINS = [
  'zhipin.com',
  '51job.com',
  'zhaopin.com',
  'liepin.com',
] as const

export function isCommercialRecruitmentHost(hostname: string): boolean {
  const registrable = registrableDomainOf(hostname)
  return registrable !== null
    && (COMMERCIAL_RECRUITMENT_REGISTRABLE_DOMAINS as readonly string[]).includes(registrable)
}

export function registrableDomainOf(hostname: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!host || host === 'localhost' || host.endsWith('.local') || isIP(host)) return null
  if (!HOST_RE.test(host)) return null
  const labels = host.split('.')
  const suffix = labels.slice(-2).join('.')
  if (MULTI_LABEL_PUBLIC_SUFFIXES.has(suffix)) {
    if (labels.length < 3) return null
    return labels.slice(-3).join('.')
  }
  return labels.length >= 2 ? labels.slice(-2).join('.') : null
}

/** https URL 的主机名。拒绝用户名、密码和非 https。 */
export function httpsHostnameOf(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  return registrableDomainOf(host) ? host : null
}

/** 管理员录入：裸注册域，或 https URL（取注册域）。公共后缀本身无效。 */
export function verifiedDomainFromInput(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  if (text.includes('://') || text.includes('/')) {
    const host = httpsHostnameOf(text)
    return host ? registrableDomainOf(host) : null
  }
  return registrableDomainOf(text)
}

export function hostMatchesVerifiedDomain(hostname: string, verifiedRegistrable: string): boolean {
  const hostDomain = registrableDomainOf(hostname)
  const verified = registrableDomainOf(verifiedRegistrable)
  return Boolean(hostDomain && verified && hostDomain === verified)
}
