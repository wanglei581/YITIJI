// ============================================================
// TerminalAgentService — Agent 生命周期
//
// 职责：register / heartbeat / claimTasks / patchTaskStatus /
//        validateTerminalToken + 所有核心私有帮助方法。
// Admin 管理端逻辑见 TerminalAdminService。
// ============================================================

import crypto from 'crypto'
import {
  Injectable,
  OnModuleInit,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { RegisterTerminalDto } from './dto/register-terminal.dto'
import type { HeartbeatDto } from './dto/heartbeat.dto'
import type { ClaimTasksDto } from './dto/claim-tasks.dto'
import type { PatchTaskStatusDto } from './dto/patch-task-status.dto'
import type { ExchangeTerminalBindCodeDto } from './dto/exchange-terminal-bind-code.dto'
import {
  cleanNullable,
  normalizeMacAddress,
  tryNormalizeMacAddress,
  isMacUniqueConstraintError,
  exceptionErrorCode,
  hashBindCode,
  constantTimeEquals,
  makeBindCode,
  requirePaidBeforeClaim,
  shouldSeedTestPrintTask,
  normalizeHeartbeatStatus,
  inferMimeFromFileName,
  requireEnv,
  DEFAULT_BIND_CODE_TTL_MINUTES,
  DEFAULT_PARAMS,
  type PrintJobParams,
} from './terminal-utils'

// ── Task status type ───────────────────────────────────────────────────────────

type TaskStatus = 'pending' | 'claimed' | 'printing' | 'completed' | 'failed' | 'cancelled'

const TERMINAL_STATES: TaskStatus[] = ['completed', 'failed', 'cancelled']
const REFUND_PAY_STATUSES = ['refunding', 'partial_refunded', 'refunded']

class PrintTaskClaimRaceError extends Error {}

const VALID_TRANSITIONS: Record<string, TaskStatus[]> = {
  claimed: ['printing', 'failed'],
  printing: ['completed', 'failed'],
}

// ── ClaimTask response (matches Agent-side ClaimTask type) ────────────────────

export interface ClaimTaskResponse {
  taskId: string
  type: 'print'
  fileUrl: string
  fileMd5: string
  actionToken: string
  claimedBy: string
  claimExpiresAt: string
  params: PrintJobParams
  createdAt: string
  // 契约 C2：原始文件名与推断的 MIME。Agent 据此推断打印扩展名。
  fileName?: string
  mimeType?: string
}

// ── Bind code response types ───────────────────────────────────────────────────

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
}

// ── Sample files ───────────────────────────────────────────────────────────────

export const SAMPLE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
export const SAMPLE_PNG_MD5 = crypto.createHash('md5').update(SAMPLE_PNG).digest('hex')

function createVisibleSamplePdf(): Buffer {
  const stream = [
    'q',
    '0.90 0.96 1 rg',
    '50 520 495 190 re f',
    '0 0 0 RG',
    '2 w',
    '50 520 495 190 re S',
    'BT',
    '/F1 28 Tf',
    '0 0 0 rg',
    '72 660 Td',
    '(AI Job Print Terminal) Tj',
    '0 -42 Td',
    '/F1 18 Tf',
    '(Phase 8.2A Prisma persistence test) Tj',
    '0 -34 Td',
    '(Task: ptask_seed_001) Tj',
    '0 -34 Td',
    '(If this page prints, the full chain works.) Tj',
    'ET',
    '0.05 0.42 0.75 rg',
    '72 560 420 18 re f',
    'Q',
  ].join('\n')

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((object) => {
    const offset = Buffer.byteLength(pdf, 'ascii')
    pdf += object
    return offset
  })
  const xrefOffset = Buffer.byteLength(pdf, 'ascii')
  pdf += 'xref\n0 6\n0000000000 65535 f \n'
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'ascii')
}

export const SAMPLE_VISIBLE_PDF = createVisibleSamplePdf()
export const SAMPLE_VISIBLE_PDF_MD5 = crypto.createHash('md5').update(SAMPLE_VISIBLE_PDF).digest('hex')
// 方案②：seed 任务的 fileMd5 字段实际承载 SHA-256，与 Agent 的 SHA-256 校验对齐。
export const SAMPLE_VISIBLE_PDF_SHA256 = crypto.createHash('sha256').update(SAMPLE_VISIBLE_PDF).digest('hex')

// ── Admin secret + action token ────────────────────────────────────────────────

const ADMIN_SECRET = requireEnv('TERMINAL_ADMIN_SECRET')
const ACTION_TOKEN_SECRET = requireEnv('TERMINAL_ACTION_TOKEN_SECRET')

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function createActionToken(taskId: string, terminalId: string, expiresAt: Date): string {
  const payload = {
    taskId,
    terminalId,
    action: 'print',
    expiresAt: expiresAt.toISOString(),
    nonce: crypto.randomBytes(16).toString('hex'),
  }
  const encodedPayload = base64UrlJson(payload)
  const signature = crypto
    .createHmac('sha256', ACTION_TOKEN_SECRET)
    .update(encodedPayload)
    .digest('base64url')
  return `${encodedPayload}.${signature}`
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class TerminalAgentService implements OnModuleInit {
  private readonly logger = new Logger(TerminalAgentService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (shouldSeedTestPrintTask()) {
      await this.seedPrintTask()
    }
    const timer = setInterval(() => void this.resetExpiredClaims(), 30_000)
    timer.unref()
  }

  // ── 1. Register ──────────────────────────────────────────────────────────────

  async register(dto: RegisterTerminalDto): Promise<{
    terminalId: string
    terminalToken: string
    expiresAt: string
  }> {
    if (dto.adminSecret !== ADMIN_SECRET) {
      throw new UnauthorizedException({
        error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'adminSecret 无效' },
      })
    }

    const agentToken = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()
    const macAddress = normalizeMacAddress(dto.macAddress)
    if (macAddress) {
      await this.assertMacAvailable(macAddress, dto.terminalCode)
    }

    const terminal = await this.writeWithMacConflictMapping(() =>
      this.prisma.terminal.upsert({
        where: { terminalCode: dto.terminalCode },
        update: {
          agentToken,
          deviceFingerprint: dto.deviceFingerprint,
          displayName: cleanNullable(dto.displayName),
          macAddress,
          locationLabel: cleanNullable(dto.locationLabel),
        },
        create: {
          id: `t_${crypto.randomBytes(8).toString('hex')}`,
          terminalCode: dto.terminalCode,
          agentToken,
          deviceFingerprint: dto.deviceFingerprint,
          displayName: cleanNullable(dto.displayName),
          macAddress,
          locationLabel: cleanNullable(dto.locationLabel),
        },
      }),
    ) as { id: string; terminalCode: string }

    this.logger.log(`register: terminalId=${terminal.id} code=${dto.terminalCode}`)
    return { terminalId: terminal.id, terminalToken: agentToken, expiresAt }
  }

  /**
   * Admin 生成一次性绑定码。明文 bindCode 只在本响应返回一次；DB 仅保存 hash。
   */
  async createBindCode(
    terminalRef: string,
    actorId: string | null,
    ttlMinutes = DEFAULT_BIND_CODE_TTL_MINUTES,
  ): Promise<TerminalBindCodeCreated> {
    const terminal = await this.prisma.terminal.findFirst({
      where: this.terminalRefWhere(terminalRef),
      select: { id: true, terminalCode: true, enabled: true },
    })
    if (!terminal) {
      throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
    }
    if (!terminal.enabled) {
      throw new BadRequestException({ error: { code: 'TERMINAL_DISABLED', message: '终端已停用，不能生成绑定码' } })
    }

    const ttl = Math.min(60, Math.max(1, Math.round(ttlMinutes || DEFAULT_BIND_CODE_TTL_MINUTES)))
    const now = new Date()
    const expiresAt = new Date(Date.now() + ttl * 60 * 1000)

    for (let attempt = 0; attempt < 3; attempt++) {
      const bindCode = makeBindCode()
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.terminalBindCode.updateMany({
            where: {
              terminalId: terminal.id,
              usedAt: null,
              revokedAt: null,
              expiresAt: { gt: now },
            },
            data: { revokedAt: now },
          })
          await tx.terminalBindCode.create({
            data: {
              terminalId: terminal.id,
              terminalCode: terminal.terminalCode,
              codeHash: hashBindCode(bindCode),
              createdBy: actorId,
              expiresAt,
            },
          })
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

  /** Agent 用一次性绑定码换取 terminalToken。成功后旧 token 立即失效。 */
  async exchangeBindCode(dto: ExchangeTerminalBindCodeDto): Promise<TerminalBindCodeExchangeResult> {
    const codeHash = hashBindCode(dto.bindCode)
    const now = new Date()
    const agentToken = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()
    const macAddress = normalizeMacAddress(dto.macAddress)
    const locationLabel = cleanNullable(dto.locationLabel)
    const displayName = cleanNullable(dto.displayName)

    const result = await this.prisma.$transaction(async (tx) => {
      const bind = await tx.terminalBindCode.findUnique({
        where: { codeHash },
        include: { terminal: { select: { id: true, terminalCode: true, enabled: true } } },
      })
      if (!bind) {
        throw new UnauthorizedException({ error: { code: 'BIND_CODE_INVALID', message: '绑定码无效' } })
      }
      if (bind.revokedAt) {
        throw new UnauthorizedException({ error: { code: 'BIND_CODE_REVOKED', message: '绑定码已撤销' } })
      }
      if (bind.usedAt) {
        throw new UnauthorizedException({ error: { code: 'BIND_CODE_USED', message: '绑定码已使用' } })
      }
      if (bind.expiresAt <= now) {
        throw new UnauthorizedException({ error: { code: 'BIND_CODE_EXPIRED', message: '绑定码已过期' } })
      }
      if (!bind.terminal.enabled) {
        throw new ForbiddenException({ error: { code: 'TERMINAL_DISABLED', message: '终端已停用，不能绑定' } })
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
      if (consumed.count !== 1) {
        throw new UnauthorizedException({ error: { code: 'BIND_CODE_USED', message: '绑定码已使用' } })
      }
      const terminal = await tx.terminal.update({
        where: { id: bind.terminalId },
        data: {
          agentToken,
          deviceFingerprint: dto.deviceFingerprint,
          ...(displayName !== undefined ? { displayName } : {}),
          ...(macAddress !== undefined ? { macAddress } : {}),
          ...(locationLabel !== undefined ? { locationLabel } : {}),
        },
        select: { id: true, terminalCode: true },
      })
      return terminal
    })

    this.logger.log(`bind-code exchange: terminalId=${result.id} code=${result.terminalCode}`)
    await this.audit.write({
      actorId: null,
      actorRole: 'terminal-agent',
      action: 'terminal.bind_code.exchange',
      targetType: 'terminal',
      targetId: result.terminalCode,
      payload: {
        terminalCode: result.terminalCode,
        displayName,
        macAddress,
        locationLabel,
        agentVersion: cleanNullable(dto.agentVersion) ?? null,
        deviceFingerprintPrefix: dto.deviceFingerprint.slice(0, 12),
      },
    })
    return {
      terminalId: result.id,
      terminalCode: result.terminalCode,
      terminalToken: agentToken,
      expiresAt,
    }
  }

  // ── 2. Heartbeat ─────────────────────────────────────────────────────────────

  async heartbeat(
    terminalId: string,
    dto: HeartbeatDto,
    authHeader: string | undefined,
  ): Promise<{ acknowledged: true }> {
    await this.findAndValidate(terminalId, authHeader, { allowDisabled: true })
    const profilePatch = await this.buildDeviceProfilePatch(dto, terminalId)
    const lastSeenAt = new Date()

    try {
      await this.writeWithMacConflictMapping(() =>
        this.prisma.terminal.update({
          where: { id: terminalId },
          data: { ...profilePatch, lastSeenAt },
        }),
      )
    } catch (error) {
      if (profilePatch.macAddress !== undefined && exceptionErrorCode(error) === 'MAC_ALREADY_BOUND') {
        const safeProfilePatch = {
          displayName: profilePatch.displayName,
          locationLabel: profilePatch.locationLabel,
        }
        this.logger.warn(`heartbeat ignored duplicated MAC address from terminal ${terminalId}`)
        await this.prisma.terminal.update({
          where: { id: terminalId },
          data: { ...safeProfilePatch, lastSeenAt },
        })
      } else {
        throw error
      }
    }

    await this.prisma.terminalHeartbeat.create({
      data: {
        terminalId,
        status: normalizeHeartbeatStatus(dto.status),
        printerStatus: dto.printerStatus ?? null,
        localTaskDatabaseAvailable: dto.localTaskDatabaseAvailable ?? null,
        diskFreeGb: dto.diskFreeGB ?? null,
        agentVersion: dto.agentVersion ?? null,
        ipAddress: dto.ipAddress ?? null,
      },
    })

    return { acknowledged: true }
  }

  // ── 3. Claim tasks ────────────────────────────────────────────────────────────

  async claimTasks(
    terminalId: string,
    dto: ClaimTasksDto,
    authHeader: string | undefined,
  ): Promise<ClaimTaskResponse[]> {
    await this.findAndValidate(terminalId, authHeader)
    const canClaim = await this.canTerminalClaimTasks(terminalId)
    if (!canClaim) {
      this.logger.warn(`claimTasks: terminal ${terminalId} is agent_degraded/local DB unavailable; returning no tasks`)
      return []
    }

    const claimExpiry = new Date(Date.now() + 5 * 60 * 1000)
    const limit = Math.min(dto.maxTasks, 1) // Phase 8.2A: max 1 per cycle

    const results: ClaimTaskResponse[] = []

    const paidGate = requirePaidBeforeClaim()
    const claimableWhere = paidGate
      ? {
          status: 'pending' as const,
          terminalId,
          OR: [{ order: { is: null } }, { order: { is: { payStatus: 'paid', taskStatus: 'pending' } } }],
        }
      : {
          status: 'pending' as const,
          terminalId,
          OR: [
            { order: { is: null } },
            { order: { is: { payStatus: { notIn: REFUND_PAY_STATUSES }, taskStatus: 'pending' } } },
          ],
        }

    for (let i = 0; i < limit; i++) {
      let claimed
      try {
        claimed = await this.prisma.$transaction(async (tx) => {
          const task = await tx.printTask.findFirst({
            where: claimableWhere,
            orderBy: { createdAt: 'asc' },
          })
          if (!task) return null

          const order = await tx.order.findFirst({ where: { printTaskId: task.id }, select: { id: true } })
          if (order) {
            const claimedOrder = await tx.order.updateMany({
              where: paidGate
                ? { id: order.id, taskStatus: 'pending', payStatus: 'paid' }
                : { id: order.id, taskStatus: 'pending', payStatus: { notIn: REFUND_PAY_STATUSES } },
              data: { taskStatus: 'claimed', terminalId },
            })
            if (claimedOrder.count !== 1) return null
          }

          const claimedAt = new Date()
          const claimedTask = await tx.printTask.updateMany({
            where: { id: task.id, status: 'pending', terminalId },
            data: { status: 'claimed', claimedAt, claimExpiry },
          })
          if (claimedTask.count !== 1) throw new PrintTaskClaimRaceError()
          return tx.printTask.findUnique({ where: { id: task.id } })
        })
      } catch (error) {
        if (error instanceof PrintTaskClaimRaceError) claimed = null
        else throw error
      }

      if (!claimed) break

      const params = this.parseParams(claimed.paramsJson)
      const fileName = this.extractFileName(claimed.paramsJson)
      const mimeType = inferMimeFromFileName(fileName)
      results.push({
        taskId: claimed.id,
        type: 'print',
        fileUrl: claimed.fileUrl,
        fileMd5: claimed.fileMd5,
        actionToken: createActionToken(claimed.id, terminalId, claimExpiry),
        claimedBy: terminalId,
        claimExpiresAt: claimExpiry.toISOString(),
        params,
        createdAt: claimed.createdAt.toISOString(),
        ...(fileName ? { fileName } : {}),
        ...(mimeType ? { mimeType } : {}),
      })
    }

    return results
  }

  // ── 4. Patch task status ──────────────────────────────────────────────────────

  async patchTaskStatus(
    taskId: string,
    dto: PatchTaskStatusDto,
    authHeader: string | undefined,
    terminalIdHeader: string | undefined,
  ): Promise<{ acknowledged: true }> {
    if (!terminalIdHeader?.trim()) {
      throw new BadRequestException({
        error: { code: 'TASK_TERMINAL_MISSING', message: '状态回传必须携带 x-terminal-id header' },
      })
    }
    const terminalId = terminalIdHeader.trim()
    await this.findAndValidate(terminalIdHeader, authHeader)

    const preCheck = await this.prisma.printTask.findUnique({ where: { id: taskId } })
    if (!preCheck) {
      throw new NotFoundException({ error: { code: 'PRINT_TASK_NOT_FOUND', message: `任务 ${taskId} 不存在` } })
    }
    if (!preCheck.terminalId) {
      throw new BadRequestException({ error: { code: 'TASK_TERMINAL_MISSING', message: `任务 ${taskId} 未绑定目标终端` } })
    }
    if (preCheck.terminalId !== terminalId) {
      throw new BadRequestException({ error: { code: 'TASK_NOT_OWNED', message: `任务 ${taskId} 不属于终端 ${terminalId}` } })
    }

    if (TERMINAL_STATES.includes(preCheck.status as TaskStatus)) {
      return { acknowledged: true }
    }

    const allowed = VALID_TRANSITIONS[preCheck.status]
    if (!allowed || !allowed.includes(dto.status as TaskStatus)) {
      throw new BadRequestException({
        error: { code: 'INVALID_STATUS_TRANSITION', message: `任务当前状态 ${preCheck.status} 不允许转换为 ${dto.status}` },
      })
    }

    const isTerminal = TERMINAL_STATES.includes(dto.status as TaskStatus)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.prisma.$transaction as any)(async (tx: any) => {
      const updated = await tx.printTask.updateMany({
        where: { id: taskId, status: preCheck.status, terminalId },
        data: {
          status: dto.status,
          errorCode: dto.errorCode ?? null,
          errorMessage: dto.errorMessage ?? null,
          completedAt: isTerminal ? new Date() : null,
        },
      })
      if (updated.count > 0) {
        await tx.printTaskStatusLog.create({
          data: {
            taskId,
            fromStatus: preCheck.status,
            toStatus: dto.status,
            errorCode: dto.errorCode ?? null,
          },
        })
        await tx.order.updateMany({
          where: { printTaskId: taskId },
          data: { taskStatus: dto.status, terminalId },
        })
      }
    })

    return { acknowledged: true }
  }

  async validateTerminalToken(terminalId: string, authHeader: string | undefined): Promise<void> {
    await this.assertAgentAuthorized(terminalId, authHeader)
  }

  /**
   * 供其它模块（如 ScanTasksService）复用的 Agent 鉴权校验。
   */
  async assertAgentAuthorized(
    terminalId: string,
    authHeader: string | undefined,
    options: { allowDisabled?: boolean } = {},
  ): Promise<void> {
    await this.findAndValidate(terminalId, authHeader, options)
  }

  // ── Semi-internal helpers (used by TerminalAdminService) ─────────────────────

  /**
   * Checks that the given MAC is not already bound to a different terminal.
   * @internal — exposed for TerminalAdminService; not part of the public HTTP API.
   */
  async assertMacAvailable(macAddress: string, ownerRef: string): Promise<void> {
    const found = await this.prisma.terminal.findFirst({
      where: { macAddress },
      select: { id: true, terminalCode: true },
    })
    if (found && found.id !== ownerRef && found.terminalCode !== ownerRef) {
      throw new BadRequestException({
        error: { code: 'MAC_ALREADY_BOUND', message: `MAC 地址已绑定到终端 ${found.terminalCode}` },
      })
    }
  }

  /**
   * Wraps a write op and maps Prisma unique-constraint on macAddress to a typed BadRequestException.
   * @internal — exposed for TerminalAdminService.
   */
  async writeWithMacConflictMapping<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write()
    } catch (error) {
      if (isMacUniqueConstraintError(error)) {
        throw new BadRequestException({
          error: { code: 'MAC_ALREADY_BOUND', message: 'MAC 地址已绑定到其它终端' },
        })
      }
      throw error
    }
  }

  /**
   * Returns a Prisma `where` clause matching a terminal by id OR terminalCode.
   * @internal — exposed for TerminalAdminService.
   */
  terminalRefWhere(terminalRef: string) {
    return { OR: [{ id: terminalRef }, { terminalCode: terminalRef }] }
  }

  findTerminalByRef(terminalRef: string) {
    return this.prisma.terminal.findFirst({
      where: this.terminalRefWhere(terminalRef),
      select: { id: true, terminalCode: true, enabled: true, lastSeenAt: true },
    })
  }

  async findSmartCampusConfigByTerminalRef(
    terminalRef: string,
    terminal: Awaited<ReturnType<TerminalAgentService['findTerminalByRef']>>,
  ) {
    const keys = [terminalRef, terminal?.terminalCode, terminal?.id].filter((v): v is string => !!v)
    const configs = await this.prisma.terminalSmartCampusConfig.findMany({
      where: { terminalId: { in: [...new Set(keys)] } },
      orderBy: { updatedAt: 'desc' },
    })
    return configs.sort((a: (typeof configs)[number], b: (typeof configs)[number]) => keys.indexOf(a.terminalId) - keys.indexOf(b.terminalId))[0] ?? null
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private async canTerminalClaimTasks(terminalId: string): Promise<boolean> {
    const latestHeartbeat = await this.prisma.terminalHeartbeat.findFirst({
      where: { terminalId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, localTaskDatabaseAvailable: true },
    })
    if (!latestHeartbeat) return true
    return latestHeartbeat.status !== 'agent_degraded' && latestHeartbeat.localTaskDatabaseAvailable !== false
  }

  private async findAndValidate(
    terminalId: string,
    authHeader: string | undefined,
    options: { allowDisabled?: boolean } = {},
  ): Promise<void> {
    const terminal = await this.prisma.terminal.findUnique({ where: { id: terminalId } })
    if (!terminal) {
      throw new NotFoundException({ error: { code: 'TERMINAL_NOT_REGISTERED', message: '终端未注册' } })
    }
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim()
    if (!token || !constantTimeEquals(token, terminal.agentToken)) {
      throw new UnauthorizedException({ error: { code: 'AUTH_TOKEN_INVALID', message: 'agentToken 无效' } })
    }
    if (!options.allowDisabled && !terminal.enabled) {
      throw new ForbiddenException({ error: { code: 'TERMINAL_DISABLED', message: '终端已停用' } })
    }
  }

  private async buildDeviceProfilePatch(
    dto: Pick<HeartbeatDto, 'displayName' | 'macAddress' | 'locationLabel'>,
    ownerRef: string,
  ): Promise<{ displayName?: string | null; macAddress?: string | null; locationLabel?: string | null }> {
    const data: { displayName?: string | null; macAddress?: string | null; locationLabel?: string | null } = {}
    if (dto.displayName !== undefined) data.displayName = cleanNullable(dto.displayName)
    if (dto.locationLabel !== undefined) data.locationLabel = cleanNullable(dto.locationLabel)
    if (dto.macAddress !== undefined) {
      const cleanedMacAddress = cleanNullable(dto.macAddress)
      if (cleanedMacAddress === null) {
        this.logger.warn(`heartbeat ignored blank MAC address from terminal ${ownerRef}`)
        return data
      }
      const macAddress = tryNormalizeMacAddress(dto.macAddress)
      if (macAddress === undefined && cleanNullable(dto.macAddress) !== undefined) {
        this.logger.warn(`heartbeat ignored invalid MAC address from terminal ${ownerRef}`)
      }
      if (macAddress) {
        try {
          await this.assertMacAvailable(macAddress, ownerRef)
        } catch (error) {
          if (exceptionErrorCode(error) === 'MAC_ALREADY_BOUND') {
            this.logger.warn(`heartbeat ignored duplicated MAC address from terminal ${ownerRef}`)
            return data
          }
          throw error
        }
      }
      data.macAddress = macAddress
    }
    return data
  }

  private async resetExpiredClaims(): Promise<void> {
    const now = new Date()
    const printingTimeout = new Date(now.getTime() - 10 * 60 * 1000)

    const { claimedCount, printingCount } = await this.prisma.$transaction(async (tx) => {
      const expiredClaimed = await tx.printTask.findMany({
        where: { status: 'claimed', claimExpiry: { lt: now } },
        select: { id: true },
      })
      const expiredPrinting = await tx.printTask.findMany({
        where: { status: 'printing', claimedAt: { lt: printingTimeout } },
        select: { id: true },
      })
      const claimedCount = await tx.printTask.updateMany({
        where: { status: 'claimed', claimExpiry: { lt: now } },
        data: { status: 'pending', claimedAt: null, claimExpiry: null },
      })
      const printingCount = await tx.printTask.updateMany({
        where: { status: 'printing', claimedAt: { lt: printingTimeout } },
        data: { status: 'pending', claimedAt: null, claimExpiry: null },
      })
      const resetIds = [...expiredClaimed, ...expiredPrinting].map((task) => task.id)
      if (resetIds.length > 0) {
        await tx.order.updateMany({
          where: {
            printTaskId: { in: resetIds },
            printTask: { is: { status: 'pending' } },
          },
          data: { taskStatus: 'pending' },
        })
      }
      return { claimedCount, printingCount }
    })

    const total = claimedCount.count + printingCount.count
    if (total > 0) {
      this.logger.log(
        `resetExpiredClaims: reset ${claimedCount.count} claimed + ${printingCount.count} stuck-printing task(s) to pending`,
      )
    }
  }

  private async seedPrintTask(): Promise<void> {
    await this.prisma.printTask.upsert({
      where: { id: 'ptask_seed_001' },
      update: {
        status: 'pending',
        terminalId: null,
        claimedAt: null,
        claimExpiry: null,
        completedAt: null,
        errorCode: null,
        errorMessage: null,
      },
      create: {
        id: 'ptask_seed_001',
        fileUrl: '/api/v1/test/sample-visible.pdf',
        fileMd5: SAMPLE_VISIBLE_PDF_SHA256,
        paramsJson: JSON.stringify(DEFAULT_PARAMS),
        status: 'pending',
      },
    })
    this.logger.log('seedPrintTask: ptask_seed_001 reset to pending')
  }

  private parseParams(json: string): PrintJobParams {
    try {
      return JSON.parse(json) as PrintJobParams
    } catch {
      return DEFAULT_PARAMS
    }
  }

  private extractFileName(json: string): string | undefined {
    try {
      const parsed = JSON.parse(json) as { fileName?: unknown }
      return typeof parsed.fileName === 'string' && parsed.fileName.length > 0
        ? parsed.fileName
        : undefined
    } catch {
      return undefined
    }
  }
}
