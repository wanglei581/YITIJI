import { Controller, Get, Optional } from '@nestjs/common'
import { AiAccessService } from '../ai-access/ai-access.service'
import { AiUse } from '../ai-access/ai-access.decorator'
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
  constructor(
    private readonly llmConfig: LlmConfigService,
    @Optional() private readonly access?: AiAccessService,
  ) {}

  @Get('capabilities')
  @TerminalScopedThrottle(30)
  @AiUse('read')

  async listCapabilities(): Promise<ApiResponse<KioskAiCapabilitiesResponse>> {
    return ApiResponse.ok(await listKioskAiCapabilities(this.llmConfig, this.access))
  }
}
