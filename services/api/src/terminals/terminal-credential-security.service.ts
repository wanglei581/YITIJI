import crypto from 'crypto'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import type { PrismaTransactionClient } from '../prisma/prisma.service'
import type { ExchangeTerminalBindCodeDto } from './dto/exchange-terminal-bind-code.dto'
import {
  CREDENTIAL_SENTINEL_PREFIX,
  DEFAULT_AGENT_CREDENTIAL_TTL_MS,
  DEFAULT_BIND_CODE_TTL_MINUTES,
  cleanNullable,
  constantTimeEquals,
  hashAgentToken,
  hashBindCode,
  makeBindCode,
  makeCredentialId,
  normalizeMacAddress,
  type CredentialIssueSource,
} from './terminal-utils'

export interface TerminalBindCodeCreated {
  terminalId: string
  terminalCode: string
  bindCode: string
  expiresAt: string
}

export interface TerminalBindCodeExchangeResult {
  terminalId: string
  terminalCode: string
  terminalToken: string
  expiresAt: string
  credentialId: string
  generation: number
}

export interface TerminalBindCodeAuditContext {
  actorId: string | null
  actorRole: string
  ipAddress?: string | null
  userAgent?: string | null
  requestId?: string | null
}

export interface EmergencyCredentialRevokeResult {
  terminalId: string
  terminalCode: string
  oldStatus: 'commissioning' | 'active' | 'maintenance' | 'suspended'
  newStatus: 'suspended'
  lifecycleVersion: number
  credentialGeneration: number
  revokedCredentialCount: number
  revokedBindCodeCount: number
  inFlightTaskCount: number
}

@Injectable()
export class TerminalCredentialSecurityService {
  private readonly logger = new Logger(TerminalCredentialSecurityService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createBindCode(
    terminalRef: string,
    actorId: string | null,
    ttlMinutes = DEFAULT_BIND_CODE_TTL_MINUTES,
    auditContext?: TerminalBindCodeAuditContext,
  ): Promise<TerminalBindCodeCreated> {
    const ttl = Math.min(60, Math.max(1, Math.round(ttlMinutes || DEFAULT_BIND_CODE_TTL_MINUTES)))
    const now = new Date()
    const expiresAt = new Date(Date.now() + ttl * 60 * 1000)

    for (let attempt = 0; attempt < 3; attempt++) {
      const bindCode = makeBindCode()
      try {
        const terminal = await this.prisma.$transaction(async (tx) => {
          const current = await tx.terminal.findFirst({
            where: this.terminalRefWhere(terminalRef),
            select: { id: true, terminalCode: true, enabled: true, lifecycleStatus: true, lifecycleVersion: true },
          })
          if (!current) {
            throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
          }
          if (!current.enabled) {
            throw new BadRequestException({ error: { code: 'TERMINAL_DISABLED', message: '终端已停用，不能生成绑定码' } })
          }
          if (current.lifecycleStatus !== 'planned' && current.lifecycleStatus !== 'maintenance') {
            throw new BadRequestException({
              error: {
                code: 'TERMINAL_MAINTENANCE_REQUIRED',
                message: '已激活终端必须先进入 maintenance 并排空在途任务后才能换机绑定',
              },
            })
          }
          const lifecycleLock = await tx.terminal.updateMany({
            where: {
              id: current.id,
              enabled: true,
              lifecycleStatus: current.lifecycleStatus,
              lifecycleVersion: current.lifecycleVersion,
            },
            data: { lifecycleStatus: current.lifecycleStatus },
          })
          if (lifecycleLock.count !== 1) {
            throw new BadRequestException({
              error: { code: 'TERMINAL_LIFECYCLE_CONFLICT', message: '终端运维状态已变化，请刷新后重试' },
            })
          }
          if (current.lifecycleStatus === 'maintenance') {
            const inFlightCount = await tx.printTask.count({
              where: { terminalId: current.id, status: { in: ['claimed', 'printing'] } },
            })
            if (inFlightCount > 0) {
              throw new BadRequestException({
                error: { code: 'TERMINAL_IN_FLIGHT_TASKS', message: '终端仍有已领取或打印中任务，排空前不能生成换机绑定码' },
              })
            }
          }
          await tx.terminalBindCode.updateMany({
            where: {
              terminalId: current.id,
              usedAt: null,
              revokedAt: null,
              expiresAt: { gt: now },
            },
            data: { revokedAt: now },
          })
          await tx.terminalBindCode.create({
            data: {
              terminalId: current.id,
              terminalCode: current.terminalCode,
              codeHash: hashBindCode(bindCode),
              createdBy: actorId,
              expiresAt,
            },
          })
          await this.audit.writeRequired(tx, {
            actorId,
            actorRole: auditContext?.actorRole ?? (actorId ? 'admin' : 'system'),
            action: 'terminal.bind_code.create',
            targetType: 'terminal',
            targetId: current.terminalCode,
            payload: {
              terminalCode: current.terminalCode,
              expiresAt: expiresAt.toISOString(),
              bindCodeReturnedOnce: true,
            },
            ipAddress: auditContext?.ipAddress ?? null,
            userAgent: auditContext?.userAgent ?? null,
            requestId: auditContext?.requestId ?? null,
          })
          return current
        })
        return {
          terminalId: terminal.id,
          terminalCode: terminal.terminalCode,
          bindCode,
          expiresAt: expiresAt.toISOString(),
        }
      } catch (error) {
        if (attempt === 2) throw error
      }
    }
    throw new Error('Failed to create terminal bind code')
  }

  async exchangeBindCode(dto: ExchangeTerminalBindCodeDto): Promise<TerminalBindCodeExchangeResult> {
    const codeHash = hashBindCode(dto.bindCode)
    const now = new Date()
    const agentToken = crypto.randomBytes(32).toString('hex')
    const credentialId = makeCredentialId()
    const expiresAt = new Date(Date.now() + DEFAULT_AGENT_CREDENTIAL_TTL_MS)
    const macAddress = normalizeMacAddress(dto.macAddress)
    const locationLabel = cleanNullable(dto.locationLabel)
    const displayName = cleanNullable(dto.displayName)

    const result = await this.prisma.$transaction(async (tx) => {
      const bind = await tx.terminalBindCode.findUnique({
        where: { codeHash },
        include: {
          terminal: {
            select: { id: true, terminalCode: true, enabled: true, lifecycleStatus: true, lifecycleVersion: true },
          },
        },
      })
      if (!bind) throw new UnauthorizedException({ error: { code: 'BIND_CODE_INVALID', message: '绑定码无效' } })
      if (bind.revokedAt) throw new UnauthorizedException({ error: { code: 'BIND_CODE_REVOKED', message: '绑定码已撤销' } })
      if (bind.usedAt) throw new UnauthorizedException({ error: { code: 'BIND_CODE_USED', message: '绑定码已使用' } })
      if (bind.expiresAt <= now) throw new UnauthorizedException({ error: { code: 'BIND_CODE_EXPIRED', message: '绑定码已过期' } })
      if (!bind.terminal.enabled) throw new ForbiddenException({ error: { code: 'TERMINAL_DISABLED', message: '终端已停用，不能绑定' } })
      if (bind.terminal.lifecycleStatus !== 'planned' && bind.terminal.lifecycleStatus !== 'maintenance') {
        throw new ForbiddenException({
          error: { code: 'TERMINAL_MAINTENANCE_REQUIRED', message: '已激活终端必须保持 maintenance 才能兑换换机绑定码' },
        })
      }
      const lifecycleLock = await tx.terminal.updateMany({
        where: {
          id: bind.terminalId,
          enabled: true,
          lifecycleStatus: bind.terminal.lifecycleStatus,
          lifecycleVersion: bind.terminal.lifecycleVersion,
        },
        data: { lifecycleStatus: bind.terminal.lifecycleStatus },
      })
      if (lifecycleLock.count !== 1) {
        throw new ForbiddenException({
          error: { code: 'TERMINAL_LIFECYCLE_CONFLICT', message: '终端运维状态已变化，请重新生成绑定码' },
        })
      }
      if (bind.terminal.lifecycleStatus === 'maintenance') {
        const inFlightCount = await tx.printTask.count({
          where: { terminalId: bind.terminalId, status: { in: ['claimed', 'printing'] } },
        })
        if (inFlightCount > 0) {
          throw new ForbiddenException({
            error: { code: 'TERMINAL_IN_FLIGHT_TASKS', message: '终端仍有在途任务，不能兑换换机绑定码' },
          })
        }
      }
      if (macAddress) {
        const found = await tx.terminal.findFirst({ where: { macAddress }, select: { id: true, terminalCode: true } })
        if (found && found.id !== bind.terminalId) {
          throw new BadRequestException({ error: { code: 'MAC_ALREADY_BOUND', message: `MAC 地址已绑定到终端 ${found.terminalCode}` } })
        }
      }
      const consumed = await tx.terminalBindCode.updateMany({
        where: { id: bind.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      })
      if (consumed.count !== 1) throw new UnauthorizedException({ error: { code: 'BIND_CODE_USED', message: '绑定码已使用' } })
      const terminal = await tx.terminal.update({
        where: { id: bind.terminalId },
        data: {
          agentToken,
          credentialGeneration: { increment: 1 },
          deviceFingerprint: dto.deviceFingerprint,
          ...(displayName !== undefined ? { displayName } : {}),
          ...(macAddress !== undefined ? { macAddress } : {}),
          ...(locationLabel !== undefined ? { locationLabel } : {}),
          ...(bind.terminal.lifecycleStatus === 'planned' ? { lifecycleStatus: 'commissioning' } : {}),
        },
        select: { id: true, terminalCode: true, credentialGeneration: true },
      })
      await this.persistIssuedCredential(tx, {
        credentialId,
        terminalId: terminal.id,
        token: agentToken,
        generation: terminal.credentialGeneration,
        issueSource: 'bind_code',
        expiresAt,
      })
      await this.audit.writeRequired(tx, {
        actorId: null,
        actorRole: 'terminal-agent',
        action: 'terminal.bind_code.exchange',
        targetType: 'terminal',
        targetId: terminal.terminalCode,
        payload: {
          terminalCode: terminal.terminalCode,
          displayName,
          macAddress,
          locationLabel,
          agentVersion: cleanNullable(dto.agentVersion) ?? null,
          deviceFingerprintPrefix: dto.deviceFingerprint.slice(0, 12),
          credentialId,
          credentialGeneration: terminal.credentialGeneration,
          credentialExpiresAt: expiresAt.toISOString(),
        },
      })
      return terminal
    })

    this.logger.log(`bind-code exchange: terminalId=${result.id} code=${result.terminalCode}`)
    return {
      terminalId: result.id,
      terminalCode: result.terminalCode,
      terminalToken: agentToken,
      expiresAt: expiresAt.toISOString(),
      credentialId,
      generation: result.credentialGeneration,
    }
  }

  async validateTerminalToken(
    terminalId: string,
    authHeader: string | undefined,
    options: { allowDisabled?: boolean } = {},
  ): Promise<void> {
    const terminal = await this.prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { id: true, agentToken: true, credentialGeneration: true, enabled: true, lifecycleStatus: true },
    })
    if (!terminal) throw new NotFoundException({ error: { code: 'TERMINAL_NOT_REGISTERED', message: '终端未注册' } })
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim()
    if (!token) throw new UnauthorizedException({ error: { code: 'AUTH_TOKEN_INVALID', message: 'agentToken 无效' } })
    if (terminal.lifecycleStatus === 'planned') {
      throw new UnauthorizedException({ error: { code: 'TERMINAL_NOT_ACTIVATED', message: '终端尚未激活' } })
    }
    if (terminal.lifecycleStatus === 'retired') {
      throw new UnauthorizedException({ error: { code: 'TERMINAL_RETIRED', message: '终端已退役' } })
    }
    const isLegacyCarrier = !terminal.agentToken.startsWith(CREDENTIAL_SENTINEL_PREFIX)
    if (isLegacyCarrier && !constantTimeEquals(token, terminal.agentToken)) {
      throw new UnauthorizedException({ error: { code: 'AUTH_TOKEN_INVALID', message: 'agentToken 无效' } })
    }
    const credential = await this.prisma.terminalCredential.findUnique({
      where: { tokenHash: hashAgentToken(token) },
      select: { terminalId: true, generation: true, expiresAt: true, revokedAt: true },
    })
    if (credential) {
      if (credential.terminalId !== terminal.id || credential.generation !== terminal.credentialGeneration) {
        throw new UnauthorizedException({ error: { code: 'AUTH_TOKEN_INVALID', message: 'agentToken 无效' } })
      }
      if (credential.revokedAt) throw new UnauthorizedException({ error: { code: 'AUTH_TOKEN_REVOKED', message: '设备凭证已吊销' } })
      if (credential.expiresAt <= new Date()) throw new UnauthorizedException({ error: { code: 'AUTH_TOKEN_EXPIRED', message: '设备凭证已过期' } })
    } else if (!isLegacyCarrier) {
      throw new UnauthorizedException({ error: { code: 'AUTH_TOKEN_INVALID', message: 'agentToken 无效' } })
    }
    if (!options.allowDisabled && !terminal.enabled) {
      throw new ForbiddenException({ error: { code: 'TERMINAL_DISABLED', message: '终端已停用' } })
    }
  }

  async persistIssuedCredential(
    tx: PrismaTransactionClient,
    args: {
      credentialId: string
      terminalId: string
      token: string
      generation: number
      issueSource: CredentialIssueSource
      expiresAt: Date
    },
  ): Promise<void> {
    const now = new Date()
    await tx.terminalCredential.updateMany({
      where: { terminalId: args.terminalId, revokedAt: null },
      data: { revokedAt: now },
    })
    await tx.terminalCredential.create({
      data: {
        id: args.credentialId,
        terminalId: args.terminalId,
        tokenHash: hashAgentToken(args.token),
        generation: args.generation,
        issueSource: args.issueSource,
        expiresAt: args.expiresAt,
      },
    })
  }

  async emergencyRevoke(
    terminalRef: string,
    auditContext: TerminalBindCodeAuditContext & { reason: string },
    expected: {
      expectedStatus: 'commissioning' | 'active' | 'maintenance' | 'suspended'
      expectedVersion: number
      expectedCredentialGeneration: number
      confirmationText: string
    },
  ): Promise<EmergencyCredentialRevokeResult> {
    const normalizedReason = auditContext.reason.trim()
    if (normalizedReason.length < 8 || normalizedReason.length > 500) {
      throw new BadRequestException({
        error: { code: 'LIFECYCLE_REASON_INVALID', message: '运维原因须为 8–500 个有效字符' },
      })
    }
    const now = new Date()
    return this.prisma.$transaction(async (tx) => {
      const terminal = await tx.terminal.findFirst({
        where: this.terminalRefWhere(terminalRef),
        select: {
          id: true,
          terminalCode: true,
          lifecycleStatus: true,
          lifecycleVersion: true,
          credentialGeneration: true,
        },
      })
      if (!terminal) throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
      if (terminal.lifecycleStatus === 'retired') {
        throw new BadRequestException({ error: { code: 'TERMINAL_RETIRED', message: '终端已退役' } })
      }
      if (expected.confirmationText !== `吊销 ${terminal.terminalCode}`) {
        throw new BadRequestException({
          error: { code: 'TERMINAL_REVOKE_CONFIRMATION_INVALID', message: '请输入指定文字确认紧急吊销' },
        })
      }
      if (
        terminal.lifecycleStatus !== expected.expectedStatus ||
        terminal.lifecycleVersion !== expected.expectedVersion ||
        terminal.credentialGeneration !== expected.expectedCredentialGeneration
      ) {
        throw new ConflictException({
          error: { code: 'TERMINAL_LIFECYCLE_CONFLICT', message: '终端状态、版本或凭证代次已变化，请刷新后重试' },
        })
      }
      const allowed = ['commissioning', 'active', 'maintenance', 'suspended']
      if (!allowed.includes(terminal.lifecycleStatus)) {
        throw new BadRequestException({
          error: { code: 'TERMINAL_LIFECYCLE_TRANSITION_INVALID', message: '当前状态不能执行应急凭证吊销' },
        })
      }
      const updated = await tx.terminal.updateMany({
        where: {
          id: terminal.id,
          lifecycleStatus: terminal.lifecycleStatus,
          lifecycleVersion: terminal.lifecycleVersion,
          credentialGeneration: terminal.credentialGeneration,
        },
        data: {
          lifecycleStatus: 'suspended',
          lifecycleVersion: { increment: 1 },
          credentialGeneration: { increment: 1 },
          agentToken: `${CREDENTIAL_SENTINEL_PREFIX}revoked$${crypto.randomBytes(32).toString('hex')}`,
        },
      })
      if (updated.count !== 1) {
        throw new ConflictException({
          error: { code: 'TERMINAL_LIFECYCLE_CONFLICT', message: '终端状态或凭证代次已变化，请刷新后重试' },
        })
      }
      const revokedCredentials = await tx.terminalCredential.updateMany({
        where: { terminalId: terminal.id, revokedAt: null },
        data: { revokedAt: now },
      })
      const revokedBindCodes = await tx.terminalBindCode.updateMany({
        where: { terminalId: terminal.id, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      })
      const inFlightTaskCount = await tx.printTask.count({
        where: { terminalId: terminal.id, status: { in: ['claimed', 'printing'] } },
      })
      await this.audit.writeRequired(tx, {
          actorId: auditContext.actorId,
          actorRole: auditContext.actorRole,
          action: 'terminal.credential.emergency_revoke',
          targetType: 'terminal',
          targetId: terminal.terminalCode,
          payload: {
            terminalCode: terminal.terminalCode,
            oldStatus: terminal.lifecycleStatus,
            newStatus: 'suspended',
            oldLifecycleVersion: terminal.lifecycleVersion,
            newLifecycleVersion: terminal.lifecycleVersion + 1,
            oldCredentialGeneration: terminal.credentialGeneration,
            newCredentialGeneration: terminal.credentialGeneration + 1,
            revokedCredentialCount: revokedCredentials.count,
            revokedBindCodeCount: revokedBindCodes.count,
            reason: normalizedReason,
            inFlightTaskCount,
          },
          ipAddress: auditContext.ipAddress ?? null,
          userAgent: auditContext.userAgent ?? null,
          requestId: auditContext.requestId ?? null,
      })
      return {
        terminalId: terminal.id,
        terminalCode: terminal.terminalCode,
        oldStatus: terminal.lifecycleStatus as EmergencyCredentialRevokeResult['oldStatus'],
        newStatus: 'suspended',
        lifecycleVersion: terminal.lifecycleVersion + 1,
        credentialGeneration: terminal.credentialGeneration + 1,
        revokedCredentialCount: revokedCredentials.count,
        revokedBindCodeCount: revokedBindCodes.count,
        inFlightTaskCount,
      }
    })
  }

  private terminalRefWhere(terminalRef: string) {
    return { OR: [{ id: terminalRef }, { terminalCode: terminalRef }] }
  }
}
