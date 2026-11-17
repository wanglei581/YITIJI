import crypto from 'crypto'
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { assertCanBindTerminal } from '../licenses/license-gate'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import type { CreateTerminalBatchDto, TerminalBatchSelectionDto } from './dto/terminal-batch.dto'
import { projectActivation } from './terminal-batch.activation'
import { isParkedTerminalOrgType } from './terminal-org-parking'
import { terminalOrgBindingOnCreate } from './terminal-org-binding'
import { TerminalCredentialSecurityService, type TerminalBindCodeAuditContext } from './terminal-credential-security.service'
import {
  PLANNED_CREDENTIAL_PREFIX,
  cleanNullable,
  exceptionErrorCode,
  isUniqueConstraintError,
} from './terminal-utils'

/** 一次批量预建的台数上限。展开之后、写入之前只在这一处判断。 */
export const TERMINAL_BATCH_LIMIT = 200

const TERMINAL_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

export interface TerminalBatchActor {
  actorId: string | null
  actorRole: string
  ipAddress?: string | null
  userAgent?: string | null
  requestId?: string | null
}

export interface TerminalBatchCreatedRow {
  terminalId: string
  terminalCode: string
  displayName: string | null
  locationLabel: string | null
  orgId: string | null
  orgName: string | null
}

export interface TerminalBatchCreated {
  batchId: string
  count: number
  terminals: TerminalBatchCreatedRow[]
}

export interface TerminalBatchIssuedCode {
  terminalId: string
  terminalCode: string
  displayName: string | null
  locationLabel: string | null
  bindCode: string
  expiresAt: string
}

export interface TerminalBatchSkipped {
  terminalId: string | null
  terminalCode: string
  reason: string
}

export interface TerminalBatchBindCodeResult {
  issued: TerminalBatchIssuedCode[]
  skipped: TerminalBatchSkipped[]
}

export interface TerminalBatchRevokeResult {
  revokedCount: number
  terminalCount: number
}

interface ExpandedRow {
  line: number
  terminalCode: string
  displayName: string | null
  locationLabel: string | null
  orgId: string | null
}

interface SelectedTerminal {
  id: string
  terminalCode: string
  displayName: string | null
  locationLabel: string | null
  enabled: boolean
  lifecycleStatus: string
  provisionBatchId: string | null
}

function fail(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}

function exceptionMessage(error: unknown): string {
  const maybe = error as { getResponse?: () => unknown }
  const response = typeof maybe.getResponse === 'function' ? maybe.getResponse() : undefined
  if (response && typeof response === 'object') {
    const message = (response as { error?: { message?: unknown } }).error?.message
    if (typeof message === 'string' && message.trim()) return message
  }
  return '这一行不能预建'
}

@Injectable()
export class TerminalBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly credentials: TerminalCredentialSecurityService,
  ) {}

  async create(dto: CreateTerminalBatchDto, actor: TerminalBatchActor): Promise<TerminalBatchCreated> {
    if (process.env['TERMINAL_PLANNED_PROVISIONING_ENABLED'] !== 'true') {
      throw new ForbiddenException({
        error: {
          code: 'TERMINAL_PLANNED_PROVISIONING_DISABLED',
          message: '设备预创建尚未启用',
        },
      })
    }
    const expanded = expandBatch(dto)
    if (expanded.length > TERMINAL_BATCH_LIMIT) {
      throw fail('TERMINAL_BATCH_TOO_LARGE', `一次最多预建 ${TERMINAL_BATCH_LIMIT} 台`)
    }
    const batchId = `b_${crypto.randomBytes(8).toString('hex')}`
    return this.prisma.$transaction(async (tx) => {
      const errors: string[] = []
      const created: TerminalBatchCreatedRow[] = []
      const orgNames = new Map<string, string>()
      for (const row of expanded) {
        const formatError = rowFormatError(row)
        if (formatError) {
          errors.push(formatError)
          continue
        }
        const existing = await tx.terminal.findUnique({
          where: { terminalCode: row.terminalCode },
          select: { id: true },
        })
        if (existing) {
          errors.push(`第 ${row.line} 行：终端编号已存在`)
          continue
        }
        const orgError = await this.readOrg(tx, row, orgNames)
        if (orgError) {
          errors.push(orgError)
          continue
        }
        try {
          if (row.orgId) await assertCanBindTerminal(tx, this.prisma.dbKind, row.orgId, null)
          const now = new Date()
          const terminal = await tx.terminal.create({
            data: {
              id: `t_${crypto.randomBytes(8).toString('hex')}`,
              terminalCode: row.terminalCode,
              agentToken: `${PLANNED_CREDENTIAL_PREFIX}${crypto.randomBytes(32).toString('hex')}`,
              credentialGeneration: 0,
              lifecycleStatus: 'planned',
              deviceFingerprint: `planned:${crypto.randomBytes(16).toString('hex')}`,
              displayName: row.displayName,
              locationLabel: row.locationLabel,
              orgId: row.orgId,
              orgBoundAt: terminalOrgBindingOnCreate(row.orgId, now),
              provisionBatchId: batchId,
            },
            select: { id: true, terminalCode: true, displayName: true, locationLabel: true, orgId: true },
          })
          created.push({
            terminalId: terminal.id,
            terminalCode: terminal.terminalCode,
            displayName: terminal.displayName ?? null,
            locationLabel: terminal.locationLabel ?? null,
            orgId: terminal.orgId,
            orgName: terminal.orgId ? orgNames.get(terminal.orgId) ?? null : null,
          })
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            errors.push(`第 ${row.line} 行：终端编号已存在`)
            continue
          }
          const code = exceptionErrorCode(error)
          if (code === 'LICENSE_TERMINAL_QUOTA_EXCEEDED' || code === 'LICENSE_NOT_AVAILABLE_FOR_BINDING' || code === 'ORG_TYPE_PARKED') {
            errors.push(`第 ${row.line} 行：${exceptionMessage(error)}`)
            continue
          }
          throw error
        }
      }
      if (errors.length > 0) {
        throw fail('TERMINAL_BATCH_ROW_INVALID', errors.join('；'))
      }
      await this.audit.writeRequired(tx, {
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        action: 'terminal.batch.create',
        targetType: 'terminal_batch',
        targetId: batchId,
        payload: {
          batchId,
          count: created.length,
          terminalCodes: created.map((row) => row.terminalCode),
        },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      })
      return { batchId, count: created.length, terminals: created }
    })
  }

  async issue(dto: TerminalBatchSelectionDto, actor: TerminalBatchActor): Promise<TerminalBatchBindCodeResult> {
    const targets = await this.selectTerminals(dto)
    const issued: TerminalBatchIssuedCode[] = []
    const skipped: TerminalBatchSkipped[] = []
    for (const target of targets) {
      const reason = skipReason(target)
      if (reason || !target) {
        skipped.push({
          terminalId: target?.id ?? null,
          terminalCode: target?.terminalCode ?? '',
          reason: reason ?? '终端不存在',
        })
        continue
      }
      const created = await this.credentials.createBindCode(target.id, actor.actorId, dto.ttlMinutes, auditContext(actor))
      issued.push({
        terminalId: target.id,
        terminalCode: target.terminalCode,
        displayName: target.displayName,
        locationLabel: target.locationLabel,
        bindCode: created.bindCode,
        expiresAt: created.expiresAt,
      })
    }
    await this.audit.write({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: 'terminal.bind_code.batch_create',
      targetType: 'terminal_batch',
      targetId: dto.batchId ?? null,
      payload: bindCodeAuditPayload(dto.batchId ?? null, issued, skipped),
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
      requestId: actor.requestId ?? null,
    })
    return { issued, skipped }
  }

  async revoke(dto: TerminalBatchSelectionDto, actor: TerminalBatchActor): Promise<TerminalBatchRevokeResult> {
    const targets = (await this.selectTerminals(dto)).filter((target): target is SelectedTerminal => target !== null)
    const now = new Date()
    const revokedCount = await this.prisma.$transaction(async (tx) => {
      let count = 0
      for (const target of targets) {
        const revoked = await tx.terminalBindCode.updateMany({
          where: { terminalId: target.id, usedAt: null, revokedAt: null },
          data: { revokedAt: now },
        })
        count += revoked.count
      }
      await this.audit.writeRequired(tx, {
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        action: 'terminal.bind_code.batch_revoke',
        targetType: 'terminal_batch',
        targetId: dto.batchId ?? null,
        payload: {
          batchId: dto.batchId ?? null,
          terminalCodes: targets.map((target) => target.terminalCode),
          revokedCount: count,
        },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      })
      return count
    })
    return { revokedCount, terminalCount: targets.length }
  }

  async reissue(dto: TerminalBatchSelectionDto, actor: TerminalBatchActor): Promise<TerminalBatchBindCodeResult> {
    const targets = await this.selectTerminals(dto)
    const issued: TerminalBatchIssuedCode[] = []
    const skipped: TerminalBatchSkipped[] = []
    const now = new Date()
    for (const target of targets) {
      const reason = skipReason(target)
      if (reason || !target) {
        skipped.push({
          terminalId: target?.id ?? null,
          terminalCode: target?.terminalCode ?? '',
          reason: reason ?? '终端不存在',
        })
        continue
      }
      await this.prisma.terminalBindCode.updateMany({
        where: { terminalId: target.id, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      })
      const created = await this.credentials.createBindCode(target.id, actor.actorId, dto.ttlMinutes, auditContext(actor))
      issued.push({
        terminalId: target.id,
        terminalCode: target.terminalCode,
        displayName: target.displayName,
        locationLabel: target.locationLabel,
        bindCode: created.bindCode,
        expiresAt: created.expiresAt,
      })
    }
    await this.audit.write({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: 'terminal.bind_code.batch_reissue',
      targetType: 'terminal_batch',
      targetId: dto.batchId ?? null,
      payload: bindCodeAuditPayload(dto.batchId ?? null, issued, skipped),
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
      requestId: actor.requestId ?? null,
    })
    return { issued, skipped }
  }

  async attachActivation<T extends { id: string; lifecycleStatus: string }>(terminals: T[]): Promise<Array<T & {
    provisionBatchId: string | null
    activationStatus: string
    activationStatusLabel: string
    firstActivatedAt: string | null
  }>> {
    if (terminals.length === 0) return []
    const ids = terminals.map((terminal) => terminal.id)
    const [codes, rows] = await Promise.all([
      this.prisma.terminalBindCode.findMany({
        where: { terminalId: { in: ids } },
        select: { terminalId: true, usedAt: true, revokedAt: true, expiresAt: true },
      }),
      this.prisma.terminal.findMany({
        where: { id: { in: ids } },
        select: { id: true, provisionBatchId: true },
      }),
    ])
    const codesByTerminal = new Map<string, typeof codes>()
    for (const code of codes) {
      const list = codesByTerminal.get(code.terminalId) ?? []
      list.push(code)
      codesByTerminal.set(code.terminalId, list)
    }
    const batchById = new Map(rows.map((row) => [row.id, row.provisionBatchId]))
    const now = new Date()
    return terminals.map((terminal) => {
      const projected = projectActivation({
        lifecycleStatus: terminal.lifecycleStatus,
        codes: codesByTerminal.get(terminal.id) ?? [],
        now,
      })
      return {
        ...terminal,
        provisionBatchId: batchById.get(terminal.id) ?? null,
        activationStatus: projected.activationStatus,
        activationStatusLabel: projected.activationStatusLabel,
        firstActivatedAt: projected.firstActivatedAt ? projected.firstActivatedAt.toISOString() : null,
      }
    })
  }

  private async selectTerminals(dto: TerminalBatchSelectionDto): Promise<Array<SelectedTerminal | null>> {
    const ids = dto.terminalIds?.map((id) => id.trim()).filter((id) => id.length > 0) ?? []
    if (ids.length > TERMINAL_BATCH_LIMIT) {
      throw fail('TERMINAL_BATCH_TOO_LARGE', `一次最多处理 ${TERMINAL_BATCH_LIMIT} 台`)
    }
    if (ids.length > 0) {
      const rows = await this.prisma.terminal.findMany({
        where: { id: { in: ids } },
        select: terminalSelect,
      })
      const byId = new Map(rows.map((row) => [row.id, row]))
      return ids.map((id) => byId.get(id) ?? null)
    }
    const batchId = dto.batchId?.trim()
    if (!batchId) throw fail('TERMINAL_BATCH_SELECTION_EMPTY', '先选择终端，或指定批次号')
    return this.prisma.terminal.findMany({
      where: { provisionBatchId: batchId },
      orderBy: { terminalCode: 'asc' },
      select: terminalSelect,
    })
  }

  private async readOrg(
    tx: PrismaTransactionClient,
    row: ExpandedRow,
    orgNames: Map<string, string>,
  ): Promise<string | null> {
    if (!row.orgId) return null
    const cached = orgNames.get(row.orgId)
    if (cached) return null
    const org = await tx.organization.findUnique({
      where: { id: row.orgId },
      select: { name: true, enabled: true, type: true },
    })
    if (!org) return `第 ${row.line} 行：机构不存在`
    if (!org.enabled) return `第 ${row.line} 行：机构已停用，不能预建终端`
    if (isParkedTerminalOrgType(org.type)) return `第 ${row.line} 行：该机构类型已停放，不能绑定终端`
    orgNames.set(row.orgId, org.name)
    return null
  }
}

const terminalSelect = {
  id: true,
  terminalCode: true,
  displayName: true,
  locationLabel: true,
  enabled: true,
  lifecycleStatus: true,
  provisionBatchId: true,
} as const

function skipReason(target: SelectedTerminal | null): string | null {
  if (!target) return '终端不存在'
  if (!target.enabled) return '已停用'
  if (target.lifecycleStatus !== 'planned') return '已激活'
  return null
}

function auditContext(actor: TerminalBatchActor): TerminalBindCodeAuditContext {
  return {
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  }
}

function bindCodeAuditPayload(
  batchId: string | null,
  issued: TerminalBatchIssuedCode[],
  skipped: TerminalBatchSkipped[],
): {
  batchId: string | null
  issuedCount: number
  terminalCodes: string[]
  skipped: Array<{ terminalCode: string; reason: string }>
} {
  return {
    batchId,
    issuedCount: issued.length,
    terminalCodes: issued.map((row) => row.terminalCode),
    skipped: skipped.map((row) => ({ terminalCode: row.terminalCode, reason: row.reason })),
  }
}

function expandBatch(dto: CreateTerminalBatchDto): ExpandedRow[] {
  const hasRange = dto.range !== undefined && dto.range !== null
  const hasRows = (dto.rows?.length ?? 0) > 0
  if (hasRange && hasRows) throw fail('TERMINAL_BATCH_INPUT_CONFLICT', '一次只能用一种填法')
  if (hasRange && dto.range) {
    const start = dto.range.start
    const end = dto.range.end
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
      throw fail('TERMINAL_BATCH_ROW_INVALID', '第 1 行：起止编号不正确')
    }
    const count = end - start + 1
    if (count > 10_000) throw fail('TERMINAL_BATCH_TOO_LARGE', `一次最多预建 ${TERMINAL_BATCH_LIMIT} 台`)
    const width = String(end).length
    const locationLabel = cleanNullable(dto.range.locationLabel) ?? null
    const orgId = dto.range.orgId?.trim() || null
    const rows: ExpandedRow[] = []
    for (let number = start; number <= end; number += 1) {
      rows.push({
        line: number - start + 1,
        terminalCode: `${dto.range.prefix}${String(number).padStart(width, '0')}`,
        displayName: `${dto.range.prefix}${String(number).padStart(width, '0')}`,
        locationLabel,
        orgId,
      })
    }
    return rows
  }
  if (!hasRows || !dto.rows) throw fail('TERMINAL_BATCH_EMPTY', '没有要预建的终端')
  return dto.rows.map((row, index) => ({
    line: index + 1,
    terminalCode: row.terminalCode.trim(),
    displayName: cleanNullable(row.displayName) ?? null,
    locationLabel: cleanNullable(row.locationLabel) ?? null,
    orgId: row.orgId?.trim() || null,
  }))
}

function rowFormatError(row: ExpandedRow): string | null {
  if (!row.terminalCode) return `第 ${row.line} 行：终端编号不能为空`
  if (row.terminalCode.length > 64 || !TERMINAL_CODE.test(row.terminalCode)) {
    return `第 ${row.line} 行：终端编号只能包含字母、数字、下划线和连字符`
  }
  if (row.displayName && row.displayName.length > 120) return `第 ${row.line} 行：终端名称过长`
  if (row.locationLabel && row.locationLabel.length > 200) return `第 ${row.line} 行：点位过长`
  return null
}
