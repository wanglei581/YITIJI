// ============================================================
// Terminals Service — Phase 8.2A
//
// Migrated from in-memory store to Prisma + SQLite/PostgreSQL.
// Endpoints:
//   1. register        — POST /auth/terminal/register
//   2. heartbeat       — PUT  /terminals/:terminalId/heartbeat
//   3. claimTasks      — POST /terminals/:terminalId/tasks/claim
//   4. patchTaskStatus — PATCH /print-tasks/:taskId/status
//
// Key invariants:
//   - claim uses $transaction for atomic pending→claimed transition
//   - completed/failed are terminal states: PATCH is idempotent, DB not rewritten
//   - seed task uses upsert so API restart never duplicates it
//   - All timestamps are ISO-8601 strings at the API boundary
// ============================================================

import crypto from 'crypto'
import {
  Injectable,
  OnModuleInit,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { RegisterTerminalDto } from './dto/register-terminal.dto'
import type { HeartbeatDto } from './dto/heartbeat.dto'
import type { ClaimTasksDto } from './dto/claim-tasks.dto'
import type { PatchTaskStatusDto } from './dto/patch-task-status.dto'

// ── Task status type ──────────────────────────────────────────────────────────

type TaskStatus = 'pending' | 'claimed' | 'printing' | 'completed' | 'failed'

const TERMINAL_STATES: TaskStatus[] = ['completed', 'failed']

const VALID_TRANSITIONS: Record<string, TaskStatus[]> = {
  claimed: ['printing', 'failed'],
  printing: ['completed', 'failed'],
}

// ── PrintJobParams ────────────────────────────────────────────────────────────

interface PrintJobParams {
  copies: number
  colorMode: 'black_white' | 'color'
  duplex: 'simplex' | 'duplex_long_edge' | 'duplex_short_edge'
  paperSize: 'A4'
  orientation: 'auto' | 'portrait' | 'landscape'
  quality: 'draft' | 'standard' | 'high'
  scale: 'fit' | 'actual'
  pagesPerSheet: 1 | 2 | 4
  pageRange?: string
}

const DEFAULT_PARAMS: PrintJobParams = {
  copies: 1,
  colorMode: 'black_white',
  duplex: 'simplex',
  paperSize: 'A4',
  orientation: 'auto',
  quality: 'standard',
  scale: 'fit',
  pagesPerSheet: 1,
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
}

// ── Sample files ──────────────────────────────────────────────────────────────

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
export const SAMPLE_VISIBLE_PDF_MD5 = crypto
  .createHash('md5')
  .update(SAMPLE_VISIBLE_PDF)
  .digest('hex')
// 方案②：seed 任务的 fileMd5 字段实际承载 SHA-256，与 Agent 的 SHA-256 校验对齐。
// （此前 Agent 用 md5 比对，seed 用 md5 常量恰好对得上而掩盖了真实上传路径的 sha256/md5 不一致 bug。）
export const SAMPLE_VISIBLE_PDF_SHA256 = crypto
  .createHash('sha256')
  .update(SAMPLE_VISIBLE_PDF)
  .digest('hex')

// ── Admin secret ──────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} environment variable is required`)
  }
  return value
}

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

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class TerminalsService implements OnModuleInit {
  private readonly logger = new Logger(TerminalsService.name)

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Only seed test data in non-production environments.
    // In production this would reset ptask_seed_001 to pending on every deploy,
    // triggering a real print job on the connected kiosk.
    if (process.env['NODE_ENV'] !== 'production') {
      await this.seedPrintTask()
    }

    // Periodically reset expired claims (every 30s)
    const timer = setInterval(() => void this.resetExpiredClaims(), 30_000)
    timer.unref()
  }

  // ── 1. Register ─────────────────────────────────────────────────────────────

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

    const terminal = await this.prisma.terminal.upsert({
      where: { terminalCode: dto.terminalCode },
      update: {
        agentToken,
        deviceFingerprint: dto.deviceFingerprint,
      },
      create: {
        id: `t_${crypto.randomBytes(8).toString('hex')}`,
        terminalCode: dto.terminalCode,
        agentToken,
        deviceFingerprint: dto.deviceFingerprint,
      },
    })

    this.logger.log(`register: terminalId=${terminal.id} code=${dto.terminalCode}`)
    return { terminalId: terminal.id, terminalToken: agentToken, expiresAt }
  }

  // ── 2. Heartbeat ─────────────────────────────────────────────────────────────

  async heartbeat(
    terminalId: string,
    dto: HeartbeatDto,
    authHeader: string | undefined,
  ): Promise<{ acknowledged: true }> {
    await this.findAndValidate(terminalId, authHeader)

    await this.prisma.terminalHeartbeat.create({
      data: {
        terminalId,
        printerStatus: dto.printerStatus ?? null,
        diskFreeGb: dto.diskFreeGB ?? null,
        agentVersion: dto.agentVersion ?? null,
        ipAddress: dto.ipAddress ?? null,
      },
    })

    return { acknowledged: true }
  }

  // ── 3. Claim tasks ───────────────────────────────────────────────────────────

  async claimTasks(
    terminalId: string,
    dto: ClaimTasksDto,
    authHeader: string | undefined,
  ): Promise<ClaimTaskResponse[]> {
    await this.findAndValidate(terminalId, authHeader)

    const claimExpiry = new Date(Date.now() + 5 * 60 * 1000)
    const limit = Math.min(dto.maxTasks, 1) // Phase 8.2A: max 1 per cycle

    const results: ClaimTaskResponse[] = []

    // Atomic claim: find first pending task and claim it in a transaction
    for (let i = 0; i < limit; i++) {
      const claimed = await this.prisma.$transaction(async (tx) => {
        const task = await tx.printTask.findFirst({
          where: { status: 'pending' },
          orderBy: { createdAt: 'asc' },
        })
        if (!task) return null

        // status guard in WHERE prevents double-claim under concurrent requests
        // (PostgreSQL READ COMMITTED: two transactions could both see the same
        // pending task in findFirst; the guard ensures only one update wins)
        return tx.printTask.update({
          where: { id: task.id, status: 'pending' },
          data: {
            status: 'claimed',
            terminalId,
            claimedAt: new Date(),
            claimExpiry,
          },
        })
      })

      if (!claimed) break

      const params = this.parseParams(claimed.paramsJson)
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
      })
    }

    return results
  }

  // ── 4. Patch task status ─────────────────────────────────────────────────────

  async patchTaskStatus(
    taskId: string,
    dto: PatchTaskStatusDto,
    authHeader: string | undefined,
    terminalIdHeader: string | undefined,
  ): Promise<{ acknowledged: true }> {
    await this.validateAnyTerminalToken(authHeader, terminalIdHeader)

    // Ownership check: verify the terminal making the request owns this task
    const terminalId = terminalIdHeader
    if (terminalId) {
      const task = await this.prisma.printTask.findUnique({ where: { id: taskId } })
      if (task && task.terminalId && task.terminalId !== terminalId) {
        throw new BadRequestException({
          error: {
            code: 'TASK_NOT_OWNED',
            message: `任务 ${taskId} 不属于终端 ${terminalId}`,
          },
        })
      }
    }

    // Pre-flight: check task exists (optimistic read outside transaction is fine
    // here — the transaction below re-validates with a status guard in WHERE)
    const preCheck = await this.prisma.printTask.findUnique({ where: { id: taskId } })
    if (!preCheck) {
      throw new NotFoundException({
        error: { code: 'PRINT_TASK_NOT_FOUND', message: `任务 ${taskId} 不存在` },
      })
    }

    // Terminal states: idempotent — return early without touching DB
    if (TERMINAL_STATES.includes(preCheck.status as TaskStatus)) {
      return { acknowledged: true }
    }

    // Validate the requested transition is legal from the current status
    const allowed = VALID_TRANSITIONS[preCheck.status]
    if (!allowed || !allowed.includes(dto.status as TaskStatus)) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message: `任务当前状态 ${preCheck.status} 不允许转换为 ${dto.status}`,
        },
      })
    }

    const isTerminal = TERMINAL_STATES.includes(dto.status as TaskStatus)

    // Transaction with a status guard in WHERE to prevent time-of-check races:
    // if a concurrent request already changed the status, the update matches
    // 0 rows (Prisma throws P2025) — we catch that and return idempotent ack.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.prisma.$transaction as any)(async (tx: any) => {
      const updated = await tx.printTask.updateMany({
        where: { id: taskId, status: preCheck.status },
        data: {
          status: dto.status,
          errorCode: dto.errorCode ?? null,
          errorMessage: dto.errorMessage ?? null,
          completedAt: isTerminal ? new Date() : null,
        },
      })
      // If another request won the race, skip the log (0 rows updated)
      if (updated.count > 0) {
        await tx.printTaskStatusLog.create({
          data: {
            taskId,
            fromStatus: preCheck.status,
            toStatus: dto.status,
            errorCode: dto.errorCode ?? null,
          },
        })
      }
    })

    return { acknowledged: true }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async findAndValidate(
    terminalId: string,
    authHeader: string | undefined,
  ): Promise<void> {
    const terminal = await this.prisma.terminal.findUnique({ where: { id: terminalId } })
    if (!terminal) {
      throw new NotFoundException({
        error: { code: 'TERMINAL_NOT_REGISTERED', message: '终端未注册' },
      })
    }
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim()
    if (!token || token !== terminal.agentToken) {
      throw new UnauthorizedException({
        error: { code: 'AUTH_TOKEN_INVALID', message: 'agentToken 无效' },
      })
    }
  }

  private async validateAnyTerminalToken(
    authHeader: string | undefined,
    terminalIdHeader: string | undefined,
  ): Promise<void> {
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      throw new UnauthorizedException({
        error: { code: 'AUTH_TOKEN_INVALID', message: '缺少 Authorization header' },
      })
    }
    if (terminalIdHeader) {
      await this.findAndValidate(terminalIdHeader, authHeader)
      return
    }
    // Fallback: find any terminal with matching token
    const found = await this.prisma.terminal.findFirst({ where: { agentToken: token } })
    if (!found) {
      throw new UnauthorizedException({
        error: { code: 'AUTH_TOKEN_INVALID', message: 'agentToken 无效' },
      })
    }
  }

  private async resetExpiredClaims(): Promise<void> {
    const now = new Date()

    // Reset claimed tasks whose lease has expired
    const claimedCount = await this.prisma.printTask.updateMany({
      where: { status: 'claimed', claimExpiry: { lt: now } },
      data: { status: 'pending', terminalId: null, claimedAt: null, claimExpiry: null },
    })

    // Reset printing tasks stuck for more than 10 minutes (agent crash recovery).
    // claimedAt is the best proxy — a task transitions from claimed to printing
    // shortly after being claimed, so claimedAt is a conservative lower bound.
    const printingTimeout = new Date(now.getTime() - 10 * 60 * 1000)
    const printingCount = await this.prisma.printTask.updateMany({
      where: { status: 'printing', claimedAt: { lt: printingTimeout } },
      data: { status: 'pending', terminalId: null, claimedAt: null, claimExpiry: null },
    })

    const total = claimedCount.count + printingCount.count
    if (total > 0) {
      this.logger.log(
        `resetExpiredClaims: reset ${claimedCount.count} claimed + ${printingCount.count} stuck-printing task(s) to pending`,
      )
    }
  }

  private async seedPrintTask(): Promise<void> {
    // On restart, reset the seed task to pending so it can be claimed again
    // for end-to-end testing. update:{} would leave a completed/failed task
    // permanently un-claimable — reset status explicitly instead.
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
        // 方案②：字段名 fileMd5，内容为 SHA-256（与 Agent 校验一致）。
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

  // ── Admin helpers ────────────────────────────────────────────────────────────

  listTerminals() {
    return this.prisma.terminal.findMany({ orderBy: { registeredAt: 'desc' } })
  }

  listPrintTasks() {
    return this.prisma.printTask.findMany({ orderBy: { createdAt: 'desc' } })
  }

  async getTerminalPrinterStatus(terminalId: string): Promise<{
    found: boolean
    printerStatus: string | null
    lastSeenAt: string | null
    isOnline: boolean
  }> {
    const terminal = await this.prisma.terminal.findUnique({
      where: { id: terminalId },
      include: {
        heartbeats: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { printerStatus: true, createdAt: true },
        },
      },
    })
    if (!terminal) {
      return { found: false, printerStatus: null, lastSeenAt: null, isOnline: false }
    }
    const latest = terminal.heartbeats[0]
    const lastSeenAt = latest?.createdAt?.toISOString() ?? null
    // 最近 5 分钟内有心跳视为在线
    const isOnline = latest
      ? Date.now() - latest.createdAt.getTime() < 5 * 60 * 1000
      : false
    return {
      found: true,
      printerStatus: latest?.printerStatus ?? null,
      lastSeenAt,
      isOnline,
    }
  }
}
