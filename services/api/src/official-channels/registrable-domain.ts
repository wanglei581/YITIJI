import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'

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
  'github.io', 'gitee.io', 'pages.dev', 'vercel.app', 'netlify.app',
  'workers.dev', 'herokuapp.com', 'azurewebsites.net', 'blogspot.com',
  'firebaseapp.com', 'web.app', 'cloudfront.net', 'myqcloud.com', 'aliyuncs.com',
  ...[
    'ah', 'bj', 'cq', 'fj', 'gd', 'gs', 'gx', 'gz', 'ha', 'hb', 'he', 'hi',
    'hl', 'hn', 'jl', 'js', 'jx', 'ln', 'nm', 'nx', 'qh', 'sc', 'sd', 'sh',
    'sn', 'sx', 'tj', 'xj', 'xz', 'yn', 'zj',
  ].map((label) => `${label}.cn`),
  ...[
    'ah', 'bj', 'cq', 'fj', 'gd', 'gs', 'gx', 'gz', 'ha', 'hb', 'he', 'hi',
    'hl', 'hn', 'jl', 'js', 'jx', 'ln', 'nm', 'nx', 'qh', 'sc', 'sd', 'sh',
    'sn', 'sx', 'tj', 'xj', 'xz', 'yn', 'zj',
  ].map((label) => `${label}.gov.cn`),
])

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/
const SHARED_HOSTING_SUFFIXES = new Set([
  'github.io', 'gitee.io', 'pages.dev', 'vercel.app', 'netlify.app', 'workers.dev',
  'herokuapp.com', 'azurewebsites.net', 'blogspot.com', 'firebaseapp.com',
  'web.app', 'cloudfront.net', 'myqcloud.com', 'aliyuncs.com',
])

function normalizedHostname(raw: string): string | null {
  const host = domainToASCII(raw.trim().toLowerCase().replace(/\.$/, ''))
  if (!host || host === 'localhost' || host.endsWith('.local') || isIP(host) || !HOST_RE.test(host)) return null
  return host
}

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
  const host = normalizedHostname(hostname)
  if (!host) return null
  if ([...SHARED_HOSTING_SUFFIXES].some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return null
  const labels = host.split('.')
  const threeLabelSuffix = labels.slice(-3).join('.')
  if (MULTI_LABEL_PUBLIC_SUFFIXES.has(threeLabelSuffix)) {
    return labels.length >= 4 ? labels.slice(-4).join('.') : null
  }
  const suffix = labels.slice(-2).join('.')
  if (MULTI_LABEL_PUBLIC_SUFFIXES.has(suffix)) {
    if (labels.length < 3) return null
    return labels.slice(-3).join('.')
  }
  return labels.length >= 2 && !MULTI_LABEL_PUBLIC_SUFFIXES.has(host) ? labels.slice(-2).join('.') : null
}

/** 规范化 HTTPS URL。显式非 443 端口、userinfo、IP 与跨域重定向参数全部拒绝。 */
export function verifiedHttpsUrl(raw: string, allowedDomains?: readonly string[]): URL | null {
  if (/^https:\/\/[^/?#]*:(?!443(?:[/?#]|$))\d+(?:[/?#]|$)/i.test(raw.trim())) return null
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  const host = normalizedHostname(url.hostname)
  if (!host || !registrableDomainOf(host)) return null
  url.hostname = host
  if (allowedDomains && !allowedDomains.some((domain) => hostMatchesVerifiedDomain(host, domain))) return null
  for (const value of allowedDomains ? url.searchParams.values() : []) {
    const target = value.trim()
    if (!/^https?:\/\//i.test(target) && !target.startsWith('//')) continue
    let redirected: URL
    try { redirected = new URL(target, url) } catch { return null }
    const redirectHost = normalizedHostname(redirected.hostname)
    if (!redirectHost || !allowedDomains?.some((domain) => hostMatchesVerifiedDomain(redirectHost, domain))) return null
  }
  return url
}

export function httpsHostnameOf(raw: string): string | null {
  return verifiedHttpsUrl(raw)?.hostname ?? null
}

/** 管理员录入：裸注册域，或 https URL（取注册域）。公共后缀本身无效。 */
export function verifiedDomainFromInput(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  if (text.includes('://') || text.includes('/')) {
    const host = verifiedHttpsUrl(text)?.hostname
    return host ? registrableDomainOf(host) : null
  }
  const host = normalizedHostname(text)
  // An entered domain must itself be the registered root, not an arbitrary subdomain.
  return host && registrableDomainOf(host) === host ? host : null
}

export function hostMatchesVerifiedDomain(hostname: string, verifiedRegistrable: string): boolean {
  const host = normalizedHostname(hostname)
  const verified = normalizedHostname(verifiedRegistrable)
  return Boolean(host && verified && registrableDomainOf(verified) === verified
    && (host === verified || host.endsWith(`.${verified}`)))
}
