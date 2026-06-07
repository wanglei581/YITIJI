import { Controller, Post, Get, Param, Body, Query, Req, UseGuards } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { AiService } from './ai.service'
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
   * 归属收口（Phase C-1）：带会员 token 时解析出 endUserId，会员所有的结果
   * 只能由本人读取；不同会员 / 匿名请求按 AI_TASK_NOT_FOUND 处理（service 层校验）。
   */
  @Get('resume/records/:taskId')
  async getResumeRecord(
    @Param('taskId') taskId: string,
    @Req() req: ReqLike,
  ): Promise<ResumeParseResponseDto> {
    const endUser = await resolveOptionalEndUser(authOf(req), this.jwt, this.redis)
    return this.aiService.getResumeRecord(taskId, endUser?.endUserId ?? null)
  }

  @Get('resume/records/:taskId/optimize')
  async getResumeOptimize(
    @Param('taskId') taskId: string,
    @Req() req: ReqLike,
  ): Promise<ResumeOptimizeResponseDto> {
    const endUser = await resolveOptionalEndUser(authOf(req), this.jwt, this.redis)
    const result = await this.aiService.getResumeOptimize(taskId, endUser?.endUserId ?? null)
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
        hasEndUser: Boolean(endUser),
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
