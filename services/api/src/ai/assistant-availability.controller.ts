import { Controller, Get } from '@nestjs/common'
import { AiUse } from '../ai-access/ai-access.decorator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { TerminalScopedThrottle } from '../common/throttler/terminal-throttle'
import { AssistantChatAvailability } from './assistant-chat-availability.service'

/**
 * GET /api/v1/assistant/availability
 *
 * 小青文字对话的只读探针。只回答能不能用，不回密钥、厂商或提示词。
 * 不改 /advisor/availability：那个探针服务顾问作业面（advisor_work），
 * 对话走的是模型位 assistant_chat，两套开关可以各配各的。
 */
@Controller('assistant')
export class AssistantAvailabilityController {
  constructor(private readonly availability: AssistantChatAvailability) {}

  @Get('availability')
  @TerminalScopedThrottle(30)
  @AiUse('read')
  async availabilityProbe(): Promise<ApiResponse<{ available: boolean }>> {
    const refusal = await this.availability.refusal()
    return ApiResponse.ok({ available: refusal === null })
  }
}
