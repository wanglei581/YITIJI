import { Controller, Get, Query } from '@nestjs/common'
import { TerminalScopedThrottle } from '../common/throttler/terminal-throttle'
import { SupportContactService } from './support-contact.service'

/**
 * GET /api/v1/public/support-contact?terminalId=
 * 不登录。一体机与小程序读取服务电话、服务时间，以及两条提示是否该出现。
 * 节流与 GET /api/v1/kiosk/ai/capabilities 相同。不写审计。
 */
@Controller('public')
export class SupportContactPublicController {
  constructor(private readonly service: SupportContactService) {}

  @Get('support-contact')
  @TerminalScopedThrottle(30)
  async get(@Query('terminalId') terminalId?: string | string[]) {
    const ref = typeof terminalId === 'string' ? terminalId : undefined
    return { success: true as const, data: await this.service.getPublic(ref) }
  }
}
