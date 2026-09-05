import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { ORDER_PAY_STATUSES } from '../payment/payment.types'
import { AdminOrdersReadonlyService } from './admin-orders-readonly.service'

const VALID_TYPES = ['print', 'scan', 'photo', 'ai'] as const
/** 支付状态白名单唯一来源，禁止在此就地再写一份（历史事故见 payment.types.ts 注释）。 */
const VALID_PAY_STATUS = ORDER_PAY_STATUSES
const VALID_TASK_STATUS = ['pending', 'claimed', 'printing', 'completed', 'failed', 'cancelled', 'abandoned'] as const
// M1/M2：渠道与取件状态筛选。
// channel 不含「未标注」——那是 null，语义是「无法判定」而非一个渠道，不作为可选筛选值。
const VALID_CHANNELS = ['kiosk', 'miniapp_cloud'] as const
const VALID_PICKUP_STATUS = ['none', 'pending', 'claimed', 'used', 'expired', 'cancelled'] as const

function safeInt(value: string | undefined, defaultValue: number, min: number, max: number): number {
  const n = value !== undefined ? Number(value) : defaultValue
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : defaultValue
}

/**
 * 未知筛选值必须明确拒绝，**绝不能静默丢成 undefined**。
 *
 * 旧行为：白名单外的值被丢弃 → 查询退化成无筛选 → 返回全量。
 * 于是「按退款中筛选」在页面上呈现为「全部 200 条订单都在退款中」——
 * 一个没有任何报错的假结论。宁可 400 让前端暴露契约不一致，
 * 也不能给运营一个看起来正常、实则错误的列表。
 */
function pickRefundRequired(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === '') return undefined
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  throw new BadRequestException({
    error: {
      code: 'INVALID_FILTER_VALUE',
      message: '筛选参数 refundRequired 取值不受支持',
      details: ['refundRequired 允许的取值：true | false | 1 | 0'],
    },
  })
}

function pickFilter(
  field: string,
  raw: string | undefined,
  allowed: readonly string[],
): string | undefined {
  if (raw === undefined || raw === '') return undefined
  if (allowed.includes(raw)) return raw
  throw new BadRequestException({
    error: {
      code: 'INVALID_FILTER_VALUE',
      message: `筛选参数 ${field} 取值不受支持`,
      details: [`${field} 允许的取值：${allowed.join(' | ')}`],
    },
  })
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
    @Query('channel') channel?: string,
    @Query('pickupStatus') pickupStatus?: string,
    @Query('search') search?: string,
    @Query('refundRequired') refundRequiredRaw?: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') sizeStr?: string,
  ) {
    const refundRequired = pickRefundRequired(refundRequiredRaw)
    const resolvedPayStatus = pickFilter('payStatus', payStatus, VALID_PAY_STATUS)
    if (refundRequired === true && resolvedPayStatus && resolvedPayStatus !== 'paid') {
      throw new BadRequestException({
        error: {
          code: 'INVALID_FILTER_VALUE',
          message: '待退款筛选仅适用于已支付订单',
          details: ['refundRequired=true 时 payStatus 只能是 paid 或省略'],
        },
      })
    }
    return this.orders.list({
      type: pickFilter('type', type, VALID_TYPES),
      payStatus: resolvedPayStatus,
      taskStatus: pickFilter('taskStatus', taskStatus, VALID_TASK_STATUS),
      channel: pickFilter('channel', channel, VALID_CHANNELS),
      pickupStatus: pickFilter('pickupStatus', pickupStatus, VALID_PICKUP_STATUS),
      search: search?.trim() || undefined,
      refundRequired,
      page: safeInt(pageStr, 1, 1, 10_000),
      pageSize: safeInt(sizeStr, 20, 1, 100),
    })
  }

  @Get('admin/orders/:id')
  getById(@Param('id') id: string) {
    return this.orders.getById(id)
  }
}
