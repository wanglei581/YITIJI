// ============================================================
// Terminals Service — Phase 8.1B
//
// In-memory store (placeholder until Prisma persistence in Phase 8.1C+).
// Provides the four endpoints the Terminal Agent calls:
//   1. register        — POST /auth/terminal/register
//   2. heartbeat       — PUT  /terminals/:terminalId/heartbeat
//   3. claimTasks      — POST /terminals/:terminalId/tasks/claim
//   4. patchTaskStatus — PATCH /print-tasks/:taskId/status
//
// Security notes (Phase 8.1B simplifications):
//   - agentToken stored plain text in memory. Phase 8.1C: DB + DPAPI on Agent.
//   - actionToken = base64(taskId:terminalId), no HMAC. Phase 8.1C: HMAC-SHA256.
//   - TERMINAL_ADMIN_SECRET defaults to 'change-me-before-deploy' for local dev.
//   - Token never logged; only first 8 chars echoed for debug.
// ============================================================

import crypto from 'crypto'
import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common'
import type { RegisterTerminalDto } from './dto/register-terminal.dto'
import type { HeartbeatDto } from './dto/heartbeat.dto'
import type { ClaimTasksDto } from './dto/claim-tasks.dto'
import type { PatchTaskStatusDto } from './dto/patch-task-status.dto'

// ── Helpers ─────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString()
}

// ── Internal types ───────────────────────────────────────────────────────────

interface TerminalRecord {
  terminalId: string
  terminalCode: string
  agentToken: string
  deviceFingerprint: string
  status: 'online' | 'offline'
  printerStatus: string
  agentVersion: string
  ipAddress: string
  lastHeartbeatAt?: string
  registeredAt: string
}

type TaskStatus = 'pending' | 'claimed' | 'printing' | 'completed' | 'failed'

/**
 * PrintJobParams (inline mirror of packages/shared — avoids ESM/CJS issues).
 * Keep in sync with packages/shared/src/types/print.ts.
 */
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

interface PrintTaskRecord {
  taskId: string
  status: TaskStatus
  fileUrl: string
  fileMd5: string
  claimedBy?: string
  claimExpiresAt?: string
  errorCode?: string
  errorMessage?: string
  params: PrintJobParams
  createdAt: string
  updatedAt: string
}

// ── ClaimTask response shape (matches Agent-side ClaimTask type) ─────────────

export interface ClaimTaskResponse {
  taskId: string
  type: 'print'
  fileUrl: string
  fileMd5: string
  /**
   * Phase 8.1B: base64(taskId:terminalId) — no cryptographic signature.
   * Phase 8.1C: HMAC-SHA256 signed JWT with action/taskId/terminalId/expiresAt/nonce.
   */
  actionToken: string
  claimedBy: string
  claimExpiresAt: string
  params: PrintJobParams
  createdAt: string
}

// ── Test file (1×1 white PNG, 67 bytes) ─────────────────────────────────────
// pdfkit natively supports PNG → Agent routes via pdfkit → Method B → real paper.
// MD5 is computed from the same buffer so it always matches.

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
    '(Phase 8.1B visible end-to-end test) Tj',
    '0 -34 Td',
    '(Task: ptask_seed_001) Tj',
    '0 -34 Td',
    '(If this page prints, download, MD5 and print worked.) Tj',
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

// ── Admin secret ─────────────────────────────────────────────────────────────

const ADMIN_SECRET =
  process.env['TERMINAL_ADMIN_SECRET'] ?? 'change-me-before-deploy'

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class TerminalsService {
  private readonly terminals: TerminalRecord[] = []
  private readonly printTasks: PrintTaskRecord[] = []

  constructor() {
    // ── Seed a pending print task for local testing ─────────────────────────
    this.printTasks.push({
      taskId: 'ptask_seed_001',
      status: 'pending',
      fileUrl: '/api/v1/test/sample-visible.pdf',
      fileMd5: SAMPLE_VISIBLE_PDF_MD5,
      params: {
        copies: 1,
        colorMode: 'black_white',
        duplex: 'simplex',
        paperSize: 'A4',
        orientation: 'auto',
        quality: 'standard',
        scale: 'fit',
        pagesPerSheet: 1,
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })

    // ── Periodically reset expired claims (every 30s) ───────────────────────
    // Node.js is single-threaded; no lock needed.
    const resetExpiredClaimsTimer = setInterval(() => {
      const now = new Date()
      for (const task of this.printTasks) {
        if (
          task.status === 'claimed' &&
          task.claimExpiresAt &&
          new Date(task.claimExpiresAt) < now
        ) {
          task.status = 'pending'
          task.claimedBy = undefined
          task.claimExpiresAt = undefined
          task.updatedAt = now.toISOString()
        }
      }
    }, 30_000)
    resetExpiredClaimsTimer.unref()
  }

  // ── 1. Register ──────────────────────────────────────────────────────────

  register(dto: RegisterTerminalDto): {
    terminalId: string
    terminalToken: string
    expiresAt: string
  } {
    // Validate admin secret
    if (dto.adminSecret !== ADMIN_SECRET) {
      throw new UnauthorizedException({
        error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'adminSecret 无效' },
      })
    }

    // If the same terminalCode already registered, return a new token
    // (allows re-registration after restart without manual cleanup)
    const existing = this.terminals.find((t) => t.terminalCode === dto.terminalCode)
    const agentToken = crypto.randomBytes(32).toString('hex')

    if (existing) {
      existing.agentToken = agentToken
      existing.deviceFingerprint = dto.deviceFingerprint
      existing.status = 'online'
      return {
        terminalId: existing.terminalId,
        terminalToken: agentToken,
        expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      }
    }

    const terminalId = `t_${crypto.randomBytes(8).toString('hex')}`
    this.terminals.push({
      terminalId,
      terminalCode: dto.terminalCode,
      agentToken,
      deviceFingerprint: dto.deviceFingerprint,
      status: 'online',
      printerStatus: 'unknown',
      agentVersion: 'unknown',
      ipAddress: 'unknown',
      registeredAt: nowIso(),
    })

    return {
      terminalId,
      terminalToken: agentToken,
      expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    }
  }

  // ── 2. Heartbeat ─────────────────────────────────────────────────────────

  heartbeat(
    terminalId: string,
    dto: HeartbeatDto,
    authHeader: string | undefined,
  ): { acknowledged: true } {
    const terminal = this.findAndValidate(terminalId, authHeader)

    terminal.status = 'online'
    terminal.printerStatus = dto.printerStatus ?? terminal.printerStatus
    terminal.agentVersion = dto.agentVersion ?? terminal.agentVersion
    terminal.ipAddress = dto.ipAddress ?? terminal.ipAddress
    terminal.lastHeartbeatAt = nowIso()

    return { acknowledged: true }
  }

  // ── 3. Claim tasks ───────────────────────────────────────────────────────

  claimTasks(
    terminalId: string,
    dto: ClaimTasksDto,
    authHeader: string | undefined,
  ): ClaimTaskResponse[] {
    this.findAndValidate(terminalId, authHeader)

    const claimExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    const results: ClaimTaskResponse[] = []
    const limit = Math.min(dto.maxTasks, 1) // Phase 8.1B: max 1 per cycle

    for (const task of this.printTasks) {
      if (results.length >= limit) break
      if (task.status !== 'pending') continue

      // Atomically claim (Node.js single-threaded — no race)
      task.status = 'claimed'
      task.claimedBy = terminalId
      task.claimExpiresAt = claimExpiresAt
      task.updatedAt = nowIso()

      results.push({
        taskId: task.taskId,
        type: 'print',
        fileUrl: task.fileUrl,
        fileMd5: task.fileMd5,
        actionToken: Buffer.from(`${task.taskId}:${terminalId}`).toString('base64'),
        claimedBy: terminalId,
        claimExpiresAt,
        params: task.params,
        createdAt: task.createdAt,
      })
    }

    return results
  }

  // ── 4. Patch task status ─────────────────────────────────────────────────

  patchTaskStatus(
    taskId: string,
    dto: PatchTaskStatusDto,
    authHeader: string | undefined,
    terminalIdHeader: string | undefined,
  ): { acknowledged: true } {
    // Validate token against any registered terminal (simplified: just find by token)
    this.validateAnyTerminalToken(authHeader, terminalIdHeader)

    const task = this.printTasks.find((t) => t.taskId === taskId)
    if (!task) {
      throw new NotFoundException({
        error: { code: 'PRINT_TASK_NOT_FOUND', message: `任务 ${taskId} 不存在` },
      })
    }

    // Terminal states: completed / failed are terminal — ignore duplicate PATCHes (idempotent)
    if (task.status === 'completed' || task.status === 'failed') {
      return { acknowledged: true }
    }

    // State machine validation
    const validTransitions: Record<string, TaskStatus[]> = {
      claimed: ['printing'],
      printing: ['completed', 'failed'],
    }
    const allowed = validTransitions[task.status]
    if (!allowed || !allowed.includes(dto.status as TaskStatus)) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message: `任务当前状态 ${task.status} 不允许转换为 ${dto.status}`,
        },
      })
    }

    task.status = dto.status as TaskStatus
    task.errorCode = dto.errorCode
    task.errorMessage = dto.errorMessage
    task.updatedAt = nowIso()

    return { acknowledged: true }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private findAndValidate(
    terminalId: string,
    authHeader: string | undefined,
  ): TerminalRecord {
    const terminal = this.terminals.find((t) => t.terminalId === terminalId)
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
    return terminal
  }

  /**
   * For PATCH /print-tasks/:taskId/status:
   * The Agent sends X-Terminal-Id + Authorization.
   * Validate that a terminal with that ID exists and the token matches.
   */
  private validateAnyTerminalToken(
    authHeader: string | undefined,
    terminalIdHeader: string | undefined,
  ): void {
    if (!terminalIdHeader) {
      // Fallback: allow if any terminal has this token (Phase 8.1B tolerance)
      const token = authHeader?.replace(/^Bearer\s+/i, '').trim()
      if (!token) {
        throw new UnauthorizedException({
          error: { code: 'AUTH_TOKEN_INVALID', message: '缺少 Authorization header' },
        })
      }
      const found = this.terminals.find((t) => t.agentToken === token)
      if (!found) {
        throw new UnauthorizedException({
          error: { code: 'AUTH_TOKEN_INVALID', message: 'agentToken 无效' },
        })
      }
      return
    }
    this.findAndValidate(terminalIdHeader, authHeader)
  }

  // ── Admin helpers (for future admin endpoints) ───────────────────────────

  /** List all terminals (admin use). */
  listTerminals(): TerminalRecord[] {
    return this.terminals
  }

  /** List all print tasks (admin use). */
  listPrintTasks(): PrintTaskRecord[] {
    return this.printTasks
  }

}
