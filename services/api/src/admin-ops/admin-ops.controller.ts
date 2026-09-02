import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { AdminAlertActionsService } from './admin-alert-actions.service'
import { parseAlertListView } from './derived-alert-identity'
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
 *   GET  /admin/print-tasks?status=&page=&pageSize=   打印任务流水
 *   GET  /admin/alerts?view=open|acknowledged|suppressed|all
 *   POST /admin/alerts/disposition                    确认 / 静默 / 关闭
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminOpsController {
  constructor(
    private readonly ops: AdminOpsService,
    private readonly alertActions: AdminAlertActionsService,
  ) {}

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
  listAlerts(@Query('view') viewStr?: string) {
    const view = parseAlertListView(viewStr)
    if (!view) {
      throw new BadRequestException({
        error: { code: 'ALERT_VIEW_INVALID', message: 'view 必须是 open / acknowledged / suppressed / all' },
      })
    }
    return this.ops.listDerivedAlerts(view)
  }

  @Post('admin/alerts/disposition')
  @HttpCode(HttpStatus.OK)
  disposeAlert(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.alertActions.dispose(body ?? {}, user.userId)
  }
}
