import { Controller, Post, Get, Param, Body, Query } from '@nestjs/common'
import { AiService } from './ai.service'
import { AiLogService } from './ai-log.service'
import type { AdminAiUsage, AdminAiLogsResult } from './ai-log.service'
import { ResumeParseRequestDto } from './dto/resume-parse.dto'
import type { ResumeParseResponseDto } from './dto/resume-parse.dto'
import type { ResumeOptimizeResponseDto } from './dto/resume-optimize.dto'
import { AssistantChatRequestDto } from './dto/assistant-chat.dto'
import type { AssistantChatResponseDto } from './dto/assistant-chat.dto'

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
  ) {}

  @Post('resume/parse')
  async submitResumeParse(@Body() dto: ResumeParseRequestDto): Promise<ResumeParseResponseDto> {
    return this.aiService.submitResumeParse(dto)
  }

  @Get('resume/records/:taskId')
  async getResumeRecord(@Param('taskId') taskId: string): Promise<ResumeParseResponseDto> {
    return this.aiService.getResumeRecord(taskId)
  }

  @Get('resume/records/:taskId/optimize')
  async getResumeOptimize(@Param('taskId') taskId: string): Promise<ResumeOptimizeResponseDto> {
    return this.aiService.getResumeOptimize(taskId)
  }

  @Post('assistant/chat')
  async chatWithAssistant(@Body() dto: AssistantChatRequestDto): Promise<AssistantChatResponseDto> {
    return this.aiService.chatWithAssistant(dto)
  }

  // ─── Admin 统计 / 日志接口 ──────────────────────────────────
  // 返回内容只含元数据，禁止包含简历正文/聊天原文/文件名/fileId

  @Get('admin/ai/usage')
  getAiUsage(): AdminAiUsage {
    return this.logService.getUsage(this.aiService.getProviderName())
  }

  @Get('admin/ai/logs')
  getAiLogs(@Query('limit') limitStr?: string): AdminAiLogsResult {
    const limit = limitStr !== undefined ? Number(limitStr) : 100
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 100
    return this.logService.getLogs(safeLimit)
  }
}
