import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'
import { getDomain, getPublicSuffix } from 'tldts'

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/
const PSL_OPTIONS = { allowPrivateDomains: true } as const
// These delegated hosting roots are not yet in the bundled PSL. Treat each as
// a suffix until tldts includes it; a tenant may verify only its own child.
const PSL_GAP_SUFFIXES = ['gitee.io', 'myqcloud.com', 'aliyuncs.com'] as const

function effectiveSuffix(host: string): string | null {
  const listed = getPublicSuffix(host, PSL_OPTIONS)
  const gap = PSL_GAP_SUFFIXES.find((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  if (gap) return gap
  // Provincial government namespace is delegated below gov.cn, while the
  // current PSL only records gov.cn. Fail closed for any two-letter branch.
  const labels = host.split('.')
  if (labels.length >= 3 && labels.at(-2) === 'gov' && labels.at(-1) === 'cn'
      && /^[a-z]{2}$/.test(labels.at(-3) ?? '')) return labels.slice(-3).join('.')
  return listed
}

function normalizedHostname(raw: string): string | null {
  const host = domainToASCII(raw.trim().toLowerCase().replace(/\.$/, ''))
  if (!host || host === 'localhost' || host.endsWith('.local') || isIP(host) || !HOST_RE.test(host)) return null
  return host
}

export const COMMERCIAL_RECRUITMENT_REGISTRABLE_DOMAINS = [
  'zhipin.com', '51job.com', 'zhaopin.com', 'liepin.com',
] as const

export function registrableDomainOf(hostname: string): string | null {
  const host = normalizedHostname(hostname)
  if (!host) return null
  const suffix = effectiveSuffix(host)
  const domain = getDomain(host, PSL_OPTIONS)
  if (!suffix || !domain || host === suffix) return null
  if (suffix !== getPublicSuffix(host, PSL_OPTIONS)) {
    const prefix = host.slice(0, -(suffix.length + 1))
    const label = prefix.split('.').at(-1)
    return label ? `${label}.${suffix}` : null
  }
  return domain
}

export function isCommercialRecruitmentHost(hostname: string): boolean {
  const domain = registrableDomainOf(hostname)
  return domain !== null && (COMMERCIAL_RECRUITMENT_REGISTRABLE_DOMAINS as readonly string[]).includes(domain)
}

/** Values can be decoded by a later redirect handler. Inspect three further encoding layers. */
function withoutControls(value: string): string {
  return [...value].filter((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127).join('')
}

function redirectValue(raw: string): string {
  let value = withoutControls(raw)
  for (let i = 0; i < 3; i++) {
    let decoded: string
    try { decoded = decodeURIComponent(value) } catch { break }
    if (decoded === value) break
    value = withoutControls(decoded)
  }
  return value.trim().replace(/\\/g, '/')
}

function redirectValues(url: URL): string[] {
  const values = [...url.searchParams.values()]
  const fragment = url.hash.slice(1)
  if (fragment.includes('=')) values.push(...new URLSearchParams(fragment).values())
  return values
}

function inspectUrl(raw: string, allowedDomains: readonly string[] | undefined, base: URL | undefined, depth: number): URL | null {
  if (depth > 10) return null
  // URL normalizes :443 away, so inspect the original authority for a nondefault port.
  if (/^https:\/\/[^/?#]*:(?!443(?:[/?#]|$))\d+(?:[/?#]|$)/i.test(raw.trim())) return null
  let url: URL
  try { url = base ? new URL(raw, base) : new URL(raw.trim()) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  const host = normalizedHostname(url.hostname)
  if (!host || !registrableDomainOf(host)) return null
  url.hostname = host
  if (allowedDomains && !allowedDomains.some((domain) => hostMatchesVerifiedDomain(host, domain))) return null
  if (!allowedDomains) return url
  for (const rawValue of redirectValues(url)) {
    const target = redirectValue(rawValue)
    const scheme = /^[a-z][a-z\d+.-]*:/i.exec(target)
    if (!target.startsWith('/') && !scheme && !rawValue.trim().startsWith('\\')) continue
    // A leading backslash or a noncanonical scheme can be interpreted differently
    // by redirect handlers. Fail closed even if URL resolves it as a local path.
    if (rawValue.trim().startsWith('\\') || (scheme && !/^https:\/\//i.test(target))) return null
    if (!inspectUrl(target, allowedDomains, url, depth + 1)) return null
  }
  return url
}

/** Canonical HTTPS URL, including every redirect-looking query and fragment value. */
export function verifiedHttpsUrl(raw: string, allowedDomains?: readonly string[]): URL | null {
  return inspectUrl(raw, allowedDomains, undefined, 0)
}

export function httpsHostnameOf(raw: string): string | null {
  return verifiedHttpsUrl(raw)?.hostname ?? null
}

/** An administrator may verify a registered domain or a narrower hostname. */
export function verifiedDomainFromInput(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  const host = text.includes('://') || text.includes('/')
    ? verifiedHttpsUrl(text)?.hostname ?? null
    : normalizedHostname(text)
  return host && registrableDomainOf(host) ? host : null
}

export function hostMatchesVerifiedDomain(hostname: string, verifiedDomain: string): boolean {
  const host = normalizedHostname(hostname)
  const verified = normalizedHostname(verifiedDomain)
  return Boolean(host && verified && registrableDomainOf(host) && registrableDomainOf(verified)
    && (host === verified || host.endsWith(`.${verified}`)))
}
