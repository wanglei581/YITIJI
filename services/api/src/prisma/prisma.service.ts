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

  // ── Transaction ────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction(...args: Parameters<typeof this.client.$transaction>): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.client.$transaction as (...a: any[]) => any)(...args)
  }
}
