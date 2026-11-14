import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import {
  evaluateRecruitmentLock,
  type DeploymentOwnership,
  type OperatorSelfReport,
} from './deployment-ownership'
import { isRecruitmentContentHostingEnabled } from './recruitment-hosting'

export interface AdminRecruitmentHostingBody {
  recruitmentHosting: {
    enabled: boolean
    deploymentEnabled: boolean
    deploymentOwnership: DeploymentOwnership
    operatorSelfReport: OperatorSelfReport | null
  }
}

/**
 * 管理员读取招聘内容托管开关。只读，不接受查询参数改值。
 * 两个布尔都来自 `isRecruitmentContentHostingEnabled()`。
 * 部署归属与运营单位自报来自 `evaluateRecruitmentLock()`（认不出按我方云；自报只在私有化且托管开时有值）。
 */
@Controller('admin/system')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminRecruitmentHostingController {
  @Get('recruitment-hosting')
  getRecruitmentHosting(): ApiResponse<AdminRecruitmentHostingBody> {
    const enabled = isRecruitmentContentHostingEnabled()
    const lock = evaluateRecruitmentLock()
    return ApiResponse.ok({
      recruitmentHosting: {
        enabled,
        deploymentEnabled: enabled,
        deploymentOwnership: lock.ownership,
        operatorSelfReport: lock.selfReport,
      },
    })
  }
}
