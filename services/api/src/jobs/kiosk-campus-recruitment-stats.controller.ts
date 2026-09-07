import { Controller, Get } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { TerminalScopedThrottle } from '../common/throttler/terminal-throttle'
import { CampusRecruitmentStatsService } from './campus-recruitment-stats.service'
import type { CampusRecruitmentStatsData } from './campus-recruitment-stats.rules'

/**
 * GET /api/v1/kiosk/campus/recruitment-stats
 *
 * 一体机校园招聘数据页的只读聚合。匿名可读，按台限流。
 * 不调用计费 AI；只读已审核已发布的招聘会与校招岗位。
 */
@Controller('kiosk/campus')
export class KioskCampusRecruitmentStatsController {
  constructor(private readonly stats: CampusRecruitmentStatsService) {}

  @Get('recruitment-stats')
  @TerminalScopedThrottle(30)
  async getRecruitmentStats(): Promise<ApiResponse<CampusRecruitmentStatsData>> {
    return ApiResponse.ok(await this.stats.getStats())
  }
}
