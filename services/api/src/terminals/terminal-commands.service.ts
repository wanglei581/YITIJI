import { randomBytes } from 'crypto'
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { deliverOpsAlert } from '../admin-ops/admin-alert-push.service'
import { AuditService } from '../audit/audit.service'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalCredentialSecurityService } from './terminal-credential-security.service'
import { isUniqueConstraintError } from './terminal-utils'

const RESTART_TYPE = 'restart_agent'
const CLEAR_TYPE = 'clear_print_queue'
const COMMAND_TYPES = [RESTART_TYPE, CLEAR_TYPE] as const
const STATUS_PENDING = 'pending'
const STATUS_ACCEPTED = 'accepted'
const STATUS_COMPLETED = 'completed'
const STATUS_DONE = 'done'
const STATUS_REJECTED_BUSY = 'rejected_busy'
const STATUS_EXPIRED = 'expired'
const STATUS_FAILED = 'failed'
const CLEAR_FAILED_ALERT = 'terminal_print_queue_clear_failed'
const INT4_MAX = 2147483647
const OPEN_STATUSES = [STATUS_PENDING, STATUS_ACCEPTED] as const
const RATE_LIMIT = 3
const RATE_WINDOW_MS = 60 * 60 * 1000
const COMMAND_TTL_MS = 10 * 60 * 1000
const ACCEPT_TIMEOUT_MS = 15 * 60 * 1000
const NO_HEARTBEAT_RESULT = 'no_heartbeat_after_restart'

export interface TerminalCommandView {
  id: string
  type: string
  status: string
  requestedBy: { id: string; name: string }
  requestedAt: string
  expiresAt: string
  acceptedAt: string | null
  finishedAt: string | null
  completedVerified: boolean | null
  resultCode: string | null
  remainingJobs: number | null
}

export type TerminalCommandType = (typeof COMMAND_TYPES)[number]
export type TerminalCommandAckResult = 'accepted' | 'rejected_busy' | 'expired' | 'done' | 'failed'

export interface AgentTerminalCommand {
  id: string
  type: TerminalCommandType
  issuedAt: string
  expiresAt: string
}

export interface CommandRequestMeta {
  ipAddress: string | null
  userAgent: string | null
  requestId: string | null
}

type IssueOutcome =
  | { kind: 'rate' }
  | { kind: 'open'; commandId: string }
  | { kind: 'created'; row: CommandRow }

type CommandRow = {
  id: string
  terminalId: string
  type: string
  status: string
  requestedAt: Date
  expiresAt: Date
  acceptedAt: Date | null
  finishedAt: Date | null
  completedVerified: boolean | null
  resultCode: string | null
  remainingJobs: number | null
  requestedBy: { id: string; name: string }
}

type AckBody = { result: string; remainingJobs?: unknown }

type AckDecision =
  | { kind: 'invalid' }
  | {
      kind: 'ok'
      result: TerminalCommandAckResult
      nextStatus: string
      finishedAt: Date | null
      resultCode: string | null
      remainingJobs: number | null
      data: {
        status: string
        acceptedAt?: Date
        finishedAt?: Date
        resultCode?: string | null
        remainingJobs?: number
      }
    }

@Injectable()
export class TerminalCommandService {
  private readonly logger = new Logger(TerminalCommandService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly credentials: TerminalCredentialSecurityService,
    private readonly redis: RedisService,
  ) {}

  async issue(
    terminalId: string,
    type: unknown,
    actor: { userId: string; role: string },
    meta: CommandRequestMeta,
    now = new Date(),
  ): Promise<TerminalCommandView> {
    const commandType = parseCommandType(type)
    if (!commandType) {
      throw new BadRequestException({
        error: { code: 'TERMINAL_COMMAND_TYPE_INVALID', message: '命令类型不正确' },
      })
    }
    const terminal = await this.prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { id: true, terminalCode: true, enabled: true, lifecycleStatus: true },
    })
    if (!terminal) {
      throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
    }
    if (!terminal.enabled || terminal.lifecycleStatus !== 'active') {
      throw new ConflictException({
        error: { code: 'TERMINAL_NOT_OPERATIONAL', message: '终端不在运营中' },
      })
    }
    const actorRow = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, name: true },
    })
    if (!actorRow) {
      throw new HttpException(
        { error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' } },
        HttpStatus.UNAUTHORIZED,
      )
    }

    const requestedAt = now
    const expiresAt = new Date(requestedAt.getTime() + COMMAND_TTL_MS)
    const since = new Date(requestedAt.getTime() - RATE_WINDOW_MS)
    let created: IssueOutcome
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const recent = await tx.terminalCommand.count({
          where: { terminalId, requestedAt: { gte: since } },
        })
        if (recent >= RATE_LIMIT) {
          return { kind: 'rate' as const }
        }
        const open = await tx.terminalCommand.findFirst({
          where: { terminalId, status: { in: [...OPEN_STATUSES] } },
          select: { id: true },
        })
        if (open) return { kind: 'open' as const, commandId: open.id }
        const row = await tx.terminalCommand.create({
          data: {
            id: `tcmd_${randomBytes(16).toString('hex')}`,
            terminalId,
            type: commandType,
            status: STATUS_PENDING,
            requestedById: actorRow.id,
            requestedAt,
            expiresAt,
          },
          include: { requestedBy: { select: { id: true, name: true } } },
        })
        return { kind: 'created' as const, row }
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const open = await this.prisma.terminalCommand.findFirst({
        where: { terminalId, status: { in: [...OPEN_STATUSES] } },
        select: { id: true },
      })
      throw pendingConflict(open?.id)
    }

    if (created.kind === 'rate') {
      throw new HttpException(
        { error: { code: 'TERMINAL_COMMAND_RATE_LIMITED', message: '这台终端一小时内的远程命令已达 3 次' } },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    if (created.kind === 'open') throw pendingConflict(created.commandId)

    await this.audit.write({
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'terminal.command.requested',
      targetType: 'terminal',
      targetId: terminal.terminalCode,
      payload: { terminalCode: terminal.terminalCode, type: commandType, commandId: created.row.id },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    })
    return toView(created.row)
  }

  async list(terminalId: string, limitRaw: string | undefined): Promise<TerminalCommandView[]> {
    const terminal = await this.prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { id: true },
    })
    if (!terminal) {
      throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
    }
    const rows = await this.prisma.terminalCommand.findMany({
      where: { terminalId },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: parseCommandListLimit(limitRaw),
      include: { requestedBy: { select: { id: true, name: true } } },
    })
    return rows.map(toView)
  }

  async ack(
    terminalId: string,
    commandId: string,
    body: AckBody,
    authHeader: string | undefined,
    now = new Date(),
  ): Promise<{ result: TerminalCommandAckResult }> {
    await this.credentials.validateTerminalToken(terminalId, authHeader, { allowDisabled: true })
    const terminal = await this.prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { terminalCode: true, displayName: true },
    })
    if (!terminal) {
      throw new NotFoundException({ error: { code: 'TERMINAL_COMMAND_NOT_FOUND', message: '命令不存在' } })
    }
    const command = await this.prisma.terminalCommand.findUnique({ where: { id: commandId } })
    if (!command || command.terminalId !== terminalId) {
      throw new NotFoundException({ error: { code: 'TERMINAL_COMMAND_NOT_FOUND', message: '命令不存在' } })
    }

    const decision = decideAck(command, body, now)
    if (decision.kind === 'invalid') throw ackInvalid()

    if (decision.nextStatus !== command.status) {
      const updated = await this.prisma.terminalCommand.updateMany({
        where: { id: command.id, status: command.status },
        data: decision.data,
      })
      if (updated.count === 1 && decision.finishedAt) {
        await this.writeFinished(
          terminal.terminalCode,
          command.id,
          command.type,
          decision.result,
          decision.resultCode,
          'terminal',
          decision.remainingJobs,
        )
        if (decision.result === STATUS_FAILED && command.type === CLEAR_TYPE && typeof decision.remainingJobs === 'number') {
          await this.pushQueueClearFailed(terminal, command.id, decision.remainingJobs)
        }
      }
      if (updated.count === 0) {
        const latest = await this.prisma.terminalCommand.findUnique({ where: { id: command.id } })
        const adopted = latest && latest.terminalId === terminalId ? publicResult(latest) : decision.result
        const jobs = latest && latest.type === CLEAR_TYPE && adopted === STATUS_FAILED ? latest.remainingJobs : null
        await this.writeAcked(terminal.terminalCode, command.id, command.type, adopted, jobs)
        return { result: adopted }
      }
    }

    const jobs = decision.result === STATUS_FAILED ? decision.remainingJobs : null
    await this.writeAcked(terminal.terminalCode, command.id, command.type, decision.result, jobs)
    return { result: decision.result }
  }

  async decorateHeartbeat<T extends object>(
    terminalId: string,
    agentStartedAt: string | undefined,
    run: () => Promise<T>,
  ): Promise<T & { commands?: AgentTerminalCommand[] }> {
    const base = await run()
    // 命令表出错只影响这一轮下发，不许拖垮心跳本身（心跳失败会让终端被判离线）。
    let commands: AgentTerminalCommand[]
    try {
      await this.completeAccepted(terminalId, agentStartedAt)
      commands = await this.pendingForAgent(terminalId)
    } catch (error) {
      this.logger.warn(`TERMINAL_COMMAND_HEARTBEAT_FAILED ${describeCommandError(error)}`)
      return base
    }
    if (commands.length === 0) return base
    return { ...base, commands }
  }

  async sweep(now = new Date()): Promise<void> {
    const expired = await this.prisma.terminalCommand.findMany({
      where: { status: STATUS_PENDING, expiresAt: { lt: now } },
      include: { terminal: { select: { terminalCode: true } } },
    })
    for (const row of expired) {
      const updated = await this.prisma.terminalCommand.updateMany({
        where: { id: row.id, status: STATUS_PENDING },
        data: { status: STATUS_EXPIRED, finishedAt: now, resultCode: STATUS_EXPIRED },
      })
      if (updated.count === 1) {
        await this.writeFinished(row.terminal.terminalCode, row.id, row.type, STATUS_EXPIRED, STATUS_EXPIRED, 'system')
      }
    }

    const cutoff = new Date(now.getTime() - ACCEPT_TIMEOUT_MS)
    // 清空打印队列不进入 accepted，也不参与「接受后 15 分钟无心跳判失败」。
    const stalled = await this.prisma.terminalCommand.findMany({
      where: { status: STATUS_ACCEPTED, type: RESTART_TYPE, acceptedAt: { lt: cutoff } },
      include: { terminal: { select: { terminalCode: true, displayName: true } } },
    })
    for (const row of stalled) {
      const updated = await this.prisma.terminalCommand.updateMany({
        where: { id: row.id, status: STATUS_ACCEPTED },
        data: { status: STATUS_FAILED, finishedAt: now, resultCode: NO_HEARTBEAT_RESULT },
      })
      if (updated.count !== 1) continue
      await this.writeFinished(row.terminal.terminalCode, row.id, row.type, STATUS_FAILED, NO_HEARTBEAT_RESULT, 'system')
      try {
        const label = row.terminal.displayName?.trim() || row.terminal.terminalCode
        await deliverOpsAlert({
          redis: this.redis,
          webhook: process.env['ALERT_WEBHOOK_URL']?.trim() || null,
          fetchImpl: globalThis.fetch.bind(globalThis),
          alert: {
            subjectKey: row.id,
            episodeToken: row.id,
            type: 'terminal_restart_no_heartbeat',
            severity: 'error',
            title: `终端 ${label} 远程重启后没有恢复心跳`,
            terminalCode: row.terminal.terminalCode,
          },
          state: 'firing',
          logger: this.logger,
        })
      } catch (error) {
        this.logger.warn(
          `ALERT_PUSH_FAILED phase=terminal_restart ${describeCommandError(error)}`,
        )
      }
    }
  }

  private async completeAccepted(terminalId: string, agentStartedAt: string | undefined, now = new Date()): Promise<void> {
    const startedAt = parseStartedAt(agentStartedAt)
    if (startedAt === 'invalid') return
    const rows = await this.prisma.terminalCommand.findMany({
      where: { terminalId, status: STATUS_ACCEPTED, type: RESTART_TYPE },
      include: { terminal: { select: { terminalCode: true } } },
    })
    for (const row of rows) {
      if (!row.acceptedAt) continue
      if (startedAt) {
        if (startedAt.getTime() <= row.acceptedAt.getTime()) continue
        await this.markCompleted(row, true, now)
      } else if (row.acceptedAt.getTime() <= now.getTime()) {
        await this.markCompleted(row, false, now)
      }
    }
  }

  private async pendingForAgent(terminalId: string, now = new Date()): Promise<AgentTerminalCommand[]> {
    const rows = await this.prisma.terminalCommand.findMany({
      where: {
        terminalId,
        status: STATUS_PENDING,
        type: { in: [...COMMAND_TYPES] },
        expiresAt: { gte: now },
      },
      orderBy: { requestedAt: 'asc' },
    })
    const commands: AgentTerminalCommand[] = []
    for (const row of rows) {
      const type = parseCommandType(row.type)
      if (!type) continue
      commands.push({
        id: row.id,
        type,
        issuedAt: row.requestedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      })
    }
    return commands
  }

  private async markCompleted(
    row: { id: string; type: string; terminal: { terminalCode: string } },
    completedVerified: boolean,
    now: Date,
  ): Promise<void> {
    const updated = await this.prisma.terminalCommand.updateMany({
      where: { id: row.id, status: STATUS_ACCEPTED },
      data: { status: STATUS_COMPLETED, finishedAt: now, completedVerified, resultCode: null },
    })
    if (updated.count === 1) {
      await this.writeFinished(row.terminal.terminalCode, row.id, row.type, STATUS_COMPLETED, null, 'terminal')
    }
  }

  private async pushQueueClearFailed(
    terminal: { terminalCode: string; displayName: string | null },
    commandId: string,
    remainingJobs: number,
  ): Promise<void> {
    try {
      const label = terminal.displayName?.trim() || terminal.terminalCode
      await deliverOpsAlert({
        redis: this.redis,
        webhook: process.env['ALERT_WEBHOOK_URL']?.trim() || null,
        fetchImpl: globalThis.fetch.bind(globalThis),
        alert: {
          subjectKey: commandId,
          episodeToken: commandId,
          type: CLEAR_FAILED_ALERT,
          severity: 'error',
          title: `终端 ${label} 清空打印队列失败，还剩 ${remainingJobs} 个作业`,
          terminalCode: terminal.terminalCode,
        },
        state: 'firing',
        logger: this.logger,
      })
    } catch (error) {
      this.logger.warn(`ALERT_PUSH_FAILED phase=terminal_print_queue_clear ${describeCommandError(error)}`)
    }
  }

  private async writeAcked(
    terminalCode: string,
    commandId: string,
    type: string,
    result: string,
    remainingJobs: number | null,
  ): Promise<void> {
    await this.audit.write({
      actorId: null,
      actorRole: 'terminal',
      action: 'terminal.command.acked',
      targetType: 'terminal',
      targetId: terminalCode,
      payload: auditPayload(terminalCode, commandId, type, result, null, remainingJobs),
    })
  }

  private async writeFinished(
    terminalCode: string,
    commandId: string,
    type: string,
    result: string,
    resultCode: string | null,
    actorRole: 'terminal' | 'system',
    remainingJobs: number | null = null,
  ): Promise<void> {
    await this.audit.write({
      actorId: null,
      actorRole,
      action: 'terminal.command.finished',
      targetType: 'terminal',
      targetId: terminalCode,
      payload: auditPayload(terminalCode, commandId, type, result, resultCode, remainingJobs),
    })
  }
}

/** 只记错误类型与错误码，不记 message（webhook 地址、库连接串可能在里面）。 */
function describeCommandError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return `type=${error.name}${typeof code === 'string' || typeof code === 'number' ? ` code=${code}` : ''}`
  }
  return `type=${typeof error}`
}

function pendingConflict(commandId: string | undefined): ConflictException {
  return new ConflictException({
    error: {
      code: 'TERMINAL_COMMAND_PENDING',
      message: '这台终端还有一条没结束的远程命令',
      ...(commandId ? { commandId } : {}),
    },
  })
}

function parseCommandListLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 20
  if (!/^\d{1,4}$/.test(raw)) return 20
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) return 20
  return Math.min(value, 100)
}

function parseStartedAt(value: string | undefined): Date | null | 'invalid' {
  if (value === undefined) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'invalid'
  return parsed
}

function parseCommandType(type: unknown): TerminalCommandType | null {
  if (type === RESTART_TYPE || type === CLEAR_TYPE) return type
  return null
}

function resultAllowed(type: string, result: string): boolean {
  if (type === CLEAR_TYPE) {
    return result === STATUS_DONE || result === STATUS_FAILED || result === STATUS_REJECTED_BUSY || result === STATUS_EXPIRED
  }
  if (type === RESTART_TYPE) {
    return result === STATUS_ACCEPTED || result === STATUS_REJECTED_BUSY || result === STATUS_EXPIRED
  }
  return false
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= INT4_MAX
}

function ackInvalid(): BadRequestException {
  return new BadRequestException({
    error: { code: 'TERMINAL_COMMAND_ACK_INVALID', message: '回执内容不正确' },
  })
}

function publicResult(command: { type: string; status: string }): TerminalCommandAckResult {
  if (command.type === CLEAR_TYPE) {
    if (
      command.status === STATUS_DONE
      || command.status === STATUS_FAILED
      || command.status === STATUS_REJECTED_BUSY
      || command.status === STATUS_EXPIRED
    ) {
      return command.status
    }
  }
  if (command.status === STATUS_REJECTED_BUSY) return STATUS_REJECTED_BUSY
  if (command.status === STATUS_EXPIRED) return STATUS_EXPIRED
  return STATUS_ACCEPTED
}

function auditPayload(
  terminalCode: string,
  commandId: string,
  type: string,
  result: string,
  resultCode: string | null,
  remainingJobs: number | null,
): Record<string, unknown> {
  return {
    terminalCode,
    commandId,
    type,
    result,
    ...(resultCode ? { resultCode } : {}),
    ...(result === STATUS_FAILED && typeof remainingJobs === 'number' ? { remainingJobs } : {}),
  }
}

function decideAck(
  command: { type: string; status: string; expiresAt: Date; remainingJobs: number | null },
  body: AckBody,
  now: Date,
): AckDecision {
  if (command.status === STATUS_PENDING && command.expiresAt.getTime() < now.getTime()) {
    return {
      kind: 'ok',
      result: STATUS_EXPIRED,
      nextStatus: STATUS_EXPIRED,
      finishedAt: now,
      resultCode: STATUS_EXPIRED,
      remainingJobs: null,
      data: { status: STATUS_EXPIRED, finishedAt: now, resultCode: STATUS_EXPIRED },
    }
  }
  if (!resultAllowed(command.type, body.result)) return { kind: 'invalid' }
  if (command.type === RESTART_TYPE && body.remainingJobs !== undefined) return { kind: 'invalid' }
  if (command.status !== STATUS_PENDING) {
    const result = publicResult(command)
    return {
      kind: 'ok',
      result,
      nextStatus: command.status,
      finishedAt: null,
      resultCode: null,
      remainingJobs: result === STATUS_FAILED && command.type === CLEAR_TYPE ? command.remainingJobs : null,
      data: { status: command.status },
    }
  }
  if (command.type === CLEAR_TYPE) return decideClearPending(body, now)
  return decideRestartPending(body.result, now)
}

function decideClearPending(body: AckBody, now: Date): AckDecision {
  if (body.result === STATUS_FAILED) {
    if (!isNonNegInt(body.remainingJobs)) return { kind: 'invalid' }
    return finishClear(STATUS_FAILED, now, body.remainingJobs, null)
  }
  if (body.result === STATUS_DONE) {
    if (body.remainingJobs !== undefined && body.remainingJobs !== 0) return { kind: 'invalid' }
    return finishClear(STATUS_DONE, now, 0, null)
  }
  if (body.result === STATUS_REJECTED_BUSY || body.result === STATUS_EXPIRED) {
    return finishClear(body.result, now, null, body.result)
  }
  return { kind: 'invalid' }
}

function finishClear(
  status: 'done' | 'failed' | 'rejected_busy' | 'expired',
  now: Date,
  remainingJobs: number | null,
  resultCode: string | null,
): AckDecision {
  return {
    kind: 'ok',
    result: status,
    nextStatus: status,
    finishedAt: now,
    resultCode,
    remainingJobs,
    data: {
      status,
      finishedAt: now,
      resultCode,
      ...(typeof remainingJobs === 'number' ? { remainingJobs } : {}),
    },
  }
}

function decideRestartPending(result: string, now: Date): AckDecision {
  if (result === STATUS_EXPIRED) {
    return {
      kind: 'ok',
      result: STATUS_EXPIRED,
      nextStatus: STATUS_EXPIRED,
      finishedAt: now,
      resultCode: STATUS_EXPIRED,
      remainingJobs: null,
      data: { status: STATUS_EXPIRED, finishedAt: now, resultCode: STATUS_EXPIRED },
    }
  }
  if (result === STATUS_ACCEPTED) {
    return {
      kind: 'ok',
      result: STATUS_ACCEPTED,
      nextStatus: STATUS_ACCEPTED,
      finishedAt: null,
      resultCode: null,
      remainingJobs: null,
      data: { status: STATUS_ACCEPTED, acceptedAt: now },
    }
  }
  return {
    kind: 'ok',
    result: STATUS_REJECTED_BUSY,
    nextStatus: STATUS_REJECTED_BUSY,
    finishedAt: now,
    resultCode: STATUS_REJECTED_BUSY,
    remainingJobs: null,
    data: { status: STATUS_REJECTED_BUSY, finishedAt: now, resultCode: STATUS_REJECTED_BUSY },
  }
}

function toView(row: CommandRow): TerminalCommandView {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    requestedBy: { id: row.requestedBy.id, name: row.requestedBy.name },
    requestedAt: row.requestedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    completedVerified: row.completedVerified,
    resultCode: row.resultCode,
    remainingJobs: row.type === CLEAR_TYPE ? row.remainingJobs : null,
  }
}
