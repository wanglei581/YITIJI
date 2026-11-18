import { Body, Controller, Get, HttpCode, HttpStatus, Ip, Post, Put, UseGuards } from '@nestjs/common'
import { IsInt, Max, Min } from 'class-validator'
import { ApiResponse } from '../../common/dto/api-response.dto'
import { CurrentUser, type AuthedUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { AiQuotaLimitService, type AiQuotaDailyLimitInput } from './ai-quota-limit.service'

const LIMIT_MESSAGE = '每天的免费次数须是 0 到 1000 的整数'

class UpdateAiQuotaLimitsDto implements AiQuotaDailyLimitInput {
  @IsInt({ message: LIMIT_MESSAGE })
  @Min(0, { message: LIMIT_MESSAGE })
  @Max(1000, { message: LIMIT_MESSAGE })
  ai_resume!: number

  @IsInt({ message: LIMIT_MESSAGE })
  @Min(0, { message: LIMIT_MESSAGE })
  @Max(1000, { message: LIMIT_MESSAGE })
  ai_assistant!: number

  @IsInt({ message: LIMIT_MESSAGE })
  @Min(0, { message: LIMIT_MESSAGE })
  @Max(1000, { message: LIMIT_MESSAGE })
  ai_interview!: number
}

@Controller('admin/ai/quota-limits')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminAiQuotaLimitController {
  constructor(private readonly limits: AiQuotaLimitService) {}

  @Get()
  get() {
    return this.limits.getConfig().then(ApiResponse.ok)
  }

  @Put()
  update(@Body() dto: UpdateAiQuotaLimitsDto, @CurrentUser() admin: AuthedUser, @Ip() ip: string) {
    return this.limits.update(dto, admin.userId, ip).then(ApiResponse.ok)
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  reset(@CurrentUser() admin: AuthedUser, @Ip() ip: string) {
    return this.limits.reset(admin.userId, ip).then(ApiResponse.ok)
  }
}
