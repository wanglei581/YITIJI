import { isCommercialRecruitmentHost, verifiedDomainFromInput } from './registrable-domain'

export interface VerifiedDomainRecord {
  domain: string
  verifiedAt: string
  verifiedBy: string
}

export function parseVerifiedDomains(raw: string | null | undefined): VerifiedDomainRecord[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const items: VerifiedDomainRecord[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue
      const row = entry as { domain?: unknown; verifiedAt?: unknown; verifiedBy?: unknown }
      if (typeof row.domain !== 'string' || typeof row.verifiedAt !== 'string' || typeof row.verifiedBy !== 'string') continue
      const domain = verifiedDomainFromInput(row.domain)
      if (!domain || isCommercialRecruitmentHost(domain)) continue
      items.push({ domain, verifiedAt: row.verifiedAt, verifiedBy: row.verifiedBy })
    }
    return items
  } catch {
    return []
  }
}

export function normalizeVerifiedDomainList(
  rawDomains: string[],
  existing: VerifiedDomainRecord[],
  actorId: string,
  nowIso: string,
): { ok: true; items: VerifiedDomainRecord[] } | { ok: false; value: string } {
  if (!Array.isArray(rawDomains) || rawDomains.length > 10) return { ok: false, value: '官方注册域最多 10 个' }
  const items: VerifiedDomainRecord[] = []
  const seen = new Set<string>()
  for (const raw of rawDomains) {
    if (typeof raw !== 'string' || !raw.trim()) return { ok: false, value: '空域名' }
    const domain = verifiedDomainFromInput(raw)
    if (!domain || isCommercialRecruitmentHost(domain)) return { ok: false, value: raw }
    if (seen.has(domain)) continue
    seen.add(domain)
    const previous = existing.find((item) => item.domain === domain)
    items.push(previous ?? { domain, verifiedAt: nowIso, verifiedBy: actorId })
  }
  return { ok: true, items }
}
