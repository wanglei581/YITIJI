import { Controller, Post, Get, Param, Body, Query, Req, UseGuards } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { AiService } from './ai.service'
import type { AiResultRequester } from './ai.service'
import { AiLogService } from './ai-log.service'
import { AuditService } from '../audit/audit.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { RedisService } from '../common/redis/redis.service'
import type { AdminAiUsage, AdminAiLogsResult } from './ai-log.service'
import { ResumeParseRequestDto } from './dto/resume-parse.dto'
import type { ResumeParseResponseDto } from './dto/resume-parse.dto'
import type { ResumeOptimizeResponseDto } from './dto/resume-optimize.dto'
import { AssistantChatRequestDto } from './dto/assistant-chat.dto'
import type { AssistantChatResponseDto } from './dto/assistant-chat.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'

interface ReqLike {
  requestId?: string
  headers: Record<string, string | string[] | undefined>
  ip?: string
  socket?: { remoteAddress?: string }
}

function ipOf(req: ReqLike): string | null {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]?.trim() ?? null
  if (Array.isArray(fwd) && fwd.length > 0) return fwd[0] ?? null
  return req.ip ?? req.socket?.remoteAddress ?? null
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
  ) {}

  /**
   * 解析 AI 结果读取请求方（Phase C-2A）。
   *
   * - 携带有效会员 Authorization → 会员请求（按 endUserId 本人校验，忽略任何 accessToken）。
   * - 否则 → 匿名请求，仅从 `x-resume-access-token` header 读取一次性令牌（不读 query）。
   */
  private async resolveAiResultRequester(req: ReqLike): Promise<AiResultRequester> {
    const member = await resolveOptionalEndUser(authOf(req), this.jwt, this.redis)
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
  async submitResumeParse(
    @Body() dto: ResumeParseRequestDto,
    @Req() req: ReqLike,
  ): Promise<ResumeParseResponseDto> {
    const endUser = await resolveOptionalEndUser(authOf(req), this.jwt, this.redis)
    const result = await this.aiService.submitResumeParse(dto, endUser?.endUserId ?? null)
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

  @Get('resume/records/:taskId/optimize')
  async getResumeOptimize(
    @Param('taskId') taskId: string,
    @Req() req: ReqLike,
  ): Promise<ResumeOptimizeResponseDto> {
    const requester = await this.resolveAiResultRequester(req)
    const result = await this.aiService.getResumeOptimize(taskId, requester)
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
      },
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
      requestId: req.requestId ?? null,
    })
    return result
  }

  @Post('assistant/chat')
  async chatWithAssistant(
    @Body() dto: AssistantChatRequestDto,
    @Req() req: ReqLike,
  ): Promise<AssistantChatResponseDto> {
    const result = await this.aiService.chatWithAssistant(dto)
    await this.audit.write({
      actorId: null,
      actorRole: 'kiosk',
      action: 'assistant.chat_message',
      targetType: 'system',
      targetId: null,
      payload: {
        sessionId: result.sessionId,
        intent: result.intent ?? null,
        providerName: this.aiService.getProviderName(),
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
  getAiUsage(): AdminAiUsage {
    return this.logService.getUsage(this.aiService.getProviderName())
  }

  @Get('admin/ai/logs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getAiLogs(@Query('limit') limitStr?: string): AdminAiLogsResult {
    const limit = limitStr !== undefined ? Number(limitStr) : 100
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 100
    return this.logService.getLogs(safeLimit)
  }
}
