// ============================================================
// AiConfigController — 管理员后台「AI 大模型配置」端点
//
// GET  /api/v1/admin/ai-config        读取当前配置（apiKey 只回 configured 布尔）
// PUT  /api/v1/admin/ai-config        更新配置（可含 apiKey 明文，加密落盘）
// POST /api/v1/admin/ai-config/test   连通性测试，返回样例回复或错误
//
// 合规：apiKey 绝不回显；仅服务端保存。
// ============================================================

import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { LlmConfigService } from './llm-config.service'
import { LlmChatService } from './llm-chat.service'
import { LLM_PRESETS, isLlmVendor } from './llm-presets'

interface UpdateAiConfigDto {
  vendor?:       string
  model?:        string
  baseURL?:      string
  systemPrompt?: string
  temperature?:  number
  enabled?:      boolean
  apiKey?:       string
}

@Controller('admin/ai-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AiConfigController {
  constructor(
    private readonly config: LlmConfigService,
    private readonly chat: LlmChatService,
  ) {}

  @Get()
  get() {
    return {
      config:  this.config.getView(),
      presets: Object.values(LLM_PRESETS),
    }
  }

  @Put()
  update(@Body() body: UpdateAiConfigDto) {
    const patch: Parameters<LlmConfigService['update']>[0] = {}
    if (body.vendor !== undefined && isLlmVendor(body.vendor)) patch.vendor = body.vendor
    if (body.model !== undefined)        patch.model = body.model
    if (body.baseURL !== undefined)      patch.baseURL = body.baseURL
    if (body.systemPrompt !== undefined) patch.systemPrompt = body.systemPrompt
    if (typeof body.temperature === 'number') patch.temperature = body.temperature
    if (typeof body.enabled === 'boolean')    patch.enabled = body.enabled
    if (body.apiKey !== undefined)       patch.apiKey = body.apiKey
    return this.config.update(patch)
  }

  @Post('test')
  async test() {
    return this.chat.test()
  }
}
