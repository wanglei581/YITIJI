import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { OptionalEndUserAuthGuard } from '../common/guards/optional-end-user-auth.guard'
import { BenefitActivitiesService } from './benefit-activities.service'
import { ListBenefitActivitiesQueryDto } from './dto/benefit-activities.dto'

type MaybeEndUserRequest = Request & { endUser?: AuthedEndUser }

@Controller('activities')
export class BenefitActivitiesController {
  constructor(private readonly service: BenefitActivitiesService) {}

  @Get()
  @UseGuards(OptionalEndUserAuthGuard)
  async list(@Query() query: ListBenefitActivitiesQueryDto, @Req() req: MaybeEndUserRequest) {
    return ApiResponse.ok(await this.service.listVisible(query, req.endUser?.endUserId ?? null))
  }

  @Get(':id')
  @UseGuards(OptionalEndUserAuthGuard)
  async detail(@Param('id') id: string, @Req() req: MaybeEndUserRequest) {
    return ApiResponse.ok(await this.service.detail(id, req.endUser?.endUserId ?? null))
  }

  @Post(':id/claim')
  @UseGuards(EndUserAuthGuard)
  async claim(@Param('id') id: string, @CurrentEndUser() user: AuthedEndUser) {
    return ApiResponse.ok(await this.service.claim(user.endUserId, id))
  }
}
