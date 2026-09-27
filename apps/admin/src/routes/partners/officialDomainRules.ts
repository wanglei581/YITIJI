/**
 * 机构官方域名登记（入驻核验，3.14）的录入预检与替换差异。
 *
 * 保存与否以服务端为准：services/api/src/official-channels/registrable-domain.ts 按注册域判定
 * （公共后缀本身、公共托管后缀、商业招聘网站都拒绝）。这里只拦**格式上一定不对**的输入，
 * 其余交给服务端，服务端拒绝时把它的中文原因原样展示。
 *
 * 为什么拦「带 https:// 或路径」：服务端收到网址形式时会把它**截成注册域**再登记 ——
 * 填 https://hrss.qingdao.gov.cn/x 实际登记的是整个 qingdao.gov.cn，范围悄悄变大。
 * 所以这里要求只填域名本身，不替用户截。
 */

export const OFFICIAL_DOMAIN_MAX = 10

/** 与服务端 registrable-domain.ts 的 HOST_RE 同一条。 */
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/

/** 与服务端 COMMERCIAL_RECRUITMENT_REGISTRABLE_DOMAINS 同一份名单。 */
const COMMERCIAL_RECRUITMENT_DOMAINS = ['zhipin.com', '51job.com', 'zhaopin.com', 'liepin.com'] as const

export function hostWithinDomain(host: string, domain: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '')
  const d = domain.trim().toLowerCase().replace(/\.$/, '')
  return Boolean(h && d && (h === d || h.endsWith(`.${d}`)))
}

export function isCommercialRecruitmentHost(host: string): boolean {
  return COMMERCIAL_RECRUITMENT_DOMAINS.some((domain) => hostWithinDomain(host, domain))
}

export type DomainInputCheck =
  | { kind: 'empty' }
  | { kind: 'has_scheme_or_path' }
  | { kind: 'invalid' }
  | { kind: 'commercial'; domain: string }
  | { kind: 'ok'; domain: string }

export function parseDomainInput(raw: string): DomainInputCheck {
  const text = raw.trim().toLowerCase().replace(/\.$/, '')
  if (!text) return { kind: 'empty' }
  if (/:\/\/|[/?#]/.test(text)) return { kind: 'has_scheme_or_path' }
  if (/[:@\s]/.test(text)) return { kind: 'invalid' }
  let host: string
  try {
    // 借浏览器把中文域名转成 punycode，与服务端 domainToASCII 同一结果。
    host = new URL(`https://${text}`).hostname.replace(/\.$/, '')
  } catch {
    return { kind: 'invalid' }
  }
  if (!HOST_RE.test(host)) return { kind: 'invalid' }
  if (isCommercialRecruitmentHost(host)) return { kind: 'commercial', domain: host }
  return { kind: 'ok', domain: host }
}

export interface DomainRowReview {
  check: DomainInputCheck
  /** 与前面第几行（从 1 数）重复；不重复为 null。重复不拦，保存时合并。 */
  duplicateOf: number | null
  /** 形如 xxx.gov.cn 的整段政府域名，提醒确认是不是整个地区的门户。只提醒，不拦。 */
  broadGov: boolean
}

export interface DomainDraftReview {
  rows: DomainRowReview[]
  /** 去重、规范化后准备提交的列表。 */
  domains: string[]
  /** 有任何一行格式不对（含空行）就不能保存。 */
  blocked: boolean
  tooMany: boolean
}

export function reviewDomainDraft(draft: readonly string[]): DomainDraftReview {
  const seen = new Map<string, number>()
  const domains: string[] = []
  const rows = draft.map((raw, index): DomainRowReview => {
    const check = parseDomainInput(raw)
    if (check.kind !== 'ok') return { check, duplicateOf: null, broadGov: false }
    const first = seen.get(check.domain)
    if (first === undefined) {
      seen.set(check.domain, index + 1)
      domains.push(check.domain)
    }
    return { check, duplicateOf: first ?? null, broadGov: /^[a-z0-9-]+\.gov\.cn$/.test(check.domain) }
  })
  const tooMany = domains.length > OFFICIAL_DOMAIN_MAX
  const blocked = tooMany || rows.some((row) => row.check.kind !== 'ok')
  return { rows, domains, blocked, tooMany }
}

export function domainRowHint(row: DomainRowReview): { tone: 'warn' | 'info'; text: string } | null {
  switch (row.check.kind) {
    case 'empty':
      return { tone: 'warn', text: '空行：请填写域名，或点右侧移除这一行' }
    case 'has_scheme_or_path':
      return { tone: 'warn', text: '只填域名本身，不要带 https:// 或路径（服务端会把网址截成整个注册域，范围会变大）' }
    case 'invalid':
      return { tone: 'warn', text: '这不是有效的域名（例如 hrss.qingdao.gov.cn）' }
    case 'commercial':
      return { tone: 'warn', text: `${row.check.domain} 属于商业招聘网站，不能登记为机构官方域名` }
    case 'ok':
      if (row.duplicateOf !== null) return { tone: 'info', text: `与第 ${row.duplicateOf} 行重复，保存时合并为一条` }
      if (row.broadGov) {
        return {
          tone: 'info',
          text: `请确认 ${row.check.domain} 是本机构自己的域名；如果是整个地区政府的门户域名，请改登记本机构的子域名`,
        }
      }
      return null
  }
}

export function diffDomains(before: readonly string[], after: readonly string[]): {
  added: string[]
  removed: string[]
  kept: string[]
} {
  return {
    added: after.filter((domain) => !before.includes(domain)),
    removed: before.filter((domain) => !after.includes(domain)),
    kept: after.filter((domain) => before.includes(domain)),
  }
}
