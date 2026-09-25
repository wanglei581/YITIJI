import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { EMERGENCY_REASON_CODES } from './recruitment-hosting'
import { RecruitmentEmergencyService, type EmergencyTargetType } from './recruitment-emergency.service'

class EmergencyTakedownDto {
  @IsIn(['job', 'job_fair', 'company', 'policy'])
  targetType!: EmergencyTargetType

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  targetId!: string

  @IsIn(EMERGENCY_REASON_CODES)
  reasonCode!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reasonText!: string
}

class CircuitBreakDto {
  @IsIn(['org', 'source'])
  scope!: 'org' | 'source'

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  id!: string

  @IsIn(EMERGENCY_REASON_CODES)
  reasonCode!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reasonText!: string
}

/**
 * 管理员紧急下架。单向：没有恢复接口。
 * 不提供按筛选条件的日常批量下架，只保留单条和按机构 / 来源熔断。
 */
@Controller()
export class RecruitmentEmergencyController {
  constructor(private readonly emergency: RecruitmentEmergencyService) {}

  @Post('admin/recruitment-emergency/takedown')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  takedown(@Body() dto: EmergencyTakedownDto, @CurrentUser() user: AuthedUser) {
    return this.emergency.takedown(dto.targetType, dto.targetId, dto.reasonCode, dto.reasonText, user)
  }

  @Post('admin/recruitment-emergency/circuit-break')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  circuitBreak(@Body() dto: CircuitBreakDto, @CurrentUser() user: AuthedUser) {
    return this.emergency.circuitBreak(dto.scope, dto.id, dto.reasonCode, dto.reasonText, user)
  }

  @Get('partner/org-notices')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  notices(@CurrentUser() user: AuthedUser) {
    return this.emergency.listNotices(user.orgId ?? '')
  }
}
