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
  // 契约 C2：原始文件名（create-print-job 时落进 paramsJson.fileName）与推断的 MIME。
  // Agent 据此推断打印扩展名（mimeType → fileName 后缀 → URL 后缀 → .pdf），
  // 修复签名 URL 无扩展名导致 JPEG/PNG 被当 PDF 打印必失败的 HIGH-1。
  fileName?: string
  mimeType?: string
}

// fileName 后缀 → MIME（仅覆盖 Agent print() 支持的可打印类型，其余留空）。
const EXT_TO_MIME: Record<string, string> = {
  '.pdf':  'application/pdf',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.bmp':  'image/bmp',
  '.tif':  'image/tiff',
  '.tiff': 'image/tiff',
}

/** 由原始文件名后缀推断 MIME（无法判断时返回 undefined，交由 Agent 回退）。 */
function inferMimeFromFileName(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return undefined
  const ext = fileName.slice(dot).toLowerCase()
  return EXT_TO_MIME[ext]
}

// ── Admin terminal view (契约 C1) ──────────────────────────────────────────────

export interface AdminTerminalView {
  id: string
  terminalCode: string
  registeredAt: string // ISO
  lastSeenAt: string // ISO
  online: boolean // lastSeenAt 距今 < 3 分钟 = true
  lastHeartbeatAt: string | null
  printerStatus: string | null // 'ok'|'offline'|'paper_empty'|'error'|'not_found' 或 null
  agentVersion: string | null
  ipAddress: string | null
  diskFreeGb: number | null
}

export interface AdminPrinterView {
  id: string
  terminalId: string
  terminalCode: string
  name: string
  model: string | null
  serialNumber: string | null
  status: 'online' | 'offline' | 'error'
  printerStatus: string | null
  currentTask: string | null
  tonerLevel: number | null
  paperTrayLevel: number | null
  paperStatus: 'normal' | 'low' | 'empty' | 'jam' | 'unknown' | null
  fault: string | null
  lastHeartbeatAt: string | null
  lastSyncAt: string | null
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
        const updatedTask = await tx.printTask.update({
          where: { id: task.id, status: 'pending' },
          data: {
            status: 'claimed',
            terminalId,
            claimedAt: new Date(),
            claimExpiry,
          },
        })
        // Sprint 1：镜像订单 taskStatus 并回填下单终端（创建时 terminalId 未知）。
        // updateMany 按 printTaskId 精确匹配，无对应订单（如 seed 任务）则 0 行，安全无副作用。
        await tx.order.updateMany({
          where: { printTaskId: task.id },
          data: { taskStatus: 'claimed', terminalId },
        })
        return updatedTask
      })

      if (!claimed) break

      const params = this.parseParams(claimed.paramsJson)
      // 原始文件名落在 paramsJson.fileName（create-print-job 写入），从这里取出。
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
        // Sprint 1：镜像订单 taskStatus 到与 PrintTask 一致（真相源仍是 PrintTask）。
        // 无对应订单则 0 行，安全。
        await tx.order.updateMany({
          where: { printTaskId: taskId },
          data: { taskStatus: dto.status },
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

    // Sprint 1：先取出将被回收的任务 id，以便随后精确把对应订单镜像回 pending。
    const expiredClaimed = await this.prisma.printTask.findMany({
      where: { status: 'claimed', claimExpiry: { lt: now } },
      select: { id: true },
    })
    // Reset claimed tasks whose lease has expired
    const claimedCount = await this.prisma.printTask.updateMany({
      where: { status: 'claimed', claimExpiry: { lt: now } },
      data: { status: 'pending', terminalId: null, claimedAt: null, claimExpiry: null },
    })

    // Reset printing tasks stuck for more than 10 minutes (agent crash recovery).
    // claimedAt is the best proxy — a task transitions from claimed to printing
    // shortly after being claimed, so claimedAt is a conservative lower bound.
    const printingTimeout = new Date(now.getTime() - 10 * 60 * 1000)
    const expiredPrinting = await this.prisma.printTask.findMany({
      where: { status: 'printing', claimedAt: { lt: printingTimeout } },
      select: { id: true },
    })
    const printingCount = await this.prisma.printTask.updateMany({
      where: { status: 'printing', claimedAt: { lt: printingTimeout } },
      data: { status: 'pending', terminalId: null, claimedAt: null, claimExpiry: null },
    })

    // Sprint 1：把被回收任务对应的订单镜像回 pending（并清空下单终端），
    // 避免 Admin 看到永久卡在 claimed/printing 的订单。无对应订单则 0 行，安全。
    const resetIds = [...expiredClaimed, ...expiredPrinting].map((t) => t.id)
    if (resetIds.length > 0) {
      await this.prisma.order.updateMany({
        where: { printTaskId: { in: resetIds } },
        data: { taskStatus: 'pending', terminalId: null },
      })
    }

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

  /** 从 paramsJson 取出 create-print-job 落入的原始文件名（不存在/解析失败返回 undefined）。 */
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

  // ── Admin helpers ────────────────────────────────────────────────────────────

  listTerminals() {
    return this.prisma.terminal.findMany({ orderBy: { registeredAt: 'desc' } })
  }

  /**
   * 契约 C1（Agent3 admin 设备页消费）：列出全部终端 + 最近一条心跳 + 在线判定。
   * online = lastSeenAt 距今 < 3 分钟。lastSeenAt 取 max(registeredAt, 最近心跳 createdAt)。
   * printerStatus / agentVersion / ipAddress / diskFreeGb 取最近一条心跳，无心跳为 null。
   */
  async listTerminalsForAdmin(): Promise<{ terminals: AdminTerminalView[] }> {
    const ONLINE_WINDOW_MS = 3 * 60 * 1000
    const now = Date.now()

    const rows = await this.prisma.terminal.findMany({
      orderBy: { registeredAt: 'desc' },
      include: {
        heartbeats: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            printerStatus: true,
            agentVersion: true,
            ipAddress: true,
            diskFreeGb: true,
            createdAt: true,
          },
        },
      },
    })

    const terminals: AdminTerminalView[] = rows.map((t) => {
      const hb = t.heartbeats[0]
      const lastHeartbeatAt = hb?.createdAt ?? null
      // lastSeenAt：以最近心跳为准，从未上报心跳则回退注册时间。
      const lastSeen = lastHeartbeatAt ?? t.registeredAt
      return {
        id: t.id,
        terminalCode: t.terminalCode,
        registeredAt: t.registeredAt.toISOString(),
        lastSeenAt: lastSeen.toISOString(),
        online: now - lastSeen.getTime() < ONLINE_WINDOW_MS,
        lastHeartbeatAt: lastHeartbeatAt ? lastHeartbeatAt.toISOString() : null,
        printerStatus: hb?.printerStatus ?? null,
        agentVersion: hb?.agentVersion ?? null,
        ipAddress: hb?.ipAddress ?? null,
        diskFreeGb: hb?.diskFreeGb ?? null,
      }
    })

    return { terminals }
  }

  /**
   * Admin 打印机页真实数据源。
   *
   * 当前 Agent 心跳只上报 printerStatus,未上报型号/SN/耗材/纸盒余量,
   * 因此这些字段保持 null,由前端明确展示"未上报",避免编造硬件明细。
   */
  async listPrintersForAdmin(): Promise<{ printers: AdminPrinterView[] }> {
    const ONLINE_WINDOW_MS = 3 * 60 * 1000
    const now = Date.now()

    const rows = await this.prisma.terminal.findMany({
      orderBy: { registeredAt: 'desc' },
      include: {
        heartbeats: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { printerStatus: true, createdAt: true },
        },
        printTasks: {
          where: { status: { in: ['claimed', 'printing'] } },
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: { id: true, status: true },
        },
      },
    })

    const printers = rows.map((t): AdminPrinterView => {
      const hb = t.heartbeats[0]
      const activeTask = t.printTasks[0]
      const lastHeartbeatAt = hb?.createdAt ?? null
      const online = lastHeartbeatAt ? now - lastHeartbeatAt.getTime() < ONLINE_WINDOW_MS : false
      const printerStatus = hb?.printerStatus ?? null
      const status = toAdminPrinterStatus(online, printerStatus)

      return {
        id: `printer:${t.terminalCode}`,
        terminalId: t.id,
        terminalCode: t.terminalCode,
        name: `${t.terminalCode} 打印机`,
        model: null,
        serialNumber: null,
        status,
        printerStatus,
        currentTask: activeTask ? `${activeTask.id}（${activeTask.status}）` : null,
        tonerLevel: null,
        paperTrayLevel: null,
        paperStatus: printerStatus === 'paper_empty' ? 'empty' : null,
        fault: describePrinterFault(online, printerStatus),
        lastHeartbeatAt: lastHeartbeatAt ? lastHeartbeatAt.toISOString() : null,
        lastSyncAt: lastHeartbeatAt ? lastHeartbeatAt.toISOString() : null,
      }
    })

    return { printers }
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
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalId }, { terminalCode: terminalId }] },
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

function toAdminPrinterStatus(online: boolean, printerStatus: string | null): AdminPrinterView['status'] {
  if (!online) return 'offline'
  if (!printerStatus || printerStatus === 'unknown') return 'offline'
  if (printerStatus === 'ok' || printerStatus === 'ready' || printerStatus === 'idle') return 'online'
  return 'error'
}

function describePrinterFault(online: boolean, printerStatus: string | null): string | null {
  if (!online) return '终端离线，打印机状态未知'
  switch (printerStatus) {
    case 'paper_empty':
      return '纸盒已空，请补充 A4 纸张'
    case 'offline':
      return '打印机离线'
    case 'not_found':
      return '未检测到配置的打印机'
    case 'error':
      return '打印机故障，需人工处理'
    case null:
    case undefined:
    case 'unknown':
      return '打印机状态未上报'
    default:
      return null
  }
}
