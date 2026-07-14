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
//   - completed/failed/cancelled are terminal states: PATCH is idempotent, DB not rewritten
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
  ForbiddenException,
  Logger,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { isHealthyPrinterStatus } from './printer-status'
import { AuditService } from '../audit/audit.service'
import type { RegisterTerminalDto } from './dto/register-terminal.dto'
import type { HeartbeatDto } from './dto/heartbeat.dto'
import type { ClaimTasksDto } from './dto/claim-tasks.dto'
import type { PatchTaskStatusDto } from './dto/patch-task-status.dto'
import type { UpdateTerminalProfileDto } from './dto/update-terminal-profile.dto'
import type { ExchangeTerminalBindCodeDto } from './dto/exchange-terminal-bind-code.dto'
import type { KioskTerminalConfigView } from './terminal-config.types'
import { TerminalToolboxService } from './terminal-toolbox.service'
import { DEFAULT_SMART_CAMPUS_MODULES, type SmartCampusModules } from '../smart-campus/smart-campus.types'

// ── Task status type ──────────────────────────────────────────────────────────

type TaskStatus = 'pending' | 'claimed' | 'printing' | 'completed' | 'failed' | 'cancelled'

const TERMINAL_STATES: TaskStatus[] = ['completed', 'failed', 'cancelled']

const VALID_TRANSITIONS: Record<string, TaskStatus[]> = {
  claimed: ['printing', 'failed'],
  printing: ['completed', 'failed'],
}

const CONFIG_REFRESH_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_BIND_CODE_TTL_MINUTES = 10
const BIND_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

function hashBindCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim(), 'utf8').digest('hex')
}

/** 常量时间比较 agentToken,避免逐字节比较泄露时序信息。 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = crypto.createHash('sha256').update(a).digest()
  const bufB = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(bufA, bufB)
}

function makeBindCode(): string {
  let out = ''
  for (let i = 0; i < 20; i++) {
    out += BIND_CODE_ALPHABET[crypto.randomInt(0, BIND_CODE_ALPHABET.length)]
  }
  return out
}

/**
 * C5-3 出纸门控（paid 后才 claim 出纸）。
 *
 * 决策口径（本波）：默认**关闭**，不静默改变现有生产/预生产打印行为（那里暂无 live 支付）；
 * 由环境变量 `PRINT_REQUIRE_PAID_BEFORE_CLAIM=true` 显式开启（C5-3 verify / CI / 商用验收使用）。
 *
 * 开启后：claim 只领取「已 `paid` 或**无关联 Order**（seed / 历史 / 直连测试任务）」的 pending 任务。
 * 唯一建 PrintTask 的生产路径 `PrintJobsService.create` 必在同事务建 Order，故「无 Order」只对
 * seed/历史成立，对其放行是安全的。付费单在支付前保持 pending 但**不被领取**，绝不出纸。
 *
 * 与支付域解耦（plan §219 / CLAUDE §12）：门控只**读** `Order.payStatus`，绝不改 `PrintTask.status`；
 * 支付回调也绝不碰打印状态。每次调用读 env，便于 verify 逐用例切换。
 */
function requirePaidBeforeClaim(): boolean {
  return process.env['PRINT_REQUIRE_PAID_BEFORE_CLAIM'] === 'true'
}

/**
 * Fail closed: the test print task is available only to an explicitly opted-in
 * development process. Staging, production, and unrecognised environments never seed it.
 */
function shouldSeedTestPrintTask(): boolean {
  return process.env['NODE_ENV'] === 'development' && process.env['ENABLE_TEST_PRINT_TASK_SEED'] === 'true'
}

function cleanNullable(value: string | null | undefined): string | null | undefined {
  if (value === null) return null
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeMacAddress(value: string | null | undefined): string | null | undefined {
  const cleaned = cleanNullable(value)
  if (cleaned === null || cleaned === undefined) return cleaned
  const hex = cleaned.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
  if (hex.length !== 12) {
    throw new BadRequestException({ error: { code: 'INVALID_MAC_ADDRESS', message: 'MAC 地址格式不正确' } })
  }
  return hex.match(/.{1,2}/g)!.join(':')
}

function tryNormalizeMacAddress(value: string | null | undefined): string | null | undefined {
  try {
    return normalizeMacAddress(value)
  } catch {
    return undefined
  }
}

function isMacUniqueConstraintError(error: unknown): boolean {
  const maybe = error as { code?: string; meta?: { target?: unknown } }
  if (maybe.code !== 'P2002') return false
  const target = maybe.meta?.target
  return Array.isArray(target)
    ? target.includes('macAddress')
    : typeof target === 'string' && target.includes('macAddress')
}

function exceptionErrorCode(error: unknown): string | undefined {
  const maybe = error as { getResponse?: () => unknown; response?: unknown }
  const response = typeof maybe.getResponse === 'function' ? maybe.getResponse() : maybe.response
  if (!response || typeof response !== 'object') return undefined
  const nested = (response as { error?: { code?: unknown } }).error?.code
  return typeof nested === 'string' ? nested : undefined
}

function parseSmartCampusModules(json: string): SmartCampusModules {
  try {
    const raw = JSON.parse(json) as Partial<SmartCampusModules> | null
    return {
      welcome: !!raw?.welcome,
      bigdata: false,
      luggage: !!raw?.luggage,
      panorama: !!raw?.panorama,
    }
  } catch {
    return { ...DEFAULT_SMART_CAMPUS_MODULES }
  }
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

const AGENT_HEARTBEAT_STATUSES = new Set(['online', 'offline', 'error', 'agent_degraded'])

function normalizeHeartbeatStatus(status: string | undefined): string | null {
  if (!status) return null
  return AGENT_HEARTBEAT_STATUSES.has(status) ? status : null
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
  displayName: string | null
  macAddress: string | null
  locationLabel: string | null
  enabled: boolean
  orgId: string | null // 所属机构 id；null = 未绑定
  orgName: string | null // 所属机构名称（便于前端直接展示）
  registeredAt: string // ISO
  lastSeenAt: string // ISO
  online: boolean // lastSeenAt 距今 < 3 分钟 = true
  lastHeartbeatAt: string | null
  agentStatus: string | null // 'online'|'offline'|'error'|'agent_degraded' 或 null（旧 Agent 未上报）
  localTaskDatabaseAvailable: boolean | null
  printerStatus: string | null // 'ok'|'offline'|'paper_empty'|'error'|'not_found' 或 null
  agentVersion: string | null
  ipAddress: string | null
  diskFreeGb: number | null
}

// ── Admin 终端归属（绑定/解绑机构）─────────────────────────────────────────────

/** 可绑定的机构选项（admin 终端归属下拉用，仅 enabled 机构）。 */
export interface AdminOrganizationOption {
  id: string
  name: string
  type: string
}

/** 终端归属变更结果（含旧/新机构，供 controller 写审计）。 */
export interface AssignTerminalOrgResult {
  terminalId: string // = terminalCode（对外稳定业务码）
  terminalCode: string
  oldOrgId: string | null
  newOrgId: string | null
  orgName: string | null // 绑定后的机构名；解绑时为 null
}

export interface UpdateTerminalProfileResult {
  terminalId: string
  terminalCode: string
  displayName: string | null
  macAddress: string | null
  locationLabel: string | null
  enabled: boolean
}

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly toolbox: TerminalToolboxService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Fail closed: only an explicit development opt-in can reset ptask_seed_001 to pending.
    // Staging and production never seed it, even when ENABLE_TEST_PRINT_TASK_SEED is true.
    if (shouldSeedTestPrintTask()) {
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
    )

    this.logger.log(`register: terminalId=${terminal.id} code=${dto.terminalCode}`)
    return { terminalId: terminal.id, terminalToken: agentToken, expiresAt }
  }

  /**
   * Admin 生成一次性绑定码。明文 bindCode 只在本响应返回一次；DB 仅保存 hash。
   * 绑定码用于 Windows 新主机换取 terminalToken，避免把 adminSecret 放到设备侧。
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
        where: {
          id: bind.id,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
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

  // ── 3. Claim tasks ───────────────────────────────────────────────────────────

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

    // C5-3 出纸门控：开启时只领取「已 paid 或无关联 Order」的 pending 任务；付费未支付单不出纸。
    // 只读 payStatus，不改 PrintTask.status（与支付域解耦）。默认关闭 → 行为与 C5-3 前一致。
    const paidGate = requirePaidBeforeClaim()
    const claimableWhere = paidGate
      ? {
          status: 'pending' as const,
          terminalId,
          OR: [{ order: { is: null } }, { order: { is: { payStatus: 'paid' } } }],
        }
      : { status: 'pending' as const, terminalId }

    // Atomic claim: find first pending task and claim it in a transaction
    for (let i = 0; i < limit; i++) {
      const claimed = await this.prisma.$transaction(async (tx) => {
        const task = await tx.printTask.findFirst({
          where: claimableWhere,
          orderBy: { createdAt: 'asc' },
        })
        if (!task) return null

        // status guard in WHERE prevents double-claim under concurrent requests
        // (PostgreSQL READ COMMITTED: two transactions could both see the same
        // pending task in findFirst; the guard ensures only one update wins)
        const updatedTask = await tx.printTask.update({
          where: { id: task.id, status: 'pending', terminalId },
          data: {
            status: 'claimed',
            claimedAt: new Date(),
            claimExpiry,
          },
        })
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
    if (!terminalIdHeader?.trim()) {
      throw new BadRequestException({
        error: {
          code: 'TASK_TERMINAL_MISSING',
          message: '状态回传必须携带 x-terminal-id header',
        },
      })
    }
    const terminalId = terminalIdHeader.trim()
    await this.findAndValidate(terminalIdHeader, authHeader)

    // Pre-flight: check task exists (optimistic read outside transaction is fine
    // here — the transaction below re-validates with a status guard in WHERE)
    const preCheck = await this.prisma.printTask.findUnique({ where: { id: taskId } })
    if (!preCheck) {
      throw new NotFoundException({
        error: { code: 'PRINT_TASK_NOT_FOUND', message: `任务 ${taskId} 不存在` },
      })
    }
    if (!preCheck.terminalId) {
      throw new BadRequestException({
        error: {
          code: 'TASK_TERMINAL_MISSING',
          message: `任务 ${taskId} 未绑定目标终端`,
        },
      })
    }
    if (preCheck.terminalId !== terminalId) {
      throw new BadRequestException({
        error: {
          code: 'TASK_NOT_OWNED',
          message: `任务 ${taskId} 不属于终端 ${terminalId}`,
        },
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
        where: { id: taskId, status: preCheck.status, terminalId },
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
   * 供其它模块（如 ScanTasksService）复用的 Agent 鉴权校验，
   * 委托给既有的 findAndValidate，避免重复实现 token 校验逻辑。
   */
  async assertAgentAuthorized(
    terminalId: string,
    authHeader: string | undefined,
    options: { allowDisabled?: boolean } = {},
  ): Promise<void> {
    await this.findAndValidate(terminalId, authHeader, options)
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async canTerminalClaimTasks(terminalId: string): Promise<boolean> {
    const latestHeartbeat = await this.prisma.terminalHeartbeat.findFirst({
      where: { terminalId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, localTaskDatabaseAvailable: true },
    })
    // 兼容旧 Agent / 新注册未上报心跳的终端：未知状态不拦截，只有明确降级才 fail-closed。
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
      throw new NotFoundException({
        error: { code: 'TERMINAL_NOT_REGISTERED', message: '终端未注册' },
      })
    }
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim()
    if (!token || !constantTimeEquals(token, terminal.agentToken)) {
      throw new UnauthorizedException({
        error: { code: 'AUTH_TOKEN_INVALID', message: 'agentToken 无效' },
      })
    }
    if (!options.allowDisabled && !terminal.enabled) {
      throw new ForbiddenException({
        error: { code: 'TERMINAL_DISABLED', message: '终端已停用' },
      })
    }
  }

  private async assertMacAvailable(macAddress: string, ownerRef: string): Promise<void> {
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

  private async writeWithMacConflictMapping<T>(write: () => Promise<T>): Promise<T> {
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

  private terminalRefWhere(terminalRef: string) {
    return {
      OR: [
        { id: terminalRef },
        { terminalCode: terminalRef },
      ],
    }
  }

  private findTerminalByRef(terminalRef: string) {
    return this.prisma.terminal.findFirst({
      where: this.terminalRefWhere(terminalRef),
      select: { id: true, terminalCode: true, enabled: true, lastSeenAt: true },
    })
  }

  private async findSmartCampusConfigByTerminalRef(
    terminalRef: string,
    terminal: Awaited<ReturnType<TerminalsService['findTerminalByRef']>>,
  ) {
    const keys = [
      terminalRef,
      terminal?.terminalCode,
      terminal?.id,
    ].filter((v): v is string => !!v)
    const configs = await this.prisma.terminalSmartCampusConfig.findMany({
      where: { terminalId: { in: [...new Set(keys)] } },
      orderBy: { updatedAt: 'desc' },
    })
    return configs.sort((a, b) => keys.indexOf(a.terminalId) - keys.indexOf(b.terminalId))[0] ?? null
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

      // Reset claimed tasks whose lease has expired.
      const claimedCount = await tx.printTask.updateMany({
        where: { status: 'claimed', claimExpiry: { lt: now } },
        data: { status: 'pending', claimedAt: null, claimExpiry: null },
      })

      // Reset printing tasks stuck for more than 10 minutes (agent crash recovery).
      // claimedAt is the best proxy — a task transitions from claimed to printing
      // shortly after being claimed, so claimedAt is a conservative lower bound.
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
        org: { select: { id: true, name: true } },
        heartbeats: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            status: true,
            printerStatus: true,
            localTaskDatabaseAvailable: true,
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
        displayName: t.displayName ?? null,
        macAddress: t.macAddress ?? null,
        locationLabel: t.locationLabel ?? null,
        enabled: t.enabled,
        orgId: t.orgId,
        orgName: t.org?.name ?? null,
        registeredAt: t.registeredAt.toISOString(),
        lastSeenAt: lastSeen.toISOString(),
        online: now - lastSeen.getTime() < ONLINE_WINDOW_MS,
        lastHeartbeatAt: lastHeartbeatAt ? lastHeartbeatAt.toISOString() : null,
        agentStatus: hb?.status ?? null,
        localTaskDatabaseAvailable: hb?.localTaskDatabaseAvailable ?? null,
        printerStatus: hb?.printerStatus ?? null,
        agentVersion: hb?.agentVersion ?? null,
        ipAddress: hb?.ipAddress ?? null,
        diskFreeGb: hb?.diskFreeGb ?? null,
      }
    })

    return { terminals }
  }

  /**
   * Admin 终端归属下拉选项：仅 enabled 机构（id/name/type），按名称排序。
   * 仅供 admin 绑定终端到机构时选择；不含敏感字段。
   */
  async listOrganizationOptions(): Promise<{ organizations: AdminOrganizationOption[] }> {
    const organizations = await this.prisma.organization.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, type: true },
    })
    return { organizations }
  }

  /**
   * Admin 绑定/解绑终端机构归属。
   *   - orgId=null → 解绑（Terminal.orgId 置空）。
   *   - orgId 非空 → 必须机构存在且 enabled，否则 404 ORG_NOT_FOUND / 400 ORG_DISABLED。
   *   - 终端不存在 → 404 TERMINAL_NOT_FOUND。
   * 错误体统一 { error: { code, message } }；审计在 controller 写（含 old/new orgId）。
   */
  async assignTerminalOrg(terminalId: string, orgId: string | null): Promise<AssignTerminalOrgResult> {
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalId }, { terminalCode: terminalId }] },
      select: { id: true, terminalCode: true, orgId: true },
    })
    if (!terminal) {
      throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
    }

    let orgName: string | null = null
    if (orgId !== null) {
      const org = await this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { id: true, name: true, enabled: true },
      })
      if (!org) {
        throw new NotFoundException({ error: { code: 'ORG_NOT_FOUND', message: '机构不存在' } })
      }
      if (!org.enabled) {
        throw new BadRequestException({ error: { code: 'ORG_DISABLED', message: '机构已停用，不能绑定' } })
      }
      orgName = org.name
    }

    const oldOrgId = terminal.orgId
    await this.prisma.terminal.update({ where: { id: terminal.id }, data: { orgId } })

    return {
      terminalId: terminal.terminalCode,
      terminalCode: terminal.terminalCode,
      oldOrgId,
      newOrgId: orgId,
      orgName,
    }
  }

  async updateTerminalProfile(
    terminalId: string,
    dto: UpdateTerminalProfileDto,
  ): Promise<UpdateTerminalProfileResult> {
    const terminalRefClauses: Array<{ id?: string; terminalCode?: string; macAddress?: string }> = [
      { id: terminalId },
      { terminalCode: terminalId },
    ]
    const macAddressRef = tryNormalizeMacAddress(terminalId)
    if (macAddressRef) terminalRefClauses.push({ macAddress: macAddressRef })

    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: terminalRefClauses },
      select: { id: true, terminalCode: true },
    })
    if (!terminal) {
      throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
    }

    const data: {
      displayName?: string | null
      macAddress?: string | null
      locationLabel?: string | null
      enabled?: boolean
    } = {}
    if ('displayName' in dto) data.displayName = cleanNullable(dto.displayName)
    if ('locationLabel' in dto) data.locationLabel = cleanNullable(dto.locationLabel)
    if ('enabled' in dto && dto.enabled !== undefined) data.enabled = dto.enabled
    if ('macAddress' in dto) {
      const macAddress = normalizeMacAddress(dto.macAddress)
      if (macAddress) await this.assertMacAvailable(macAddress, terminal.id)
      data.macAddress = macAddress === undefined ? undefined : macAddress
    }

    const saved = await this.writeWithMacConflictMapping(() =>
      this.prisma.terminal.update({
        where: { id: terminal.id },
        data,
        select: {
          id: true,
          terminalCode: true,
          displayName: true,
          macAddress: true,
          locationLabel: true,
          enabled: true,
        },
      }),
    )

    return {
      terminalId: saved.terminalCode,
      terminalCode: saved.terminalCode,
      displayName: saved.displayName ?? null,
      macAddress: saved.macAddress ?? null,
      locationLabel: saved.locationLabel ?? null,
      enabled: saved.enabled,
    }
  }

  async getKioskTerminalConfig(terminalRef: string): Promise<KioskTerminalConfigView> {
    const terminal = await this.findTerminalByRef(terminalRef)
    const [smartCampusConfig, toolboxConfig] = await Promise.all([
      this.findSmartCampusConfigByTerminalRef(terminalRef, terminal),
      this.toolbox.getPublicConfig(terminalRef, terminal),
    ])
    const terminalEnabled = terminal?.enabled ?? false
    const smartCampusEnabled = terminalEnabled && !!smartCampusConfig?.enabled
    const serverTime = new Date().toISOString()

    return {
      smartCampus: {
        enabled: smartCampusEnabled,
        modules: smartCampusEnabled
          ? parseSmartCampusModules(smartCampusConfig!.modulesJson)
          : { ...DEFAULT_SMART_CAMPUS_MODULES },
        items: smartCampusEnabled ? toolboxConfig.smartCampusItems : [],
      },
      toolbox: {
        enabled: toolboxConfig.enabled,
        items: toolboxConfig.items,
      },
      configVersion: [
        terminal?.lastSeenAt.toISOString() ?? 'unregistered',
        smartCampusConfig?.updatedAt.toISOString() ?? 'smart-campus:none',
        toolboxConfig.version,
      ].join('|'),
      refreshIntervalMs: CONFIG_REFRESH_INTERVAL_MS,
      serverTime,
    }
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
  if (isHealthyPrinterStatus(printerStatus)) return 'online'
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
