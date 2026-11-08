import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'
import { countBoundTerminals } from './license-gate'
import { buildOverview, licenseView } from './license-view'
import type { LicenseAttention, OrgLicenseDetail } from './license.types'

/** 离到期还剩这么久（含）就进工作台「30 天内到期」。 */
export const EXPIRING_SOON_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

type Db = PrismaService | PrismaTransactionClient

/** 一个机构的授权一节：概览 + 全部历史（新的在前）。机构不存在返回 null。 */
export async function loadOrgLicenseDetail(db: Db, orgId: string, now: Date): Promise<OrgLicenseDetail | null> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, licenseMode: true } })
  if (!org) return null
  const rows = await db.license.findMany({ where: { orgId }, orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }] })
  const bound = await countBoundTerminals(db, orgId)
  const { overview } = buildOverview(org, rows, bound, now)
  return { ...overview, items: rows.map((row) => licenseView(row, now)) }
}

/** 管理员工作台「今天要处理」：只看 licenseMode = required 的机构。 */
export async function loadLicenseAttention(db: PrismaService, now: Date): Promise<LicenseAttention> {
  const orgs = await db.organization.findMany({
    where: { licenseMode: 'required' },
    select: { id: true, name: true, licenseMode: true },
    orderBy: { name: 'asc' },
  })
  const result: LicenseAttention = {
    expiringSoon: [],
    grace: [],
    inactive: [],
    counts: { expiringSoon: 0, grace: 0, inactive: 0 },
  }
  if (orgs.length === 0) return result
  const ids = orgs.map((org) => org.id)
  const [rows, bound] = await Promise.all([
    db.license.findMany({ where: { orgId: { in: ids } } }),
    db.terminal.groupBy({
      by: ['orgId'],
      where: { orgId: { in: ids }, lifecycleStatus: { not: 'retired' } },
      _count: { _all: true },
    }),
  ])
  const boundByOrg = new Map(bound.map((item) => [item.orgId, item._count._all]))
  for (const org of orgs) {
    const orgRows = rows.filter((row) => row.orgId === org.id)
    const { overview } = buildOverview(org, orgRows, boundByOrg.get(org.id) ?? 0, now)
    if (overview.state === 'grace') result.grace.push(overview)
    else if (overview.state === 'ok') {
      const until = overview.coveredUntil ? Date.parse(overview.coveredUntil) : null
      if (until !== null && until - now.getTime() <= EXPIRING_SOON_DAYS * DAY_MS) result.expiringSoon.push(overview)
    } else result.inactive.push(overview)
  }
  result.expiringSoon.sort((a, b) => Date.parse(a.coveredUntil ?? '') - Date.parse(b.coveredUntil ?? ''))
  result.grace.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
  result.counts = {
    expiringSoon: result.expiringSoon.length,
    grace: result.grace.length,
    inactive: result.inactive.length,
  }
  return result
}
