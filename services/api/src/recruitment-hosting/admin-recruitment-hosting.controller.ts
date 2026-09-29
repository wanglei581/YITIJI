import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { isRecruitmentContentHostingEnabled } from './recruitment-hosting'

export interface AdminRecruitmentHostingBody {
  recruitmentHosting: {
    enabled: boolean
    deploymentEnabled: boolean
  }
}

/**
 * 管理员读取招聘内容托管开关。只读，不接受查询参数改值。
 * 两个布尔都来自 `isRecruitmentContentHostingEnabled()`。
 */
@Controller('admin/system')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminRecruitmentHostingController {
  @Get('recruitment-hosting')
  getRecruitmentHosting(): ApiResponse<AdminRecruitmentHostingBody> {
    const enabled = isRecruitmentContentHostingEnabled()
    return ApiResponse.ok({
      recruitmentHosting: { enabled, deploymentEnabled: enabled },
    })
  }
}
