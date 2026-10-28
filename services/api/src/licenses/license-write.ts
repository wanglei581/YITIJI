/**
 * 授权写操作的公共零件：事务内加锁读取、乐观版本、期限重叠检查、机构授权快照。
 *
 * 写授权的规矩（license.service.ts 的每个写操作都照这个顺序）：
 *   1. 请求里的字段先做与数据库无关的校验（理由、版本号、日期格式……）；
 *   2. 开事务，先锁机构（PostgreSQL 上 FOR NO KEY UPDATE；SQLite 单写者本身串行），**再**读授权行；
 *   3. 补丁、前后对比、期限校验、审计里的 before / after，全都用这次事务内读到的值算——
 *      不拿锁外读到的旧值，否则两个人同时改不同字段会互相覆盖，审计的「改前」也不准；
 *   4. 写库带 where version 做条件更新（成功则 version + 1），命中 0 行回 409 LICENSE_VERSION_CONFLICT。
 */
import { ConflictException, NotFoundException } from '@nestjs/common'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'
import { countBoundTerminals, lockOrganization, toLicenseWindow } from './license-gate'
import { licenseNow } from './license-clock'
import { resolveOrgLicense } from './license-state'
import { periodText } from './license-time'
import type { LicenseRow } from './license-view'
import type { LicenseMode } from './license.types'

export function licenseNotFound(): NotFoundException {
  return new NotFoundException({ error: { code: 'LICENSE_NOT_FOUND', message: '授权不存在' } })
}

export function orgNotFound(): NotFoundException {
  return new NotFoundException({ error: { code: 'ORG_NOT_FOUND', message: '机构不存在' } })
}

export function revokedConflict(): ConflictException {
  return new ConflictException({
    error: { code: 'LICENSE_REVOKED', message: '这条授权已吊销，不能再修改、续期或恢复' },
  })
}

export function statusConflict(status: string): ConflictException {
  return new ConflictException({
    error: {
      code: 'LICENSE_STATUS_CONFLICT',
      message: `这条授权当前是「${status === 'suspended' ? '已暂停' : '生效中'}」，不能执行该操作，请刷新后重试`,
    },
  })
}

export function versionConflict(current: number): ConflictException {
  return new ConflictException({
    error: {
      code: 'LICENSE_VERSION_CONFLICT',
      message: `这条授权刚刚被别人改过（当前是第 ${current} 版），你看到的已经过期。请刷新后核对最新内容，再重新提交。`,
    },
  })
}

/** 机构存在才往下走，并拿到机构行锁。 */
export async function lockOrg(tx: PrismaTransactionClient, dbKind: PrismaService['dbKind'], orgId: string): Promise<void> {
  const org = await tx.organization.findUnique({ where: { id: orgId }, select: { id: true } })
  if (!org) throw orgNotFound()
  await lockOrganization(tx, dbKind, orgId)
}

/**
 * 锁住授权所在的机构，再在事务内读出这条授权的最新值。
 * 先读 orgId（授权一旦建好就不换机构）再拿锁，拿到锁之后才读完整的行——这样读到的一定是别人已提交的最新值。
 */
export async function lockLicense(tx: PrismaTransactionClient, dbKind: PrismaService['dbKind'], id: string): Promise<LicenseRow> {
  const probe = await tx.license.findUnique({ where: { id }, select: { orgId: true } })
  if (!probe) throw licenseNotFound()
  await lockOrg(tx, dbKind, probe.orgId)
  const fresh = await tx.license.findUnique({ where: { id } })
  if (!fresh) throw licenseNotFound()
  return fresh
}

/** 界面读到的版本必须等于当前版本。 */
export function assertVersion(fresh: Pick<LicenseRow, 'version'>, given: number): void {
  if (fresh.version !== given) throw versionConflict(fresh.version)
}

/**
 * 带版本条件的更新：只有库里的 version 仍是读到的那个才写，并把 version 加 1。
 * 命中 0 行（被别人抢先改了）回 409。
 */
export async function writeVersioned(
  tx: PrismaTransactionClient,
  fresh: Pick<LicenseRow, 'id' | 'version'>,
  data: Record<string, unknown>,
  actorId: string,
): Promise<void> {
  const result = await tx.license.updateMany({
    where: { id: fresh.id, version: fresh.version },
    data: { ...data, version: { increment: 1 }, updatedBy: actorId },
  })
  if (result.count !== 1) {
    const latest = await tx.license.findUnique({ where: { id: fresh.id }, select: { version: true } })
    if (!latest) throw licenseNotFound()
    throw versionConflict(latest.version)
  }
}

/** 非吊销的授权期限不许重叠（首尾相接可以）。 */
export async function assertNoOverlap(
  tx: PrismaTransactionClient,
  orgId: string,
  startsAt: Date,
  endsAt: Date,
  exceptId?: string,
): Promise<void> {
  const clash = await tx.license.findMany({
    where: {
      orgId,
      status: { not: 'revoked' },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, contractNo: true, startsAt: true, endsAt: true },
    take: 3,
  })
  if (clash.length === 0) return
  const list = clash.map((row) => `合同 ${row.contractNo}：${periodText(row.startsAt, row.endsAt)}`).join('；')
  throw new ConflictException({
    error: {
      code: 'LICENSE_PERIOD_OVERLAP',
      message: `与已有授权的期限重叠（${list}）。续期请用「续期」，让新授权从上一条到期日的次日起算。`,
    },
  })
}

/** 审计里记「这次操作前后，机构的授权状态与绑定终端数」，作为停机 / 恢复的操作快照。 */
export async function orgStateSnapshot(
  tx: PrismaTransactionClient,
  orgId: string,
): Promise<{ mode: LicenseMode; state: string; usable: boolean; terminalsBound: number }> {
  const org = await tx.organization.findUnique({ where: { id: orgId }, select: { licenseMode: true } })
  const rows = await tx.license.findMany({ where: { orgId } })
  const resolution = resolveOrgLicense({
    mode: org?.licenseMode,
    licenses: rows.map(toLicenseWindow),
    now: licenseNow(),
  })
  return {
    mode: resolution.mode,
    state: resolution.state,
    usable: resolution.usable,
    terminalsBound: await countBoundTerminals(tx, orgId),
  }
}

export interface LicenseAuditActor {
  userId: string
  role: string
  ipAddress?: string | null
  userAgent?: string | null
  requestId?: string | null
}

export function auditBase(actor: LicenseAuditActor) {
  return {
    actorId: actor.userId,
    actorRole: actor.role,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  }
}
