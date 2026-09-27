/**
 * 本机构官方渠道的链接预检（3.14）。
 *
 * 只用来在弹窗里提前说明规则，**保存与否以服务端为准**：服务端
 * services/api/src/official-channels/registrable-domain.ts 按注册域比对、做中文域名 punycode
 * 与结尾点规范化、拒绝公共托管后缀；这里用浏览器 URL 解析做同方向的近似，不自称权威，
 * 所以预检不拦提交 —— 拦了反而可能挡住服务端其实接受的链接。
 *
 * 规则（与服务端 cleanUrl 的判定顺序一致）：
 *   1. 只接受不带账号、不带非 443 端口的 https 链接；
 *   2. 商业招聘网站不能设为官方渠道；
 *   3. 主机名必须等于某个已登记的官方域名，或是它的子域名；
 *   4. 查询参数里指向其他网站的跳转目标同样必须落在已登记域名内。
 */

export const OFFICIAL_CHANNEL_NAME_MAX = 40
export const OFFICIAL_CHANNEL_URL_MAX = 500
export const OFFICIAL_CHANNEL_ORDER_MAX = 999

/** 与服务端 COMMERCIAL_RECRUITMENT_REGISTRABLE_DOMAINS 同一份名单。 */
const COMMERCIAL_RECRUITMENT_DOMAINS = ['zhipin.com', '51job.com', 'zhaopin.com', 'liepin.com'] as const

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

export function hostWithinDomain(host: string, domain: string): boolean {
  const h = normalizeHost(host)
  const d = normalizeHost(domain)
  return Boolean(h && d && (h === d || h.endsWith(`.${d}`)))
}

export function matchedDomain(host: string, domains: readonly string[]): string | null {
  return domains.find((domain) => hostWithinDomain(host, domain)) ?? null
}

export type ChannelUrlCheck =
  | { kind: 'empty' }
  | { kind: 'not_url' }
  | { kind: 'not_https' }
  | { kind: 'credentials_or_port' }
  | { kind: 'commercial'; host: string }
  | { kind: 'no_domains'; host: string }
  | { kind: 'off_domain'; host: string }
  | { kind: 'redirect_off_domain'; host: string; target: string }
  | { kind: 'ok'; host: string; domain: string; canonical: string }

export function checkChannelUrl(raw: string, domains: readonly string[]): ChannelUrlCheck {
  const text = raw.trim()
  if (!text) return { kind: 'empty' }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { kind: 'not_url' }
  }
  if (url.protocol !== 'https:') return { kind: 'not_https' }
  // URL 解析会把 https 的 :443 规范掉；剩下的端口号与账号信息服务端一律拒绝。
  if (url.username || url.password || url.port) return { kind: 'credentials_or_port' }
  const host = normalizeHost(url.hostname)
  if (!host.includes('.')) return { kind: 'not_url' }
  if (COMMERCIAL_RECRUITMENT_DOMAINS.some((domain) => hostWithinDomain(host, domain))) {
    return { kind: 'commercial', host }
  }
  if (domains.length === 0) return { kind: 'no_domains', host }
  const domain = matchedDomain(host, domains)
  if (!domain) return { kind: 'off_domain', host }
  for (const value of url.searchParams.values()) {
    const target = value.trim()
    if (!/^https?:\/\//i.test(target) && !target.startsWith('//')) continue
    let redirected: URL
    try {
      redirected = new URL(target, url)
    } catch {
      return { kind: 'redirect_off_domain', host, target }
    }
    if (!matchedDomain(redirected.hostname, domains)) {
      return { kind: 'redirect_off_domain', host, target: normalizeHost(redirected.hostname) }
    }
  }
  url.hostname = host
  return { kind: 'ok', host, domain, canonical: url.toString() }
}

/** 规范化后的链接，用来判断「链接有没有真的改」；解析不了就原样返回。 */
export function canonicalChannelUrl(raw: string): string {
  try {
    const url = new URL(raw.trim())
    url.hostname = normalizeHost(url.hostname)
    return url.toString()
  } catch {
    return raw.trim()
  }
}

export interface ChannelUrlHint {
  tone: 'ok' | 'warn' | 'muted'
  text: string
}

export function channelUrlHint(check: ChannelUrlCheck, domains: readonly string[]): ChannelUrlHint {
  const listed = domains.join('、')
  switch (check.kind) {
    case 'empty':
      return { tone: 'muted', text: `以 https:// 开头；域名须是 ${listed || '已登记的官方域名'} 或其子域名` }
    case 'not_url':
      return { tone: 'warn', text: '这不是完整的网址，请以 https:// 开头填写完整链接' }
    case 'not_https':
      return { tone: 'warn', text: '只能保存 https:// 开头的链接，http 或其他协议保存时会被拒绝' }
    case 'credentials_or_port':
      return { tone: 'warn', text: '链接里不能带账号信息或端口号，保存时会被拒绝' }
    case 'commercial':
      return { tone: 'warn', text: `${check.host} 属于商业招聘网站，不能设为本机构官方渠道` }
    case 'no_domains':
      return { tone: 'warn', text: '本机构尚未登记官方域名，任何链接保存时都会被拒绝' }
    case 'off_domain':
      return { tone: 'warn', text: `${check.host} 不在已登记的官方域名（${listed}）内，保存时会被拒绝` }
    case 'redirect_off_domain':
      return {
        tone: 'warn',
        text: `链接里的跳转参数指向 ${check.target}，不在已登记的官方域名内，保存时会被拒绝`,
      }
    case 'ok':
      return { tone: 'ok', text: `${check.host} 属于已登记的官方域名 ${check.domain}` }
  }
}
