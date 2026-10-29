/**
 * 授权的管控点（服务端为准，前端只是显示）。全部建立在 license-state.ts 的统一推导上。
 *
 *   一体机会话      assertOrgMaySignSessions     只拦「新会话签发」（换票、续期），已签发的照常到自然过期
 *   机构后台写操作  assertOrgMayWrite            在 partner-license-write.interceptor.ts 里用
 *   绑定终端        withOrgTerminalQuota         只管「新增绑定」：超台数拒绝；运行期不拦已绑终端
 *
 * 没设授权的机构（licenseMode = none，所有现有机构的默认值）：三个管控点都直接放行。
 */
import { ConflictException, ForbiddenException } from '@nestjs/common'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'
import { licenseNow } from './license-clock'
import {
  bindingQuota,
  normalizeLicenseMode,
  resolveOrgLicense,
  type LicenseWindow,
  type OrgLicenseResolution,
} from './license-state'
import type { LicenseStatus } from './license.types'

export type LicenseDb = PrismaService | PrismaTransactionClient

export const LICENSE_WINDOW_SELECT = {
  id: true,
  status: true,
  startsAt: true,
  endsAt: true,
  graceDays: true,
  terminalQuota: true,
  createdAt: true,
} as const

export function toLicenseWindow(row: {
  id: string
  status: string
  startsAt: Date
  endsAt: Date
  graceDays: number
  terminalQuota: number
  createdAt: Date
}): LicenseWindow {
  return {
    id: row.id,
    status: row.status as LicenseStatus,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    graceDays: row.graceDays,
    terminalQuota: row.terminalQuota,
    createdAt: row.createdAt,
  }
}

/**
 * 读一个机构当前的授权状态；机构不存在返回 null。
 * 不管控的机构（绝大多数）只读一行机构记录，不碰授权表。
 */
export async function loadOrgLicenseResolution(
  db: LicenseDb,
  orgId: string,
  now: Date = licenseNow(),
): Promise<OrgLicenseResolution | null> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { licenseMode: true } })
  if (!org) return null
  const mode = normalizeLicenseMode(org.licenseMode)
  if (mode !== 'required') return resolveOrgLicense({ mode, licenses: [], now })
  const rows = await db.license.findMany({ where: { orgId }, select: LICENSE_WINDOW_SELECT })
  return resolveOrgLicense({ mode, licenses: rows.map(toLicenseWindow), now })
}

/** 已绑定到机构的终端数，不含已退役（退役 = 永久下线，释放名额）。 */
export async function countBoundTerminals(db: LicenseDb, orgId: string, exceptTerminalId?: string): Promise<number> {
  return db.terminal.count({
    where: {
      orgId,
      lifecycleStatus: { not: 'retired' },
      ...(exceptTerminalId ? { id: { not: exceptTerminalId } } : {}),
    },
  })
}

// ── 一体机会话 ────────────────────────────────────────────────────────────────

/**
 * 面向一体机浏览器的错误码。文案不写「授权」「到期」——对办事群众没意义，也暴露商务信息；
 * 一体机收到这个码就进「这台机器暂时不能用」，用无人值守标准句，不展示本文案。
 */
export function terminalLicenseInactive(): ForbiddenException {
  return new ForbiddenException({
    error: { code: 'TERMINAL_LICENSE_INACTIVE', message: '这台终端所在点位暂时不能提供服务' },
  })
}

/**
 * 终端会话**签发**处调用（换票、续期）。机构需要授权且不可用时拒绝。
 * 已签发的会话不在这里管：它们照常用到自然过期。终端没绑机构、机构不管控一律放行。
 */
export async function assertOrgMaySignSessions(
  db: LicenseDb,
  orgId: string | null | undefined,
  now: Date = licenseNow(),
): Promise<void> {
  if (!orgId) return
  const resolution = await loadOrgLicenseResolution(db, orgId, now)
  if (resolution && !resolution.usable) throw terminalLicenseInactive()
}

// ── 机构后台写操作 ────────────────────────────────────────────────────────────

export function orgLicenseInactive(): ForbiddenException {
  return new ForbiddenException({
    error: {
      code: 'ORG_LICENSE_INACTIVE',
      message: '本机构的软件使用授权当前不可用，暂时不能发布或修改内容；查看与导出不受影响。请联系平台续期或恢复。',
    },
  })
}

export async function assertOrgMayWrite(
  db: LicenseDb,
  orgId: string,
  now: Date = licenseNow(),
): Promise<void> {
  const resolution = await loadOrgLicenseResolution(db, orgId, now)
  if (resolution && !resolution.usable) throw orgLicenseInactive()
}

// ── 绑定终端：只管新增绑定 ────────────────────────────────────────────────────

const UNAVAILABLE_REASON_LABEL = {
  suspended: '已被暂停',
  expired: '已过期',
  unlicensed: '没有生效的授权',
} as const

/**
 * 在事务里拿到机构行锁。PostgreSQL 上用 FOR NO KEY UPDATE：同机构的并发绑定排队，
 * 不会两个人同时看到「还剩 1 个名额」而都成功；子表插入拿的是 FOR KEY SHARE，不受影响。
 * SQLite 单写者，事务本身就是串行的。
 */
export async function lockOrganization(
  tx: PrismaTransactionClient,
  dbKind: PrismaService['dbKind'],
  orgId: string,
): Promise<void> {
  if (dbKind === 'postgres') {
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${orgId} FOR NO KEY UPDATE`
  }
}

/**
 * 把终端绑到机构之前调用（在事务里）。机构需要授权时：
 *   - 授权不可用（暂停、过期且没有待生效的、没有授权）→ 409 LICENSE_NOT_AVAILABLE_FOR_BINDING；
 *   - 已绑 + 1 超过台数上限 → 409 LICENSE_TERMINAL_QUOTA_EXCEEDED。
 * 不管控的机构不限。降低台数不会自动解绑已绑终端——这里只拦新增。
 */
export async function assertCanBindTerminal(
  tx: PrismaTransactionClient,
  dbKind: PrismaService['dbKind'],
  orgId: string,
  terminalId: string | null,
  now: Date = licenseNow(),
): Promise<void> {
  await lockOrganization(tx, dbKind, orgId)
  const resolution = await loadOrgLicenseResolution(tx, orgId, now)
  if (!resolution || !resolution.managed) return
  const basis = bindingQuota(resolution)
  if (!basis.allowed) {
    throw new ConflictException({
      error: {
        code: 'LICENSE_NOT_AVAILABLE_FOR_BINDING',
        message: `该机构的软件使用授权当前不可用（${UNAVAILABLE_REASON_LABEL[basis.reason]}），不能新增绑定终端。请先续期或恢复授权。`,
      },
    })
  }
  if (basis.quota === null) return
  const used = await countBoundTerminals(tx, orgId, terminalId ?? undefined)
  if (used + 1 > basis.quota) {
    throw new ConflictException({
      error: {
        code: 'LICENSE_TERMINAL_QUOTA_EXCEEDED',
        message: `授权台数已用完：本机构已绑定 ${used} 台，授权上限 ${basis.quota} 台。请先解绑或退役不再使用的终端（换机时先解绑旧机），或联系平台调整授权台数。`,
      },
    })
  }
}

/** 预创建终端这类「先检查再写」的场景：开事务、锁机构、检查台数，再执行 work。 */
export async function withOrgTerminalQuota<T>(
  prisma: PrismaService,
  orgId: string,
  work: (tx: PrismaTransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await assertCanBindTerminal(tx, prisma.dbKind, orgId, null)
    return work(tx)
  })
}
