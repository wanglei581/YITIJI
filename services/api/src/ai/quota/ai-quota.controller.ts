import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { ApiResponse } from '../../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../../common/decorators/current-end-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { EndUserAuthGuard } from '../../common/guards/end-user-auth.guard'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TerminalIdentityGuard } from '../../terminals/terminal-identity.guard'
import { AiQuotaService } from './ai-quota.service'
import type { AdminAiQuotaUsage, AiQuotaRemaining, KioskAiQuota } from './ai-quota.types'

/**
 * AI 按人次数余量（只读）。
 *
 * GET /api/v1/me/ai-quota          登录会员看本人三个桶
 * GET /api/v1/kiosk/ai-quota       已验签终端看游客池（默认关）
 * GET /api/v1/admin/ai/quota-usage 管理员看北京时间今天的汇总，不含会员身份
 */
@Controller()
export class AiQuotaController {
  constructor(private readonly quota: AiQuotaService) {}

  /** 只认登录令牌里的本人。query、body、其它头里的账号一律不读。 */
  @Get('me/ai-quota')
  @UseGuards(EndUserAuthGuard)
  async mine(@CurrentEndUser() user: AuthedEndUser): Promise<ApiResponse<{ items: AiQuotaRemaining[] }>> {
    return ApiResponse.ok({ items: await this.quota.remaining({ endUserId: user.endUserId }) })
  }

  /** 终端身份只认已验签的 x-terminal-id。 */
  @Get('kiosk/ai-quota')
  @UseGuards(TerminalIdentityGuard)
  async kiosk(@Req() req: Request): Promise<ApiResponse<KioskAiQuota>> {
    return ApiResponse.ok(await this.quota.remainingForTerminal(req.header('x-terminal-id') ?? ''))
  }

  @Get('admin/ai/quota-usage')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminUsage(): Promise<ApiResponse<AdminAiQuotaUsage>> {
    return ApiResponse.ok(await this.quota.adminUsage())
  }
}
