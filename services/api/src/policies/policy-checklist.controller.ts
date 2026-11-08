import { Controller, HttpCode, Param, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiResponse } from '../common/dto/api-response.dto'
import { PolicyChecklistService } from './policy-checklist.service'

@Controller('policies')
export class PolicyChecklistController {
  constructor(private readonly checklist: PolicyChecklistService) {}

  @Post(':id/checklist')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async generate(@Param('id') id: string) {
    return ApiResponse.ok(await this.checklist.generate(id))
  }
}
