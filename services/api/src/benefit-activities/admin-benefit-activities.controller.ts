import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { BenefitActivitiesService } from './benefit-activities.service'
import { AdminListBenefitActivitiesQueryDto, UpsertBenefitActivityDto } from './dto/benefit-activities.dto'

@Controller('admin/benefit-activities')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminBenefitActivitiesController {
  constructor(private readonly service: BenefitActivitiesService) {}

  @Get()
  async list(@Query() query: AdminListBenefitActivitiesQueryDto) {
    return ApiResponse.ok(await this.service.adminList(query))
  }

  @Post()
  async create(@Body() dto: UpsertBenefitActivityDto, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.service.create(user, dto))
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpsertBenefitActivityDto, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.service.update(user, id, dto))
  }

  @Patch(':id/publish')
  async publish(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.service.publish(user, id))
  }

  @Patch(':id/end')
  async end(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.service.end(user, id))
  }

  @Get(':id/claims')
  async claims(@Param('id') id: string) {
    return ApiResponse.ok(await this.service.listClaims(id))
  }
}
