import { BadRequestException, Controller, Post, Get, Header, Param, Body, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Throttle } from '@nestjs/throttler'
import { TerminalScopedThrottle, throttleTerminalIdOf, PaidAiThrottle } from '../common/throttler/terminal-throttle'
import { AiPublicQuotaService } from './ai-public-quota.service'
import { JwtService } from '@nestjs/jwt'
import { AsrService } from '../asr/asr.service'
import { AiService } from './ai.service'
import type { AiResultRequester } from './ai.service'
import {
  AiLogService,
  AI_LOG_STATUSES,
  AI_OPERATIONS,
  MAX_LOG_LIMIT,
  isAiLogStatus,
  isAiOperation,
} from './ai-log.service'
import { AuditService } from '../audit/audit.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import type { AdminAiUsage, AdminAiLogsResult, AiLogStatus, AiOperation } from './ai-log.service'
import { ResumeParseRequestDto } from './dto/resume-parse.dto'
import type { ResumeParseResponseDto } from './dto/resume-parse.dto'
import { ResumeGenerateExportDto, ResumeGenerateRequestDto, ResumeLayoutAdjustDto } from './dto/resume-generate.dto'
import { RESUME_VOICE_AUDIO_FIELD, RESUME_VOICE_MAX_AUDIO_BYTES, type ResumeVoiceTranscribeResponseDto } from './dto/resume-voice.dto'
import type { ResumeOptimizeResponseDto } from './dto/resume-optimize.dto'
import { AssistantChatRequestDto } from './dto/assistant-chat.dto'
import type { AssistantChatResponseDto } from './dto/assistant-chat.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { BenefitRedemptionService } from '../benefit-redemption/benefit-redemption.service'
import { MemberPrivacyService } from '../member-privacy/member-privacy.service'
import { runWithPublicQuota } from './ai-request-guard'
import { assistantOwnerKey } from './llm/llm-chat.service'

import { resolveClientIp } from '../common/client-ip'
interface ReqLike {
  requestId?: string
  headers: Record<string, string | string[] | undefined>
  ip?: string
  socket?: { remoteAddress?: string }
  on?: (event: string, listener: () => void) => void
  aborted?: boolean
}

function ipOf(req: unknown): string | null {
  return resolveClientIp(req)
}

function uaOf(req: ReqLike): string | null {
  const ua = req.headers['user-agent']
  if (typeof ua === 'string') return ua.slice(0, 256)
  if (Array.isArray(ua) && ua[0]) return ua[0].slice(0, 256)
  return null
}

function authOf(req: ReqLike): string | undefined {
  const auth = req.headers.authorization
  if (typeof auth === 'string') return auth
  if (Array.isArray(auth)) return auth[0]
  return undefined
}

/**
 * 提取匿名结果一次性访问令牌（Phase C-2A）。
 *
 * 只从 `x-resume-access-token` header 读取，**不读 URL query**——避免令牌进入
 * 访问日志 / Referer / 浏览器历史。空白一律视为未提供。
 */
function resumeAccessTokenOf(req: ReqLike): string | null {
  const header = req.headers['x-resume-access-token']
  if (typeof header === 'string' && header.trim()) return header.trim()
  if (Array.isArray(header) && header[0]?.trim()) return header[0].trim()
  return null
}

function hasTargetContext(dto: ResumeParseRequestDto): boolean {
  const target = dto.targetContext
  if (!target || target.skipped) return false
  return Boolean(target.industry || target.targetJob || target.experience || target.scene)
}

function isWavBuffer(buffer: Buffer): boolean {
  return buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE'
}

// ============================================================
// AI Controller
//
// 路由前缀：/api/v1（由 main.ts 全局设置）
//
// GET  /resume/records/:taskId           — 查询解析结果
// GET  /resume/records/:taskId/optimize  — 查询优化建议
// POST /resume/parse                     — 提交简历解析
// POST /assistant/chat                   — AI 助手对话
// GET  /admin/ai/usage                   — AI 服务用量统计（仅元数据）
// GET  /admin/ai/logs                    — AI 调用日志列表（仅元数据）
// ============================================================

@Controller()
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly logService: AiLogService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly asr: AsrService,
    private readonly benefitRedemption: BenefitRedemptionService,
    private readonly publicQuota: AiPublicQuotaService,
    private readonly privacy: MemberPrivacyService,
  ) {}

  /**
   * 解析 AI 结果读取请求方（Phase C-2A）。
   *
   * - 携带有效会员 Authorization → 会员请求（按 endUserId 本人校验，忽略任何 accessToken）。
   * - 否则 → 匿名请求，仅从 `x-resume-access-token` header 读取一次性令牌（不读 query）。
   */
  private async resolveAiResultRequester(req: ReqLike): Promise<AiResultRequester> {
    const member = await resolveOptionalEndUser(authOf(req), this.jwt, this.redis, this.prisma)
    if (member) return { endUserId: member.endUserId, accessToken: null }
    return { endUserId: null, accessToken: resumeAccessTokenOf(req) }
  }

  /**
   * 简历 AI 提交。
   *
   * 审计:Kiosk 匿名调用,actorId=null,actorRole='kiosk'。
   * payload 只放元数据(fileId / source / providerName / taskId),
   * 绝不包含简历正文 / 解析结果。CLAUDE.md §11/§12 已规约。
   */
  @Post('resume/parse')
  @TerminalScopedThrottle(6) // 触发 LLM/OCR，与兄弟 LLM 路由同档；按台计数以免整个大厅共用 6 次
  async submitResumeParse(
    @Body() dto: ResumeParseRequestDto,
    @Req() req: ReqLike,
  ): Promise<ResumeParseResponseDto> {
    const endUser = await resolveOptionalEndUser(authOf(req), this.jwt, this.redis, this.prisma)
    if (endUser) {
      await this.privacy.requireActiveConsent(endUser.endUserId, 'resume_ai')
    }
    const quotaTicket = await this.publicQuota.consume('resume_parse', {
      member: endUser?.endUserId ?? null,
      terminal: throttleTerminalIdOf(req),
      ip: ipOf(req),
    })
    const result = await runWithPublicQuota(this.publicQuota, quotaTicket, req, () =>
      this.aiService.submitResumeParse(dto, endUser?.endUserId ?? null),
    )
    await this.audit.write({
      actorId: null,
      actorRole: 'kiosk',
      action: 'resume.parse_submitted',
      targetType: 'file',
      targetId: dto.fileId,
      payload: {
        source: dto.source,
        fileFormat: dto.fileFormat,
        providerName: this.aiService.getProviderName(),
        taskId: result.taskId,
        status: result.status,
        hasEndUser: Boolean(endUser),
        selectedDimensionCount: dto.selectedDimensions?.length ?? 0,
        targetContextProvided: hasTargetContext(dto),
        // 仅记录"是否为匿名结果铸了令牌"（布尔），绝不记录明文 token（合规）。
        accessTokenIssued: Boolean(result.accessToken),
      },
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
      requestId: req.requestId ?? null,
    })
    return result
  }

  /**
   * 查询解析结果。
   *
   * 归属 / 令牌门禁（Phase C-1 + C-2A）：会员结果只能本人凭会员 token 读取；
   * 匿名结果须凭 parse 时下发的一次性令牌（x-resume-access-token）读取。
   * 越权 / 无 token / 错 token 一律 AI_TASK_NOT_FOUND（service 层校验）。
   */
  @Get('resume/records/:taskId')
  async getResumeRecord(
    @Param('taskId') taskId: string,
    @Req() req: ReqLike,
  ): Promise<ResumeParseResponseDto> {
    const requester = await this.resolveAiResultRequester(req)
    return this.aiService.getResumeRecord(taskId, requester)
  }
  @PaidAiThrottle(20)

  // benefitGrantId（可选，P1 权益核销）：会员在此按次核销一项本人权益（coupon/free_quota/
  // package_entitlement），serviceRefId 用稳定的 taskId → 幂等键 = hash(grant:resume_optimize:taskId)，
  // 同一优化产物只扣一次。核销为纯平台 credit 消费，不碰 Order/金额（券≠资金，见 §8.5 / C5-4 分工）。
  // no-store：本端点可触发权益核销状态变更（benefitGrantId），禁止中间层缓存吞掉真实核销结果。
  @Get('resume/records/:taskId/optimize')
  @Header('Cache-Control', 'no-store')
  async getResumeOptimize(
    @Param('taskId') taskId: string,
    @Req() req: ReqLike,
    @Query('benefitGrantId') benefitGrantId?: string,
  ): Promise<ResumeOptimizeResponseDto> {
    const requester = await this.resolveAiResultRequester(req)
    if (requester.endUserId) {
      await this.privacy.requireActiveConsent(requester.endUserId, 'resume_ai')
    }
    const result = await this.aiService.getResumeOptimize(taskId, requester)

    // 权益核销：仅当优化结果真实生成（completed）且显式传入 benefitGrantId 时才核销；
    // 核销要求登录会员（权益属本人），匿名传 grantId 直接拒绝。核销失败会抛出（AI 结果已落库，不浪费算力）。
    const grantId = benefitGrantId?.trim()
    if (grantId) {
      if (!requester.endUserId) {
        throw new BadRequestException({ error: { code: 'REDEEM_REQUIRES_LOGIN', message: '权益核销需登录会员账号' } })
      }
      if (result.status === 'completed') {
        await this.benefitRedemption.redeem({
          endUserId: requester.endUserId,
          benefitGrantId: grantId,
          serviceType: 'resume_optimize',
          serviceRefId: taskId,
        })
      }
    }

    await this.audit.write({
      actorId: null,
      actorRole: 'kiosk',
      action: 'resume.optimize_requested',
      targetType: 'file',
      targetId: null,
      payload: {
        taskId,
        providerName: this.aiService.getProviderName(),
        status: result.status,
        moduleCount: result.modules?.length ?? 0,
        hasEndUser: requester.endUserId !== null,
        benefitRedeemed: Boolean(grantId) && result.status === 'completed',
      },
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
      requestId: req.requestId ?? null,
    })
    return result
  }

  @Post('resume/records/:taskId/layout-adjust')
  @PaidAiThrottle(6)
  async adjustResumeLayout(
    @Param('taskId') taskId: string,
    @Body() dto: ResumeLayoutAdjustDto,
    @Req() req: ReqLike,
  ) {
    const requester = await this.resolveAiResultRequester(req)
    const result = await this.aiService.adjustResumeLayout(taskId, dto.resume, dto.action, dto.layout, requester)
    await this.audit.write({
      actorId: null,
      actorRole: 'kiosk',
      action: 'resume.layout_adjusted',
      targetType: 'ai_task',
      targetId: taskId,
      payload: {
        action: dto.action,
        layout: dto.layout ? { columns: dto.layout.columns ?? 1, margin: dto.layout.margin ?? 'normal', fontScale: dto.layout.fontScale ?? 'standard', accent: dto.layout.accent ?? 'blue' } : null,
        warningCount: result.warnings.length,
        hasEndUser: requester.endUserId !== null,
      },
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
      requestId: req.requestId ?? null,
    })
    return result
  }

  /**
   * 阶段2A — 提交 AI 简历生成(引导式表单)。
   *
   * 合规:AI 只润色用户提供的资料(防编造契约在 service 层强制);
   * 审计只放元数据(条目数/状态/taskId),绝不包含姓名、联系方式或简历内容。
   */
  @Post('resume/generate')
  @PaidAiThrottle(6)
  async submitResumeGenerate(
    @Body() dto: ResumeGenerateRequestDto,
    @Req() req: ReqLike,
  ) {
    const endUser = await resolveOptionalEndUser(authOf(req), this.jwt, this.redis, this.prisma)
    if (endUser) {
      await this.privacy.requireActiveConsent(endUser.endUserId, 'resume_ai')
    }
    const result = await this.aiService.submitResumeGenerate(dto, endUser?.endUserId ?? null)
    await this.audit.write({
      actorId: null,
      actorRole: 'kiosk',
      action: 'resume.generate_submitted',
      targetType: 'ai_task',
      targetId: result.taskId,
      payload: {
        providerName: this.aiService.getProviderName(),
        status: result.status,
        educationCount: dto.education.length,
        experienceCount: dto.experience.length,
        projectCount: dto.projects.length,
        hasEndUser: Boolean(endUser),
        accessTokenIssued: Boolean(result.accessToken),
      },
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
      requestId: req.requestId ?? null,
    })
    return result
  }

  /** 阶段2A — 读取生成结果(归属/令牌门禁同 parse)。 */
  @Get('resume/generate/:taskId')
  async getResumeGenerate(
    @Param('taskId') taskId: string,
    @Req() req: ReqLike,
  ) {
    const requester = await this.resolveAiResultRequester(req)
    return this.aiService.getResumeGenerate(taskId, requester)
  }

  /**
   * Wave 4 — 简历语音转写。
   *
   * 仅内存接收短 WAV 音频并转发 ASR provider；不写 FileObject / COS / DB / 日志正文。
   * 调用方必须让用户确认转写文本后再写入简历生成表单。
   */
  @Post('resume/voice/transcribe')
  // 2026-09-05 真机 E2：引导式一问一录有 12 道语音题 + 试音，6 次/分在第 10 题必撞 429。
  // 人说话物理上到不了 20 次/分；每 IP 每小时 AI_IP_HOURLY_CEILING（默认 300）的天花板仍在。
  @PaidAiThrottle(20)
  @UseInterceptors(FileInterceptor(RESUME_VOICE_AUDIO_FIELD, { limits: { fileSize: RESUME_VOICE_MAX_AUDIO_BYTES, fieldNestingDepth: 0 } as { fieldNestingDepth: number; fileSize?: number } }))
  async transcribeResumeVoice(
    @UploadedFile() audio: Express.Multer.File | undefined,
  ): Promise<ResumeVoiceTranscribeResponseDto> {
    if (!audio?.buffer?.length) {
      throw new BadRequestException({ error: { code: 'AUDIO_MISSING', message: '缺少音频内容' } })
    }
    if (!isWavBuffer(audio.buffer)) {
      throw new BadRequestException({ error: { code: 'INVALID_AUDIO_FORMAT', message: '必须上传 WAV 格式音频' } })
    }
    // A-6 成本可见性：ASR 按时长计费，tokenUsage 恒为空，不编造单价。
    const asrStartedAt = Date.now()
    const result = await this.asr.recognizeWav(audio.buffer)
    this.logService.record({
      taskId: null,
      operation: 'voiceTranscribe',
      provider: this.asr.activeProviderName,
      status: result.ok ? 'success' : 'failed',
      latencyMs: Math.max(0, Date.now() - asrStartedAt),
      tokenUsage: undefined,
      errorCode: result.ok ? undefined : (result.errorCode ?? 'ASR_FAILED'),
      endUserId: null,
      terminalId: null,
    })
    if (!result.ok) {
      throw new BadRequestException({
        error: {
          code: result.errorCode ?? 'ASR_FAILED',
          message: result.errorMessage ?? '语音转写失败，请改用文字输入',
        },
      })
    }
    const text = result.text?.trim()
    if (!text) {
      throw new BadRequestException({ error: { code: 'ASR_FAILED', message: '没有识别到有效文字，请改用文字输入' } })
    }
    return { text, providerName: this.asr.activeProviderName }
  }

  /**
   * 阶段2A — 导出确认后的简历为真实 PDF(FileObject + 签名 URL + 既有清理策略)。
   * 审计只放元数据(fileId/页数/大小),绝不包含简历内容。
   */
  @Post('resume/generate/export')
  @Throttle({ default: { ttl: 60_000, limit: 10 } }) // 服务端 PDF 渲染 + 对象存储写入,防滥用
  async exportGeneratedResume(
    @Body() dto: ResumeGenerateExportDto,
    @Req() req: ReqLike,
  ) {
    const requester = await this.resolveAiResultRequester(req)
    const { taskId, format, layout, templateId, draft, ...resume } = dto
    const sourceFileId = await this.aiService.resolveExportSourceFileId(taskId, requester)
    const result = await this.aiService.exportGeneratedResume(resume, requester.endUserId, sourceFileId, format ?? 'pdf', layout, templateId, draft === true)
    await this.audit.write({
      actorId: null,
      actorRole: 'kiosk',
      action: 'resume.generate_exported',
      targetType: 'file',
      targetId: result.fileId,
      payload: {
        taskId: taskId ?? null,
        format: format ?? 'pdf',
        templateId: templateId ?? null,
        layout: layout ? { columns: layout.columns ?? 1, margin: layout.margin ?? 'normal', fontScale: layout.fontScale ?? 'standard', accent: layout.accent ?? 'blue' } : null,
        pageCount: result.pageCount,
        sizeBytes: result.sizeBytes,
        hasEndUser: Boolean(requester.endUserId),
      },
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
      requestId: req.requestId ?? null,
    })
    return result
  }

  @Post('assistant/chat')
  @TerminalScopedThrottle(12) // 对话式调用比单次生成频繁，但远低于此前落进的 60 次/分钟公共桶
  async chatWithAssistant(
    @Body() dto: AssistantChatRequestDto,
    @Req() req: ReqLike,
  ): Promise<AssistantChatResponseDto> {
    // 匿名是产品口径（不加 Guard）；这里只加限流与日配额，不加认证门槛。
    const chatMember = await resolveOptionalEndUser(authOf(req), this.jwt, this.redis, this.prisma)
    const quotaTicket = await this.publicQuota.consume('assistant_chat', {
      member: chatMember?.endUserId ?? null,
      terminal: throttleTerminalIdOf(req),
      ip: ipOf(req),
    })
    const result = await runWithPublicQuota(this.publicQuota, quotaTicket, req, () =>
      this.aiService.chatWithAssistant(
        dto,
        assistantOwnerKey(chatMember?.endUserId ?? null, ipOf(req)),
      ),
    )
    await this.audit.write({
      actorId: null,
      actorRole: 'kiosk',
      action: 'assistant.chat_message',
      targetType: 'system',
      targetId: null,
      payload: {
        sessionId: result.sessionId,
        intent: result.intent ?? null,
        // S0-1 / 风险 R1：这里过去写的是 getProviderName()（恒为回落 provider 名），
        // 走真实大模型时会把审计记成 mock/stub —— 事后无法从审计判断这条回答
        // 到底是不是 AI 生成。改记本次实际生效的 providerLabel + aiGenerated。
        providerName: result.providerLabel,
        aiGenerated: result.aiGenerated,
        // 故意不写聊天原文(合规)
      },
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
      requestId: req.requestId ?? null,
    })
    return result
  }

  // ─── Admin 统计 / 日志接口 ──────────────────────────────────
  // 仅 admin 角色可访问；返回内容只含元数据，禁止包含简历正文/聊天原文/文件名/fileId

  @Get('admin/ai/usage')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getAiUsage(): Promise<AdminAiUsage> {
    return await this.logService.getUsage(this.aiService.getProviderName())
  }

  /**
   * AI 调用日志列表（仅元数据）。
   *
   * 筛选一律在**服务端**做：此前只有 limit，Admin 页固定拉 100 条再在浏览器里过滤，
   * 低频能力（contractReview 等）没挤进这 100 条就显示为空 —— 页面在说假话。
   *
   * 非法筛选值一律 400，不静默忽略（与 assertValidFeatureKey 同口径）：
   * 静默忽略会让运营以为「筛过了、没有数据」，而实际是筛选根本没生效。
   *
   * ⚠️ 响应里没有 endUserId：AI 日志不暴露调用者身份，是合规设计，别加。
   */
  @Get('admin/ai/logs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getAiLogs(
    @Query('operation') operation?: string,
    @Query('status') status?: string,
    @Query('startAt') startAt?: string,
    @Query('endAt') endAt?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ): Promise<AdminAiLogsResult> {
    const range = {
      startAt: parseLogDateFilter(startAt, 'startAt'),
      endAt: parseLogDateFilter(endAt, 'endAt'),
    }
    if (range.startAt && range.endAt && range.startAt.getTime() >= range.endAt.getTime()) {
      throw badLogFilter('startAt 必须早于 endAt')
    }
    return await this.logService.getLogs({
      operation: parseLogOperationFilter(operation),
      status: parseLogStatusFilter(status),
      startAt: range.startAt,
      endAt: range.endAt,
      limit: parseLogNumberFilter(limitStr, 'limit', 1, MAX_LOG_LIMIT),
      offset: parseLogNumberFilter(offsetStr, 'offset', 0, Number.MAX_SAFE_INTEGER),
    })
  }
}

// ─── /admin/ai/logs 筛选参数解析 ────────────────────────────────
// 空字符串一律视为「未提供」：前端把 select 清空时会带 `?operation=` 过来，
// 那不是非法值，是不筛。

function badLogFilter(message: string): BadRequestException {
  return new BadRequestException({ error: { code: 'AI_LOG_FILTER_INVALID', message } })
}

function parseLogOperationFilter(value: string | undefined): AiOperation | undefined {
  if (value === undefined || value === '') return undefined
  if (!isAiOperation(value)) {
    throw badLogFilter(`未知的 operation。合法取值：${AI_OPERATIONS.join(', ')}`)
  }
  return value
}

function parseLogStatusFilter(value: string | undefined): AiLogStatus | undefined {
  if (value === undefined || value === '') return undefined
  if (!isAiLogStatus(value)) {
    throw badLogFilter(`未知的 status。合法取值：${AI_LOG_STATUSES.join(', ')}`)
  }
  return value
}

function parseLogDateFilter(value: string | undefined, field: string): Date | undefined {
  if (value === undefined || value === '') return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw badLogFilter(`${field} 不是合法时间（需 ISO 8601）`)
  return parsed
}

function parseLogNumberFilter(
  value: string | undefined,
  field: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw badLogFilter(`${field} 必须是 ${min}–${max} 之间的整数`)
  }
  return parsed
}
