import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import * as input from './license-input'
import { licenseNow } from './license-clock'
import { countBoundTerminals, toLicenseWindow } from './license-gate'
import { loadLicenseAttention, loadOrgLicenseDetail } from './license-queries'
import { normalizeLicenseMode, resolveOrgLicense } from './license-state'
import { beijingDateOf } from './license-time'
import { licenseSnapshot, licenseView, partnerView, type LicenseRow } from './license-view'
import {
  assertNoOverlap,
  assertVersion,
  auditBase,
  licenseNotFound,
  lockLicense,
  lockOrg,
  orgNotFound,
  orgStateSnapshot,
  revokedConflict,
  statusConflict,
  writeVersioned,
  type LicenseAuditActor,
} from './license-write'
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

export type LicenseActor = LicenseAuditActor

/** 更正时不写进「改前改后」对比的快照字段。 */
const NOT_COMPARED = new Set(['id', 'orgId', 'status', 'version'])

/**
 * 授权的增改续期暂停恢复吊销，以及授权方式切换。每一步都在同一事务里写审计（谁、何时、为什么、改前改后）。
 * 写操作的顺序与理由见 license-write.ts 顶部：事务内先锁机构再读授权，补丁与审计用事务内读到的值算，写库带版本。
 */
@Injectable()
export class LicenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── 读 ──────────────────────────────────────────────────────────────────────

  async getOrgDetail(orgId: string, db: PrismaService | PrismaTransactionClient = this.prisma): Promise<OrgLicenseDetail> {
    const detail = await loadOrgLicenseDetail(db, orgId, licenseNow())
    if (!detail) throw orgNotFound()
    return detail
  }

  async getLicense(id: string): Promise<LicenseView> {
    const row = await this.prisma.license.findUnique({ where: { id } })
    if (!row) throw licenseNotFound()
    return licenseView(row, licenseNow())
  }

  /** 机构自己看：只读，不含备注、暂停理由、工单号、经办人、版本号。 */
  async getPartnerView(orgId: string): Promise<PartnerLicenseView> {
    return partnerView(await this.getOrgDetail(orgId))
  }

  /** 管理员工作台「今天要处理」：只看 licenseMode = required 的机构。 */
  listAttention(): Promise<LicenseAttention> {
    return loadLicenseAttention(this.prisma, licenseNow())
  }

  // ── 写 ──────────────────────────────────────────────────────────────────────

  /** 新建（每条授权是一份合同）。期限收含到期日的北京日期。 */
  async create(orgId: string, body: CreateLicenseInput, actor: LicenseActor): Promise<LicenseMutationResult> {
    const { startsAt, endsAt } = input.period(
      input.licenseDay(body.startsOn, 'LICENSE_PERIOD_INVALID', '生效日'),
      input.licenseDay(body.endsOn, 'LICENSE_PERIOD_INVALID', '到期日'),
    )
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
      await lockOrg(tx, this.prisma.dbKind, orgId)
      const before = await orgStateSnapshot(tx, orgId)
      await assertNoOverlap(tx, orgId, startsAt, endsAt)
      const created = await tx.license.create({
        data: { orgId, ...data, status: 'active', createdBy: actor.userId },
      })
      await this.audit.writeRequired(tx, {
        ...auditBase(actor),
        action: 'license.create',
        targetType: 'license',
        targetId: created.id,
        payload: { orgId, license: licenseSnapshot(created), orgState: { before, after: await orgStateSnapshot(tx, orgId) } },
      })
      return created.id
    })
    return { licenseId, org: await this.getOrgDetail(orgId) }
  }

  /**
   * 更正：改信息 / 期限 / 台数。必须带界面读到的 version 与理由。
   * 补丁、期限校验、审计的前后对比全部基于事务内读到的最新值；一个字都没变就不写库、不审计、不加版本。
   */
  async update(id: string, body: UpdateLicenseInput, actor: LicenseActor): Promise<LicenseMutationResult> {
    const version = input.version(body.version)
    const reason = input.reason(body.reason)
    const startsOn = body.startsOn !== undefined ? input.licenseDay(body.startsOn, 'LICENSE_PERIOD_INVALID', '生效日') : undefined
    const endsOn = body.endsOn !== undefined ? input.licenseDay(body.endsOn, 'LICENSE_PERIOD_INVALID', '到期日') : undefined
    const wanted = {
      licenseeName: body.licenseeName !== undefined ? input.licenseeName(body.licenseeName) : undefined,
      creditCode: body.creditCode !== undefined ? input.creditCode(body.creditCode) : undefined,
      contractNo: body.contractNo !== undefined ? input.contractNo(body.contractNo) : undefined,
      terminalQuota: body.terminalQuota !== undefined ? input.terminalQuota(body.terminalQuota) : undefined,
      graceDays: body.graceDays !== undefined ? input.graceDays(body.graceDays) : undefined,
      note: body.note !== undefined ? input.note(body.note) : undefined,
    }
    const orgId = await this.prisma.$transaction(async (tx) => {
      const fresh = await lockLicense(tx, this.prisma.dbKind, id)
      if (fresh.status === 'revoked') throw revokedConflict()
      assertVersion(fresh, version)

      const patch: Record<string, unknown> = {}
      const assign = (key: keyof LicenseRow, value: unknown): void => {
        if (value === undefined) return
        const old = fresh[key]
        const same = value instanceof Date ? old instanceof Date && old.getTime() === value.getTime() : old === value
        if (!same) patch[key] = value
      }
      for (const [key, value] of Object.entries(wanted)) assign(key as keyof LicenseRow, value)
      // 期限：另一端用这次事务内读到的值，不用锁外读到的旧值
      if (startsOn !== undefined || endsOn !== undefined) {
        const startsAt = startsOn !== undefined ? input.dayStart(startsOn) : fresh.startsAt
        const endsAt = endsOn !== undefined ? input.dayEnd(endsOn) : fresh.endsAt
        input.checkPeriod(startsAt, endsAt)
        assign('startsAt', startsAt)
        assign('endsAt', endsAt)
      }
      if (Object.keys(patch).length === 0) return fresh.orgId

      const beforeSnapshot = licenseSnapshot(fresh)
      const afterSnapshot = licenseSnapshot({ ...fresh, ...(patch as Partial<LicenseRow>) })
      const before: Record<string, unknown> = {}
      const after: Record<string, unknown> = {}
      for (const key of Object.keys(beforeSnapshot)) {
        if (NOT_COMPARED.has(key) || beforeSnapshot[key] === afterSnapshot[key]) continue
        before[key] = beforeSnapshot[key]
        after[key] = afterSnapshot[key]
      }
      if ('startsAt' in patch || 'endsAt' in patch) {
        await assertNoOverlap(
          tx,
          fresh.orgId,
          (patch['startsAt'] as Date | undefined) ?? fresh.startsAt,
          (patch['endsAt'] as Date | undefined) ?? fresh.endsAt,
          id,
        )
      }
      const stateBefore = await orgStateSnapshot(tx, fresh.orgId)
      await writeVersioned(tx, fresh, patch, actor.userId)
      await this.audit.writeRequired(tx, {
        ...auditBase(actor),
        action: 'license.update',
        targetType: 'license',
        targetId: id,
        payload: {
          orgId: fresh.orgId,
          reason,
          version: { before: fresh.version, after: fresh.version + 1 },
          before,
          after,
          orgState: { before: stateBefore, after: await orgStateSnapshot(tx, fresh.orgId) },
        },
      })
      return fresh.orgId
    })
    return { licenseId: id, org: await this.getOrgDetail(orgId) }
  }

  /**
   * 续期 = 新建一条首尾相接的后续授权，旧的不动，历史完整。续期也是一份合同：被授权企业、信用代码、合同编号都必填。
   * startsOn 可不填，不填 = 上一条授权到期日的次日；填了照样走「非吊销授权期限不得重叠」的校验。
   */
  async renew(id: string, body: RenewLicenseInput, actor: LicenseActor): Promise<LicenseMutationResult> {
    const wanted = {
      licenseeName: input.licenseeName(body.licenseeName),
      creditCode: input.creditCode(body.creditCode),
      contractNo: input.contractNo(body.contractNo),
      note: input.note(body.note),
    }
    const startsOn = body.startsOn !== undefined ? input.licenseDay(body.startsOn, 'LICENSE_PERIOD_INVALID', '生效日') : undefined
    const endsOn = input.licenseDay(body.endsOn, 'LICENSE_PERIOD_INVALID', '到期日')
    const quota = body.terminalQuota !== undefined ? input.terminalQuota(body.terminalQuota) : undefined
    const grace = body.graceDays !== undefined ? input.graceDays(body.graceDays) : undefined
    const result = await this.prisma.$transaction(async (tx) => {
      const predecessor = await lockLicense(tx, this.prisma.dbKind, id)
      if (predecessor.status === 'revoked') throw revokedConflict()
      // 上一条的 endsAt 是「到期日次日的 0 点」，它所在的北京日期正好是「到期日的次日」。
      const { startsAt, endsAt } = input.period(startsOn ?? beijingDateOf(predecessor.endsAt), endsOn)
      const before = await orgStateSnapshot(tx, predecessor.orgId)
      await assertNoOverlap(tx, predecessor.orgId, startsAt, endsAt)
      const created = await tx.license.create({
        data: {
          orgId: predecessor.orgId,
          ...wanted,
          startsAt,
          endsAt,
          terminalQuota: quota ?? predecessor.terminalQuota,
          graceDays: grace ?? predecessor.graceDays,
          status: 'active',
          createdBy: actor.userId,
        },
      })
      await this.audit.writeRequired(tx, {
        ...auditBase(actor),
        action: 'license.renew',
        targetType: 'license',
        targetId: created.id,
        payload: {
          orgId: predecessor.orgId,
          predecessor: { id: predecessor.id, contractNo: predecessor.contractNo, version: predecessor.version },
          license: licenseSnapshot(created),
          orgState: { before, after: await orgStateSnapshot(tx, predecessor.orgId) },
        },
      })
      return { licenseId: created.id, orgId: predecessor.orgId }
    })
    return { licenseId: result.licenseId, org: await this.getOrgDetail(result.orgId) }
  }

  /** 暂停：version、理由、审批工单号都必填。active → suspended。 */
  async suspend(id: string, body: LicenseStatusChangeInput, actor: LicenseActor): Promise<LicenseMutationResult> {
    return this.changeStatus(id, actor, {
      action: 'license.suspend',
      version: input.version(body.version),
      from: ['active'],
      to: 'suspended',
      reason: input.reason(body.reason),
      approvalTicketNo: input.approvalTicketNo(body.approvalTicketNo),
    })
  }

  /** 恢复：只对 suspended，回到 active；version 与理由必填。 */
  async resume(id: string, body: LicenseResumeInput, actor: LicenseActor): Promise<LicenseMutationResult> {
    return this.changeStatus(id, actor, {
      action: 'license.resume',
      version: input.version(body.version),
      from: ['suspended'],
      to: 'active',
      reason: input.reason(body.reason),
      approvalTicketNo: null,
    })
  }

  /** 吊销：version、理由、审批工单号都必填。active / suspended → revoked，不可恢复。 */
  async revoke(id: string, body: LicenseStatusChangeInput, actor: LicenseActor): Promise<LicenseMutationResult> {
    return this.changeStatus(id, actor, {
      action: 'license.revoke',
      version: input.version(body.version),
      from: ['active', 'suspended'],
      to: 'revoked',
      reason: input.reason(body.reason),
      approvalTicketNo: input.approvalTicketNo(body.approvalTicketNo),
    })
  }

  /**
   * 切换授权方式（含切回「不管控」），理由必填。把没有可用授权的机构切到 required，会让它名下终端不能开新会话——
   * 此时必须显式带 confirmLockout: true，否则 409 LICENSE_MODE_WOULD_LOCK_TERMINALS（界面据此二次确认）。
   */
  async setMode(orgId: string, body: SetLicenseModeInput, actor: LicenseActor): Promise<OrgLicenseDetail> {
    if (!LICENSE_MODES.includes(body.licenseMode as LicenseMode)) {
      throw new BadRequestException({
        error: { code: 'LICENSE_MODE_INVALID', message: `授权方式只能是 ${LICENSE_MODES.join(' 或 ')}` },
      })
    }
    const mode = body.licenseMode
    const reason = input.reason(body.reason)
    await this.prisma.$transaction(async (tx) => {
      await lockOrg(tx, this.prisma.dbKind, orgId)
      // 拿到锁之后才读当前方式，不拿锁外读到的旧值做「没变就直接返回」的判断。
      const org = await tx.organization.findUnique({ where: { id: orgId }, select: { licenseMode: true } })
      if (!org) throw orgNotFound()
      const current = normalizeLicenseMode(org.licenseMode)
      if (current === mode) return
      const before = await orgStateSnapshot(tx, orgId)
      let lockout = false
      let terminalCount = 0
      if (mode === 'required') {
        const rows = await tx.license.findMany({ where: { orgId } })
        const resolution = resolveOrgLicense({ mode: 'required', licenses: rows.map(toLicenseWindow), now: licenseNow() })
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
        ...auditBase(actor),
        action: 'license.mode_update',
        targetType: 'organization',
        targetId: orgId,
        payload: {
          before: current,
          after: mode,
          reason,
          confirmLockout: body.confirmLockout === true,
          lockout,
          terminalCount,
          orgState: { before, after: await orgStateSnapshot(tx, orgId) },
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
      version: number
      from: string[]
      to: 'active' | 'suspended' | 'revoked'
      reason: string
      approvalTicketNo: string | null
    },
  ): Promise<LicenseMutationResult> {
    const orgId = await this.prisma.$transaction(async (tx) => {
      const fresh = await lockLicense(tx, this.prisma.dbKind, id)
      if (fresh.status === 'revoked') throw revokedConflict()
      assertVersion(fresh, change.version)
      if (!change.from.includes(fresh.status)) throw statusConflict(fresh.status)
      const stateBefore = await orgStateSnapshot(tx, fresh.orgId)
      // 恢复时清空当前理由与工单号，完整历史在审计日志里。
      const resuming = change.to === 'active'
      await writeVersioned(
        tx,
        fresh,
        {
          status: change.to,
          statusReason: resuming ? null : change.reason,
          statusTicketNo: resuming ? null : change.approvalTicketNo,
          statusChangedAt: licenseNow(),
          statusChangedBy: actor.userId,
        },
        actor.userId,
      )
      await this.audit.writeRequired(tx, {
        ...auditBase(actor),
        action: change.action,
        targetType: 'license',
        targetId: id,
        payload: {
          orgId: fresh.orgId,
          contractNo: fresh.contractNo,
          version: { before: fresh.version, after: fresh.version + 1 },
          before: { status: fresh.status },
          after: { status: change.to },
          reason: change.reason,
          approvalTicketNo: change.approvalTicketNo,
          orgState: { before: stateBefore, after: await orgStateSnapshot(tx, fresh.orgId) },
        },
      })
      return fresh.orgId
    })
    return { licenseId: id, org: await this.getOrgDetail(orgId) }
  }
}
