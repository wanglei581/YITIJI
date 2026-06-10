import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { AdminOpsService } from './admin-ops.service'

/** Number() 对非数字返回 NaN;安全解析并夹紧范围。 */
function safeInt(value: string | undefined, defaultValue: number, min: number, max: number): number {
  const n = value !== undefined ? Number(value) : defaultValue
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : defaultValue
}

const VALID_TASK_STATUS = new Set(['pending', 'claimed', 'printing', 'completed', 'failed'])

/**
 * Admin 运营视图(阶段1E)。
 *
 * 路由表(全部含 /api/v1 前缀,Bearer + admin):
 *   GET /admin/print-tasks?status=&page=&pageSize=   打印任务流水(安全元数据,无文件链接/金额)
 *   GET /admin/alerts                                 派生告警(终端离线/打印机异常/近24h打印失败)
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminOpsController {
  constructor(private readonly ops: AdminOpsService) {}

  @Get('admin/print-tasks')
  listPrintTasks(
    @Query('status') status?: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') sizeStr?: string,
  ) {
    return this.ops.listPrintTasks({
      status: status && VALID_TASK_STATUS.has(status) ? status : undefined,
      page: safeInt(pageStr, 1, 1, 10_000),
      pageSize: safeInt(sizeStr, 20, 1, 100),
    })
  }

  @Get('admin/alerts')
  listAlerts() {
    return this.ops.listDerivedAlerts()
  }
}
