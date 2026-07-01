import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { AdminOrdersReadonlyService } from './admin-orders-readonly.service'

const VALID_TYPES = new Set(['print', 'scan', 'photo', 'ai'])
const VALID_PAY_STATUS = new Set(['unpaid', 'paid', 'refunded', 'failed'])
const VALID_TASK_STATUS = new Set(['pending', 'claimed', 'printing', 'completed', 'failed', 'cancelled'])

function safeInt(value: string | undefined, defaultValue: number, min: number, max: number): number {
  const n = value !== undefined ? Number(value) : defaultValue
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : defaultValue
}

interface AuditReq {
  headers: Record<string, string | string[] | undefined>
  requestId?: string
  ip?: string
  socket?: { remoteAddress?: string }
}

function cleanOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null
}

function bodyObject(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
}

function extractIp(req: AuditReq): string | null {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim()
  return req.ip ?? req.socket?.remoteAddress ?? null
}

function extractUa(req: AuditReq): string | null {
  const ua = req.headers['user-agent']
  return typeof ua === 'string' ? ua : null
}

/**
 * Admin 订单视图 + 打印运营动作。
 *
 * 路由:
 *   GET /admin/orders
 *   GET /admin/orders/:id
 *   POST /admin/orders/:id/cancel
 *   POST /admin/orders/:id/reassign
 *
 * 当前支付/退款域未上线,本模块只读展示金额与支付状态;
 * 仅提供打印任务取消 / 重分配两个运营动作,且不暴露文件 URL、hash 或内部参数。
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

  @Post('admin/orders/:id/cancel')
  cancelPrintTask(
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const body = bodyObject(rawBody)
    return this.orders.cancelPrintTask(id, {
      actorId: user.userId,
      actorRole: user.role,
      reason: cleanOptionalText(body['reason'], 200),
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
  }

  @Post('admin/orders/:id/reassign')
  reassignPrintTask(
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const body = bodyObject(rawBody)
    const terminalId = cleanOptionalText(body['terminalId'], 128) ?? ''
    return this.orders.reassignPrintTask(id, terminalId, {
      actorId: user.userId,
      actorRole: user.role,
      reason: cleanOptionalText(body['reason'], 200),
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
  }
}
