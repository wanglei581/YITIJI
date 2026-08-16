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
import {
  DATABASE_SUBSYSTEM,
  bootReadiness,
  readTimeoutMs,
  withBootTimeout,
} from '../common/boot/boot-readiness'
import { createPrismaClient, type AppPrismaClient, type DbKind } from './create-client'

/**
 * `$connect()` 的有界等待。默认 15s：PostgreSQL 驱动自身的 connect_timeout
 * 通常更短，这里只是兜住「驱动既不连上也不报错」的极端情况，不改变正常路径。
 */
const DEFAULT_DB_CONNECT_TIMEOUT_MS = 15_000

export type PrismaTransactionClient = Omit<AppPrismaClient, '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name)
  private readonly client: AppPrismaClient
  /** 当前数据库类型（sqlite=开发 / postgres=生产），由 DATABASE_URL 协议显式决定。 */
  readonly dbKind: DbKind

  constructor() {
    const url = process.env['DATABASE_URL']
    if (!url) {
      throw new Error('DATABASE_URL environment variable is required')
    }
    const created = createPrismaClient(url)
    this.client = created.client
    this.dbKind = created.kind
  }

  async onModuleInit(): Promise<void> {
    // Do not log credentials embedded in DATABASE_URL.
    const safeUrl = (process.env['DATABASE_URL'] ?? '').replace(
      /\/\/[^:]+:[^@]+@/,
      '//<redacted>@',
    )
    const timeoutMs = readTimeoutMs('DB_CONNECT_TIMEOUT_MS', DEFAULT_DB_CONNECT_TIMEOUT_MS)
    try {
      // 数据库是**硬依赖**：连不上就明确失败退出（非 0 退出码），
      // 让进程管理器看得见。这里只保证等待有界，不吞任何错误。
      await withBootTimeout(() => this.client.$connect(), {
        subsystem: DATABASE_SUBSYSTEM,
        operation: '$connect',
        timeoutMs,
      })
    } catch (error) {
      this.logger.error(
        `BOOT_DEPENDENCY_FATAL subsystem=${DATABASE_SUBSYSTEM} code=DB_CONNECT_FAILED ` +
          `target=${safeUrl} timeoutMs=${timeoutMs} errorType=${error instanceof Error ? error.name : 'UnknownError'}`,
      )
      this.logger.error('数据库是硬依赖，无法连接时不启动服务。请检查 DATABASE_URL、数据库进程与网络放行。')
      throw error
    }
    bootReadiness.markOk(DATABASE_SUBSYSTEM, 'DB_CONNECTED', `数据库已连接（${this.dbKind}）。`)
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

  get terminalBindCode() {
    return this.client.terminalBindCode
  }

  get terminalCredential() {
    return this.client.terminalCredential
  }

  get printTaskStatusLog() {
    return this.client.printTaskStatusLog
  }

  get scanTask() {
    return this.client.scanTask
  }

  get terminalCapability() {
    return this.client.terminalCapability
  }

  get terminalScanDeletionAudit() {
    return this.client.terminalScanDeletionAudit
  }

  // ── Order model foundation ─────────────────────────────────────────────────

  get order() {
    return this.client.order
  }

  // ── P0a payment foundation ─────────────────────────────────────────────────

  get priceConfig() {
    return this.client.priceConfig
  }

  // ── C5-2 online payment (sandbox) ──────────────────────────────────────────

  get paymentAttempt() {
    return this.client.paymentAttempt
  }

  // ── C5-4 退款域 ─────────────────────────────────────────────────────────────

  get refund() {
    return this.client.refund
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

  // ── 阶段1A Admin 招聘会管理 ────────────────────────────────────────────────

  get fairMaterial() {
    return this.client.fairMaterial
  }

  get fairMaterialPrintBridge() {
    return this.client.fairMaterialPrintBridge
  }

  // ── 招聘会场馆导览 ─────────────────────────────────────────────────────────

  get mockInterviewSession() {
    return this.client.mockInterviewSession
  }

  get mockInterviewTurn() {
    return this.client.mockInterviewTurn
  }

  get mockInterviewReport() {
    return this.client.mockInterviewReport
  }

  // ── S3-3 · P26 顾问作业面 ──────────────────────────────────────────────────

  get advisorSession() {
    return this.client.advisorSession
  }

  get advisorPin() {
    return this.client.advisorPin
  }

  get advisorArtifact() {
    return this.client.advisorArtifact
  }

  get fairVenueGuide() {
    return this.client.fairVenueGuide
  }

  get fairVenueHall() {
    return this.client.fairVenueHall
  }

  get fairVenueHallCompany() {
    return this.client.fairVenueHallCompany
  }

  get fairVenueFacility() {
    return this.client.fairVenueFacility
  }

  // ── 阶段1D 政策服务 ────────────────────────────────────────────────────────

  get policyPost() {
    return this.client.policyPost
  }

  /** P21 政策条件核对：政策申领条件的结构化表达 */
  get policyEligibilityRule() {
    return this.client.policyEligibilityRule
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

  // ── 岗位 AI / 数据质量治理 ───────────────────────────────────────────────

  get jobDataQualitySnapshot() {
    return this.client.jobDataQualitySnapshot
  }

  get jobAiSession() {
    return this.client.jobAiSession
  }

  get jobAiRecommendation() {
    return this.client.jobAiRecommendation
  }

  get aiServiceLog() {
    return this.client.aiServiceLog
  }

  get userAiConsent() {
    return this.client.userAiConsent
  }

  get memberLegalConsent() {
    return this.client.memberLegalConsent
  }

  get userDataRequest() {
    return this.client.userDataRequest
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

  get benefitActivity() {
    return this.client.benefitActivity
  }

  get benefitClaim() {
    return this.client.benefitClaim
  }

  get redemptionRecord() {
    return this.client.redemptionRecord
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

  // ── 企业展示(CompanyProfile)─────────────────────────────────────────────

  get companyProfile() {
    return this.client.companyProfile
  }

  // ── P1: 浏览 / 外部跳转记录 ──────────────────────────────────────────────

  get browseLog() {
    return this.client.browseLog
  }

  get externalJumpLog() {
    return this.client.externalJumpLog
  }

  // ── P1: 用户通知 / 意见反馈 ──────────────────────────────────────────────

  get memberNotification() {
    return this.client.memberNotification
  }

  get systemBroadcast() {
    return this.client.systemBroadcast
  }

  get broadcastReadState() {
    return this.client.broadcastReadState
  }

  get feedbackTicket() {
    return this.client.feedbackTicket
  }

  get feedbackReply() {
    return this.client.feedbackReply
  }

  // ── 智慧校园(Smart Campus)──────────────────────────────────────────────

  get terminalSmartCampusConfig() {
    return this.client.terminalSmartCampusConfig
  }

  get terminalToolboxConfig() {
    return this.client.terminalToolboxConfig
  }

  get toolboxApp() {
    return this.client.toolboxApp
  }

  get toolboxAppVersion() {
    return this.client.toolboxAppVersion
  }

  get toolboxAllowedHost() {
    return this.client.toolboxAllowedHost
  }

  get toolboxLaunchEvent() {
    return this.client.toolboxLaunchEvent
  }

  // ── G1 线下招聘机构 ───────────────────────────────────────────────────────────

  get offlineAgency() {
    return this.client.offlineAgency
  }

  get offlineJob() {
    return this.client.offlineJob
  }

  // ── P1 招聘信息统一治理(新 reader；legacy 写路径暂不切换)─────────────────

  get qualificationRecord() {
    return this.client.qualificationRecord
  }

  get onlinePlatformDirectory() {
    return this.client.onlinePlatformDirectory
  }

  get offlineAgencyProfile() {
    return this.client.offlineAgencyProfile
  }

  get offlineAgencyBranch() {
    return this.client.offlineAgencyBranch
  }

  get reviewDecision() {
    return this.client.reviewDecision
  }

  // ── G6 法务文档版本 ───────────────────────────────────────────────────────────

  get legalDocVersion() {
    return this.client.legalDocVersion
  }

  // ── AI 合同审查（默认关闭，Task 11 仅供后台编排单测）──────────────────────

  get contractReviewTask() {
    return this.client.contractReviewTask
  }

  // ── Transaction ────────────────────────────────────────────────────────────

  $transaction<R>(fn: (prisma: PrismaTransactionClient) => Promise<R>, options?: { maxWait?: number; timeout?: number; isolationLevel?: unknown }): Promise<R>
  $transaction<R>(ops: readonly unknown[], options?: { isolationLevel?: unknown }): Promise<R[]>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction(...args: any[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.client.$transaction as (...a: any[]) => any)(...args)
  }
}
