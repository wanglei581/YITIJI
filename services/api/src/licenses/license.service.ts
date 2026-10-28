import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { formatBeijingDate } from '../common/beijing-display-time'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import * as input from './license-input'
import { licenseNow } from './license-clock'
import { countBoundTerminals, lockOrganization, toLicenseWindow } from './license-gate'
import { normalizeLicenseMode, resolveOrgLicense } from './license-state'
import {
  buildOverview,
  licenseSnapshot,
  licenseView,
  partnerView,
  type LicenseRow,
} from './license-view'
import {
  LICENSE_MODES,
  type CreateLicenseInput,
  type LicenseAttention,
  type LicenseMode,
  type LicenseMutationResult,
  type LicenseResumeInput,
  type LicenseStatusChangeInput,
  type LicenseView,
  type OrgLicenseDetail,
  type PartnerLicenseView,
  type RenewLicenseInput,
  type SetLicenseModeInput,
  type UpdateLicenseInput,
} from './license.types'

export interface LicenseActor {
  userId: string
  role: string
  ipAddress?: string | null
  userAgent?: string | null
  requestId?: string | null
}

const EXPIRING_SOON_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

function notFound(): NotFoundException {
  return new NotFoundException({ error: { code: 'LICENSE_NOT_FOUND', message: '授权不存在' } })
}

function orgNotFound(): NotFoundException {
  return new NotFoundException({ error: { code: 'ORG_NOT_FOUND', message: '机构不存在' } })
}

/** 授权的增改续期暂停恢复吊销，以及授权方式切换。每一步都在同一事务里写审计（谁、何时、改前改后）。 */
@Injectable()
export class LicenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── 读 ──────────────────────────────────────────────────────────────────────

  async getOrgDetail(orgId: string, db: PrismaService | PrismaTransactionClient = this.prisma): Promise<OrgLicenseDetail> {
    const now = licenseNow()
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, licenseMode: true } })
    if (!org) throw orgNotFound()
    const rows = await db.license.findMany({ where: { orgId }, orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }] })
    const bound = await countBoundTerminals(db, orgId)
    const { overview } = buildOverview(org, rows, bound, now)
    return { ...overview, items: rows.map((row) => licenseView(row, now)) }
  }

  async getLicense(id: string): Promise<LicenseView> {
    const row = await this.prisma.license.findUnique({ where: { id } })
    if (!row) throw notFound()
    return licenseView(row, licenseNow())
  }

  /** 机构自己看：只读，不含备注、暂停理由、工单号、经办人。 */
  async getPartnerView(orgId: string): Promise<PartnerLicenseView> {
    const detail = await this.getOrgDetail(orgId)
    return partnerView(detail)
  }

  /** 管理员工作台「今天要处理」：只看 licenseMode = required 的机构。 */
  async listAttention(): Promise<LicenseAttention> {
    const now = licenseNow()
    const orgs = await this.prisma.organization.findMany({
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
      this.prisma.license.findMany({ where: { orgId: { in: ids } } }),
      this.prisma.terminal.groupBy({
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

  // ── 写 ──────────────────────────────────────────────────────────────────────

  async create(orgId: string, body: CreateLicenseInput, actor: LicenseActor): Promise<LicenseMutationResult> {
    const startsAt = input.instant(body.startsAt, 'LICENSE_PERIOD_INVALID', '生效时间')
    const endsAt = input.instant(body.endsAt, 'LICENSE_PERIOD_INVALID', '到期时间')
    input.period(startsAt, endsAt)
    const data = {
      licenseeName: input.licenseeName(body.licenseeName),
      creditCode: input.creditCode(body.creditCode),
      contractNo: input.contractNo(body.contractNo),
      startsAt,
      endsAt,
      terminalQuota: input.terminalQuota(body.terminalQuota),
      graceDays: input.graceDays(body.graceDays),
      note: input.note(body.note),
    }
    const licenseId = await this.prisma.$transaction(async (tx) => {
      await this.lockOrg(tx, orgId)
      const before = await this.orgState(tx, orgId)
      await this.assertNoOverlap(tx, orgId, startsAt, endsAt)
      const created = await tx.license.create({
        data: { orgId, ...data, status: 'active', createdBy: actor.userId },
      })
      await this.audit.writeRequired(tx, {
        ...this.auditBase(actor),
        action: 'license.create',
        targetType: 'license',
        targetId: created.id,
        payload: { orgId, license: licenseSnapshot(created), orgState: { before, after: await this.orgState(tx, orgId) } },
      })
      return created.id
    })
    return { licenseId, org: await this.getOrgDetail(orgId) }
  }

  async update(id: string, body: UpdateLicenseInput, actor: LicenseActor): Promise<LicenseMutationResult> {
    const existing = await this.requireLicense(id)
    if (existing.status === 'revoked') throw this.revokedConflict()
    const patch: Record<string, unknown> = {}
    if (body.licenseeName !== undefined) patch['licenseeName'] = input.licenseeName(body.licenseeName)
    if (body.creditCode !== undefined) patch['creditCode'] = input.creditCode(body.creditCode)
    if (body.contractNo !== undefined) patch['contractNo'] = input.contractNo(body.contractNo)
    if (body.terminalQuota !== undefined) patch['terminalQuota'] = input.terminalQuota(body.terminalQuota)
    if (body.graceDays !== undefined) patch['graceDays'] = input.graceDays(body.graceDays)
    if (body.note !== undefined) patch['note'] = input.note(body.note)
    const startsAt =
      body.startsAt !== undefined ? input.instant(body.startsAt, 'LICENSE_PERIOD_INVALID', '生效时间') : existing.startsAt
    const endsAt =
      body.endsAt !== undefined ? input.instant(body.endsAt, 'LICENSE_PERIOD_INVALID', '到期时间') : existing.endsAt
    if (body.startsAt !== undefined || body.endsAt !== undefined) {
      input.period(startsAt, endsAt)
      patch['startsAt'] = startsAt
      patch['endsAt'] = endsAt
    }
    // 只留真正变了的字段；一个字都没变就不写库、不写审计。
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    const current = licenseSnapshot(existing)
    for (const [key, value] of Object.entries(patch)) {
      const next = value instanceof Date ? value.toISOString() : value
      if (current[key] === next) {
        delete patch[key]
        continue
      }
      before[key] = current[key]
      after[key] = next
    }
    if (Object.keys(patch).length === 0) return { licenseId: id, org: await this.getOrgDetail(existing.orgId) }

    await this.prisma.$transaction(async (tx) => {
      await this.lockOrg(tx, existing.orgId)
      const stateBefore = await this.orgState(tx, existing.orgId)
      const fresh = await tx.license.findUnique({ where: { id } })
      if (!fresh) throw notFound()
      if (fresh.status === 'revoked') throw this.revokedConflict()
      if ('startsAt' in patch || 'endsAt' in patch) {
        await this.assertNoOverlap(tx, existing.orgId, startsAt, endsAt, id)
      }
      await tx.license.update({ where: { id }, data: { ...patch, updatedBy: actor.userId } })
      await this.audit.writeRequired(tx, {
        ...this.auditBase(actor),
        action: 'license.update',
        targetType: 'license',
        targetId: id,
        payload: { orgId: existing.orgId, before, after, orgState: { before: stateBefore, after: await this.orgState(tx, existing.orgId) } },
      })
    })
    return { licenseId: id, org: await this.getOrgDetail(existing.orgId) }
  }

  /** 续期 = 新建一条首尾相接的后续授权（默认从原授权到期时刻起算），旧的不动，历史完整。 */
  async renew(id: string, body: RenewLicenseInput, actor: LicenseActor): Promise<LicenseMutationResult> {
    const predecessor = await this.requireLicense(id)
    if (predecessor.status === 'revoked') throw this.revokedConflict()
    const startsAt =
      body.startsAt !== undefined
        ? input.instant(body.startsAt, 'LICENSE_PERIOD_INVALID', '生效时间')
        : predecessor.endsAt
    const endsAt = input.instant(body.endsAt, 'LICENSE_PERIOD_INVALID', '到期时间')
    input.period(startsAt, endsAt)
    const data = {
      licenseeName: predecessor.licenseeName,
      creditCode: predecessor.creditCode,
      contractNo: input.contractNo(body.contractNo),
      startsAt,
      endsAt,
      terminalQuota: body.terminalQuota !== undefined ? input.terminalQuota(body.terminalQuota) : predecessor.terminalQuota,
      graceDays: body.graceDays !== undefined ? input.graceDays(body.graceDays) : predecessor.graceDays,
      note: input.note(body.note),
    }
    const licenseId = await this.prisma.$transaction(async (tx) => {
      await this.lockOrg(tx, predecessor.orgId)
      const before = await this.orgState(tx, predecessor.orgId)
      await this.assertNoOverlap(tx, predecessor.orgId, startsAt, endsAt)
      const created = await tx.license.create({
        data: { orgId: predecessor.orgId, ...data, status: 'active', createdBy: actor.userId },
      })
      await this.audit.writeRequired(tx, {
        ...this.auditBase(actor),
        action: 'license.renew',
        targetType: 'license',
        targetId: created.id,
        payload: {
          orgId: predecessor.orgId,
          predecessorId: predecessor.id,
          license: licenseSnapshot(created),
          orgState: { before, after: await this.orgState(tx, predecessor.orgId) },
        },
      })
      return created.id
    })
    return { licenseId, org: await this.getOrgDetail(predecessor.orgId) }
  }

  /** 暂停：理由必填（8–500 字），可带工单号。active → suspended。 */
  async suspend(id: string, body: LicenseStatusChangeInput, actor: LicenseActor): Promise<LicenseMutationResult> {
    const reasonText = input.reason(body.reason)
    const ticket = input.ticketNo(body.ticketNo)
    return this.changeStatus(id, actor, {
      action: 'license.suspend',
      from: ['active'],
      to: 'suspended',
      reason: reasonText,
      ticketNo: ticket,
    })
  }

  /** 恢复：只对 suspended，回到 active；说明可不填。 */
  async resume(id: string, body: LicenseResumeInput, actor: LicenseActor): Promise<LicenseMutationResult> {
    const note = input.optionalReason(body.reason)
    return this.changeStatus(id, actor, {
      action: 'license.resume',
      from: ['suspended'],
      to: 'active',
      reason: null,
      ticketNo: null,
      note,
    })
  }

  /** 吊销：理由必填，可带工单号。active / suspended → revoked，不可恢复。 */
  async revoke(id: string, body: LicenseStatusChangeInput, actor: LicenseActor): Promise<LicenseMutationResult> {
    const reasonText = input.reason(body.reason)
    const ticket = input.ticketNo(body.ticketNo)
    return this.changeStatus(id, actor, {
      action: 'license.revoke',
      from: ['active', 'suspended'],
      to: 'revoked',
      reason: reasonText,
      ticketNo: ticket,
    })
  }

  /**
   * 切换授权方式。把没有可用授权的机构切到 required，会让它名下终端不能开新会话——
   * 此时必须显式带 confirmLockout: true，否则 409 LICENSE_MODE_WOULD_LOCK_TERMINALS（界面据此二次确认）。
   */
  async setMode(orgId: string, body: SetLicenseModeInput, actor: LicenseActor): Promise<OrgLicenseDetail> {
    if (!LICENSE_MODES.includes(body.licenseMode as LicenseMode)) {
      throw new BadRequestException({
        error: { code: 'LICENSE_MODE_INVALID', message: `授权方式只能是 ${LICENSE_MODES.join(' 或 ')}` },
      })
    }
    const mode = body.licenseMode
    const note = input.optionalReason(body.reason)
    await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.findUnique({ where: { id: orgId }, select: { id: true, licenseMode: true } })
      if (!org) throw orgNotFound()
      await this.lockOrg(tx, orgId)
      const current = normalizeLicenseMode(org.licenseMode)
      if (current === mode) return
      const before = await this.orgState(tx, orgId)
      let lockout = false
      let terminalCount = 0
      if (mode === 'required') {
        const rows = await tx.license.findMany({ where: { orgId } })
        const resolution = resolveOrgLicense({
          mode: 'required',
          licenses: rows.map(toLicenseWindow),
          now: licenseNow(),
        })
        if (!resolution.usable) {
          terminalCount = await countBoundTerminals(tx, orgId)
          lockout = terminalCount > 0
          if (lockout && body.confirmLockout !== true) {
            throw new ConflictException({
              error: {
                code: 'LICENSE_MODE_WOULD_LOCK_TERMINALS',
                message: `该机构目前没有可用的授权，切到「需要授权」后它名下 ${terminalCount} 台终端将不能开始新会话。请先录入授权，或确认要立即停用。`,
              },
            })
          }
        }
      }
      await tx.organization.update({ where: { id: orgId }, data: { licenseMode: mode } })
      await this.audit.writeRequired(tx, {
        ...this.auditBase(actor),
        action: 'license.mode_update',
        targetType: 'organization',
        targetId: orgId,
        payload: {
          before: current,
          after: mode,
          note,
          confirmLockout: body.confirmLockout === true,
          lockout,
          terminalCount,
          orgState: { before, after: await this.orgState(tx, orgId) },
        },
      })
    })
    return this.getOrgDetail(orgId)
  }

  // ── 内部 ────────────────────────────────────────────────────────────────────

  private async changeStatus(
    id: string,
    actor: LicenseActor,
    change: {
      action: string
      from: string[]
      to: 'active' | 'suspended' | 'revoked'
      reason: string | null
      ticketNo: string | null
      note?: string | null
    },
  ): Promise<LicenseMutationResult> {
    const existing = await this.requireLicense(id)
    await this.prisma.$transaction(async (tx) => {
      await this.lockOrg(tx, existing.orgId)
      const stateBefore = await this.orgState(tx, existing.orgId)
      const now = licenseNow()
      // 带上期望的旧状态做条件更新：并发的两次暂停 / 吊销只有一次生效。
      const changed = await tx.license.updateMany({
        where: { id, status: { in: change.from } },
        data: {
          status: change.to,
          // 恢复时清空当前理由与工单号，完整历史在审计日志里。
          statusReason: change.to === 'active' ? null : change.reason,
          statusTicketNo: change.to === 'active' ? null : change.ticketNo,
          statusChangedAt: now,
          statusChangedBy: actor.userId,
          updatedBy: actor.userId,
        },
      })
      if (changed.count !== 1) {
        const latest = await tx.license.findUnique({ where: { id }, select: { status: true } })
        if (!latest) throw notFound()
        if (latest.status === 'revoked') throw this.revokedConflict()
        throw new ConflictException({
          error: {
            code: 'LICENSE_STATUS_CONFLICT',
            message: `这条授权当前是「${latest.status === 'suspended' ? '已暂停' : '生效中'}」，不能执行该操作，请刷新后重试`,
          },
        })
      }
      await this.audit.writeRequired(tx, {
        ...this.auditBase(actor),
        action: change.action,
        targetType: 'license',
        targetId: id,
        payload: {
          orgId: existing.orgId,
          contractNo: existing.contractNo,
          before: { status: existing.status },
          after: { status: change.to },
          reason: change.reason,
          ticketNo: change.ticketNo,
          note: change.note ?? null,
          orgState: { before: stateBefore, after: await this.orgState(tx, existing.orgId) },
        },
      })
    })
    return { licenseId: id, org: await this.getOrgDetail(existing.orgId) }
  }

  private async requireLicense(id: string): Promise<LicenseRow> {
    const row = await this.prisma.license.findUnique({ where: { id } })
    if (!row) throw notFound()
    return row
  }

  private revokedConflict(): ConflictException {
    return new ConflictException({
      error: { code: 'LICENSE_REVOKED', message: '这条授权已吊销，不能再修改、续期或恢复' },
    })
  }

  private async lockOrg(tx: PrismaTransactionClient, orgId: string): Promise<void> {
    const org = await tx.organization.findUnique({ where: { id: orgId }, select: { id: true } })
    if (!org) throw orgNotFound()
    await lockOrganization(tx, this.prisma.dbKind, orgId)
  }

  /** 非吊销的授权期限不许重叠（首尾相接可以）。 */
  private async assertNoOverlap(
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
    const list = clash
      .map((row) => `合同 ${row.contractNo}（${formatBeijingDate(row.startsAt)} 至 ${formatBeijingDate(row.endsAt)}）`)
      .join('、')
    throw new ConflictException({
      error: {
        code: 'LICENSE_PERIOD_OVERLAP',
        message: `与已有授权的期限重叠：${list}。续期请用「续期」，让新授权从旧授权到期时刻起算。`,
      },
    })
  }

  /** 审计里记「这次操作前后，机构的授权状态与绑定终端数」，作为停机 / 恢复的操作快照。 */
  private async orgState(
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

  private auditBase(actor: LicenseActor) {
    return {
      actorId: actor.userId,
      actorRole: actor.role,
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
      requestId: actor.requestId ?? null,
    }
  }
}

