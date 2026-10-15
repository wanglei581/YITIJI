import { Body, Controller, Get, Ip, Put } from '@nestjs/common'
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { UseGuards } from '@nestjs/common'
import { AiAccessService, type AiLoginGate } from './ai-access.service'
class UpdateAiAccessDto { @IsOptional() @IsIn(['off', 'before_export', 'before_generate']) loginGate?: AiLoginGate; @IsOptional() @IsBoolean() declarationEnforced?: boolean; @IsOptional() @IsBoolean() paused?: boolean; @IsOptional() @IsBoolean() maintenance?: boolean; @IsString() @MaxLength(200) reason!: string }
@Controller('admin/ai-access')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminAiAccessController {
  constructor(private readonly access: AiAccessService) {}
  @Get() get() { return this.access.getConfig().then(ApiResponse.ok) }
  @Put() update(@Body() dto: UpdateAiAccessDto, @CurrentUser() admin: AuthedUser, @Ip() ip: string) { return this.access.update(dto, admin.userId, dto.reason, ip).then(ApiResponse.ok) }
}
