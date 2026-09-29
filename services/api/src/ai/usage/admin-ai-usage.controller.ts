import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../../common/dto/api-response.dto'
import { Roles } from '../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { PrismaService } from '../../prisma/prisma.service'
import { AiBudgetService } from './ai-budget.service'
import { aiUsageNow, beijingDayKey } from './ai-usage-meter'
import { buildAiUsageDailySummary, type AiUsageDailySummary } from './ai-usage-summary'

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET /api/v1/admin/ai-usage/daily?day=YYYY-MM-DD（省略 = 北京时间今天）
 *
 * 只读，仅管理员。按功能 / 厂商 / 终端 / 机构汇总当日 AI 金额、调用数、未计量数，
 * 外加三档上限与是否触顶。字段白名单见 ai-usage-summary.ts，不含会员号。
 */
@Controller('admin/ai-usage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminAiUsageController {
  constructor(private readonly prisma: PrismaService, private readonly budget: AiBudgetService) {}

  @Get('daily')
  async daily(@Query('day') day?: string): Promise<ApiResponse<AiUsageDailySummary>> {
    const target = day?.trim() || beijingDayKey(aiUsageNow())
    if (!DAY_PATTERN.test(target) || Number.isNaN(Date.parse(`${target}T00:00:00Z`))) {
      throw new BadRequestException({ error: { code: 'AI_USAGE_DAY_INVALID', message: '日期格式应为 YYYY-MM-DD' } })
    }
    return ApiResponse.ok(await buildAiUsageDailySummary(this.prisma, target, this.budget.limits))
  }
}
