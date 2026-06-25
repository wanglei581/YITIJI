import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { AdminOrdersReadonlyService } from './admin-orders-readonly.service'

const VALID_TYPES = new Set(['print', 'scan', 'photo', 'ai'])
const VALID_PAY_STATUS = new Set(['unpaid', 'paid', 'refunded', 'failed'])
const VALID_TASK_STATUS = new Set(['pending', 'claimed', 'printing', 'completed', 'failed', 'cancelled'])

function safeInt(value: string | undefined, defaultValue: number, min: number, max: number): number {
  const n = value !== undefined ? Number(value) : defaultValue
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : defaultValue
}

/**
 * Admin 订单只读视图。
 *
 * 路由只提供 GET:
 *   GET /admin/orders
 *   GET /admin/orders/:id
 *
 * 当前支付/退款域未上线,本模块只读展示 Order + PrintTask 安全元数据,
 * 不提供支付状态修改、退款、任务状态写入等运营动作。
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminOrdersReadonlyController {
  constructor(private readonly orders: AdminOrdersReadonlyService) {}

  @Get('admin/orders')
  list(
    @Query('type') type?: string,
    @Query('payStatus') payStatus?: string,
    @Query('taskStatus') taskStatus?: string,
    @Query('search') search?: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') sizeStr?: string,
  ) {
    return this.orders.list({
      type: type && VALID_TYPES.has(type) ? type : undefined,
      payStatus: payStatus && VALID_PAY_STATUS.has(payStatus) ? payStatus : undefined,
      taskStatus: taskStatus && VALID_TASK_STATUS.has(taskStatus) ? taskStatus : undefined,
      search: search?.trim() || undefined,
      page: safeInt(pageStr, 1, 1, 10_000),
      pageSize: safeInt(sizeStr, 20, 1, 100),
    })
  }

  @Get('admin/orders/:id')
  getById(@Param('id') id: string) {
    return this.orders.getById(id)
  }
}
