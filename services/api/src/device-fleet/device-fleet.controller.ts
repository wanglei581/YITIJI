import { Controller, Get, UseGuards } from '@nestjs/common'
import { Roles } from '../common/decorators/roles.decorator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { DeviceFleetService } from './device-fleet.service'
import type { DeviceFleetOverview } from './device-fleet.types'

@Controller('admin/device-fleet')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class DeviceFleetController {
  constructor(private readonly service: DeviceFleetService) {}

  @Get('overview')
  async overview(): Promise<ApiResponse<DeviceFleetOverview>> {
    return ApiResponse.ok(await this.service.getOverview())
  }
}
