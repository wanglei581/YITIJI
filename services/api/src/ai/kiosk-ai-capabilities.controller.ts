import { Controller, Get } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { TerminalScopedThrottle } from '../common/throttler/terminal-throttle'
import { LlmConfigService } from './llm/llm-config.service'
import { listKioskAiCapabilities, type KioskAiCapabilitiesResponse } from './kiosk-ai-capabilities'

/**
 * GET /api/v1/kiosk/ai/capabilities
 *
 * 一体机能力仪表带数据源。匿名可读，按台限流。
 * 不调用计费 AI，响应不含密钥与模型名以外的配置细节。
 */
@Controller('kiosk/ai')
export class KioskAiCapabilitiesController {
  constructor(private readonly llmConfig: LlmConfigService) {}

  @Get('capabilities')
  @TerminalScopedThrottle(30)
  listCapabilities(): ApiResponse<KioskAiCapabilitiesResponse> {
    return ApiResponse.ok(listKioskAiCapabilities(this.llmConfig))
  }
}
