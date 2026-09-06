import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { DailyReportDto } from './dto/daily-report.dto'
import { DailyBriefService, type DailyReport } from './daily-brief.service'

@Controller('assistant')
@UseGuards(EndUserAuthGuard)
export class DailyBriefController {
  constructor(private readonly dailyBrief: DailyBriefService) {}

  @Post('daily-report')
  async create(@CurrentEndUser() user: AuthedEndUser, @Body() dto: DailyReportDto): Promise<DailyReport> {
    return this.dailyBrief.create(user.endUserId, dto.city)
  }
}
