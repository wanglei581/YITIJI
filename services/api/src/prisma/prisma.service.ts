/**
 * PrismaService — Phase 8.2A
 *
 * Wraps PrismaClient (Prisma v7, adapter-based) for NestJS DI.
 * Uses @prisma/adapter-libsql for SQLite (dev) and can switch to
 * @prisma/adapter-pg for PostgreSQL (production) via DATABASE_URL.
 *
 * DATABASE_URL:
 *   SQLite (dev):  file:./prisma/dev.db
 *   PostgreSQL:    postgresql://user:pass@host:5432/ai_job_print
 *
 * Exposes model delegates and $transaction via composition so TypeScript
 * sees the full Prisma type surface without requiring class inheritance.
 */

import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaClient } from '../generated/prisma/client'

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name)
  private readonly client: InstanceType<typeof PrismaClient>

  constructor() {
    const url = process.env['DATABASE_URL']
    if (!url) {
      throw new Error('DATABASE_URL environment variable is required')
    }
    // PrismaLibSql accepts a config object with url (and optional authToken for Turso)
    const adapter = new PrismaLibSql({ url })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.client = new PrismaClient({ adapter } as any)
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect()
    // Do not log credentials embedded in DATABASE_URL.
    const safeUrl = (process.env['DATABASE_URL'] ?? '').replace(
      /\/\/[^:]+:[^@]+@/,
      '//<redacted>@',
    )
    this.logger.log(`DB connected — ${safeUrl}`)
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect()
  }

  // ── Model delegates ────────────────────────────────────────────────────────

  get terminal() {
    return this.client.terminal
  }

  get printTask() {
    return this.client.printTask
  }

  get terminalHeartbeat() {
    return this.client.terminalHeartbeat
  }

  get printTaskStatusLog() {
    return this.client.printTaskStatusLog
  }

  // ── Phase 0b ───────────────────────────────────────────────────────────────

  get organization() {
    return this.client.organization
  }

  get user() {
    return this.client.user
  }

  // ── 阶段 A: C 端求职者账号 ───────────────────────────────────────────────────

  get endUser() {
    return this.client.endUser
  }

  get jobSource() {
    return this.client.jobSource
  }

  get job() {
    return this.client.job
  }

  // ── BE-1 / BE-2 ────────────────────────────────────────────────────────────

  get fileObject() {
    return this.client.fileObject
  }

  get auditLog() {
    return this.client.auditLog
  }

  // ── BE-7 W2 ────────────────────────────────────────────────────────────────

  get jobFair() {
    return this.client.jobFair
  }

  get fairCompany() {
    return this.client.fairCompany
  }

  get fairZone() {
    return this.client.fairZone
  }

  // ── W4 同步日志 + Excel 导入批次 ──────────────────────────────────────────

  get syncLog() {
    return this.client.syncLog
  }

  get importBatch() {
    return this.client.importBatch
  }

  get importRecord() {
    return this.client.importRecord
  }

  // ── T1 字段映射规则复用 ──────────────────────────────────────────────────────

  get fieldMappingRule() {
    return this.client.fieldMappingRule
  }

  // ── HIGH-6 AI 结果持久化 ────────────────────────────────────────────────────

  get aiResumeResult() {
    return this.client.aiResumeResult
  }

  // ── Phase A-2: 材料处理任务骨架 ─────────────────────────────────────────────

  get documentProcessTask() {
    return this.client.documentProcessTask
  }

  get piiFinding() {
    return this.client.piiFinding
  }

  // ── Phase C-2C: 会员收藏 + 权益底座 ─────────────────────────────────────────

  get favorite() {
    return this.client.favorite
  }

  get benefitGrant() {
    return this.client.benefitGrant
  }

  // ── 待机宣传屏(Screensaver)──────────────────────────────────────────────

  get adAsset() {
    return this.client.adAsset
  }

  get adPlaylist() {
    return this.client.adPlaylist
  }

  get adPlaylistItem() {
    return this.client.adPlaylistItem
  }

  get terminalScreensaverConfig() {
    return this.client.terminalScreensaverConfig
  }

  // ── Transaction ────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction(...args: Parameters<typeof this.client.$transaction>): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.client.$transaction as (...a: any[]) => any)(...args)
  }
}
