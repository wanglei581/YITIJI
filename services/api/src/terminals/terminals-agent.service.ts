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
  Optional,
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
  requirePaidBeforeClaim,
  shouldSeedTestPrintTask,
  normalizeHeartbeatStatus,
  inferMimeFromFileName,
  requireEnv,
  DEFAULT_AGENT_CREDENTIAL_TTL_MS,
  makeCredentialId,
  DEFAULT_PARAMS,
  type PrintJobParams,
} from './terminal-utils'
import {
  TerminalCredentialSecurityService,
  type TerminalBindCodeCreated,
  type TerminalBindCodeExchangeResult,
  type TerminalBindCodeAuditContext,
  type EmergencyCredentialRevokeResult,
} from './terminal-credential-security.service'

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

export type { TerminalBindCodeCreated, TerminalBindCodeExchangeResult, EmergencyCredentialRevokeResult } from './terminal-credential-security.service'

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
  private readonly credentialSecurity: TerminalCredentialSecurityService

  constructor(
    private readonly prisma: PrismaService,
    audit: AuditService,
    @Optional() credentialSecurity?: TerminalCredentialSecurityService,
  ) {
    // Nest 运行时使用独立 provider；脚本 fixture 保留两参构造兼容。
    this.credentialSecurity = credentialSecurity ?? new TerminalCredentialSecurityService(prisma, audit)
  }

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
    credentialId: string
    generation: number
  }> {
    if (process.env['TERMINAL_LEGACY_REGISTER_ENABLED'] !== 'true') {
      throw new ForbiddenException({
        error: {
          code: 'TERMINAL_LEGACY_REGISTER_DISABLED',
          message: '共享密钥注册已关闭，请由管理员预创建设备并使用一次性绑定码激活',
        },
      })
    }
    if (dto.adminSecret !== ADMIN_SECRET) {
      throw new UnauthorizedException({
        error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'adminSecret 无效' },
      })
    }

    const agentToken = crypto.randomBytes(32).toString('hex')
    const credentialId = makeCredentialId()
    const expiresAt = new Date(Date.now() + DEFAULT_AGENT_CREDENTIAL_TTL_MS)
    const macAddress = normalizeMacAddress(dto.macAddress)
    if (macAddress) {
      await this.assertMacAvailable(macAddress, dto.terminalCode)
    }

    const existing = await this.prisma.terminal.findUnique({
      where: { terminalCode: dto.terminalCode },
      select: { lifecycleStatus: true },
    })
    if (existing?.lifecycleStatus === 'planned') {
      throw new ForbiddenException({
        error: { code: 'TERMINAL_BIND_CODE_REQUIRED', message: '该终端已由管理员预创建，必须使用一次性绑定码激活' },
      })
    }
    const terminal = await this.writeWithMacConflictMapping(() => this.prisma.$transaction(async (tx) => {
      const current = await tx.terminal.findUnique({
        where: { terminalCode: dto.terminalCode },
        select: { lifecycleStatus: true },
      })
      if (current?.lifecycleStatus === 'planned') {
        throw new ForbiddenException({
          error: { code: 'TERMINAL_BIND_CODE_REQUIRED', message: '该终端已由管理员预创建，必须使用一次性绑定码激活' },
        })
      }
      const row = await tx.terminal.upsert({
        where: { terminalCode: dto.terminalCode },
        update: {
          agentToken,
          credentialGeneration: { increment: 1 },
          deviceFingerprint: dto.deviceFingerprint,
          displayName: cleanNullable(dto.displayName),
          macAddress,
          locationLabel: cleanNullable(dto.locationLabel),
          lifecycleStatus: 'active',
        },
        create: {
          id: `t_${crypto.randomBytes(8).toString('hex')}`,
          terminalCode: dto.terminalCode,
          agentToken,
          credentialGeneration: 1,
          deviceFingerprint: dto.deviceFingerprint,
          displayName: cleanNullable(dto.displayName),
          macAddress,
          locationLabel: cleanNullable(dto.locationLabel),
          lifecycleStatus: 'active',
        },
        select: { id: true, terminalCode: true, credentialGeneration: true },
      })
      await this.credentialSecurity.persistIssuedCredential(tx, {
        credentialId,
        terminalId: row.id,
        token: agentToken,
        generation: row.credentialGeneration,
        issueSource: 'legacy_register',
        expiresAt,
      })
      return row
    }))

    this.logger.log(`register: terminalId=${terminal.id} code=${dto.terminalCode}`)
    return {
      terminalId: terminal.id,
      terminalToken: agentToken,
      expiresAt: expiresAt.toISOString(),
      credentialId,
      generation: terminal.credentialGeneration,
    }
  }

  /**
   * Admin 生成一次性绑定码。明文 bindCode 只在本响应返回一次；DB 仅保存 hash。
   */
  async createBindCode(
    terminalRef: string,
    actorId: string | null,
    ttlMinutes?: number,
    auditContext?: TerminalBindCodeAuditContext,
  ): Promise<TerminalBindCodeCreated> {
    return this.credentialSecurity.createBindCode(terminalRef, actorId, ttlMinutes, auditContext)
  }

  /** Agent 用一次性绑定码换取 terminalToken。成功后旧 token 立即失效。 */
  async exchangeBindCode(dto: ExchangeTerminalBindCodeDto): Promise<TerminalBindCodeExchangeResult> {
    return this.credentialSecurity.exchangeBindCode(dto)
  }

  emergencyRevokeCredentials(
    terminalRef: string,
    auditContext: Parameters<TerminalCredentialSecurityService['emergencyRevoke']>[1],
    expected: Parameters<TerminalCredentialSecurityService['emergencyRevoke']>[2],
  ): Promise<EmergencyCredentialRevokeResult> {
    return this.credentialSecurity.emergencyRevoke(terminalRef, auditContext, expected)
  }

  // ── 2. Heartbeat ─────────────────────────────────────────────────────────────

  async heartbeat(
    terminalId: string,
    dto: HeartbeatDto,
    authHeader: string | undefined,
  ): Promise<{ acknowledged: true }> {
    await this.credentialSecurity.validateTerminalToken(terminalId, authHeader, { allowDisabled: true })
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

    await this.prisma.terminal.updateMany({
      where: { id: terminalId, lifecycleStatus: 'commissioning' },
      data: { lifecycleStatus: 'active' },
    })

    return { acknowledged: true }
  }

  // ── 3. Claim tasks ────────────────────────────────────────────────────────────

  async claimTasks(
    terminalId: string,
    dto: ClaimTasksDto,
    authHeader: string | undefined,
  ): Promise<ClaimTaskResponse[]> {
    await this.credentialSecurity.validateTerminalToken(terminalId, authHeader)
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
          // No-op CAS 同时是与 lifecycle 切换共用的行锁：只有 active 可以领取新任务。
          const activeLock = await tx.terminal.updateMany({
            where: { id: terminalId, enabled: true, lifecycleStatus: 'active' },
            data: { lifecycleStatus: 'active' },
          })
          if (activeLock.count !== 1) return null
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
    await this.credentialSecurity.validateTerminalToken(terminalIdHeader, authHeader)

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
    await this.credentialSecurity.validateTerminalToken(terminalId, authHeader)
  }

  /**
   * 供其它模块（如 ScanTasksService）复用的 Agent 鉴权校验。
   */
  async assertAgentAuthorized(
    terminalId: string,
    authHeader: string | undefined,
    options: { allowDisabled?: boolean } = {},
  ): Promise<void> {
    await this.credentialSecurity.validateTerminalToken(terminalId, authHeader, options)
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

  async resetExpiredClaims(): Promise<void> {
    const now = new Date()
    const printingTimeout = new Date(now.getTime() - 10 * 60 * 1000)

    const { claimedCount, printingCount } = await this.prisma.$transaction(async (tx) => {
      const candidates = await tx.printTask.findMany({
        where: {
          OR: [
            { status: 'claimed', claimExpiry: { lt: now } },
            { status: 'printing', updatedAt: { lt: printingTimeout } },
          ],
        },
        select: { id: true, status: true, terminalId: true },
      })
      let claimedCount = 0
      let printingCount = 0
      for (const task of candidates) {
        const timeoutWhere = task.status === 'claimed'
          ? { id: task.id, status: 'claimed', claimExpiry: { lt: now } }
          : { id: task.id, status: 'printing', updatedAt: { lt: printingTimeout } }
        const updated = await tx.printTask.updateMany({
          where: timeoutWhere,
          data: {
            status: 'failed',
            completedAt: now,
            errorCode: 'PRINT_JOB_UNCONFIRMED',
            errorMessage: '打印作业超时且未确认出纸，需要工作人员核查，禁止自动重派',
          },
        })
        if (updated.count !== 1) continue
        if (task.status === 'claimed') claimedCount += 1
        else printingCount += 1
        await tx.printTaskStatusLog.create({
          data: { taskId: task.id, fromStatus: task.status, toStatus: 'failed', errorCode: 'PRINT_JOB_UNCONFIRMED' },
        })
        await tx.order.updateMany({
          where: { printTaskId: task.id, taskStatus: task.status },
          data: { taskStatus: 'failed', terminalId: task.terminalId },
        })
        await tx.auditLog.create({
          data: {
            actorId: null,
            actorRole: 'system',
            action: 'print_job.timeout_unconfirmed',
            targetType: 'print_task',
            targetId: task.id,
            payloadJson: JSON.stringify({
              fromStatus: task.status,
              toStatus: 'failed',
              errorCode: 'PRINT_JOB_UNCONFIRMED',
              terminalId: task.terminalId,
              autoRequeued: false,
            }),
          },
        })
      }
      return { claimedCount, printingCount }
    })

    const total = claimedCount + printingCount
    if (total > 0) {
      this.logger.log(
        `resetExpiredClaims: failed ${claimedCount} expired claimed + ${printingCount} stuck-printing task(s) as PRINT_JOB_UNCONFIRMED`,
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
