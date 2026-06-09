import {
  Controller, Get, Patch, Post, Param, Query, Body, Req, UseGuards,
} from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { AuditService } from '../audit/audit.service'
import { AdminOrdersService } from './admin-orders.service'
import { ListOrdersQueryDto } from './dto/list-orders-query.dto'
import { UpdateOrderStatusDto } from './dto/update-order-status.dto'
import { RefundOrderDto } from './dto/refund-order.dto'
import type { AdminOrderDetail, AdminOrdersListResponse } from './admin-orders.types'

// 审计上下文提取（与 files/content controller 同套路）。
interface AuditReq {
  headers: Record<string, string | string[] | undefined>
  requestId?: string
  ip?: string
  socket?: { remoteAddress?: string }
}
function extractIp(req: AuditReq): string | null {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]?.trim() ?? null
  if (Array.isArray(fwd) && fwd.length > 0) return fwd[0] ?? null
  return req.ip ?? req.socket?.remoteAddress ?? null
}
function extractUa(req: AuditReq): string | null {
  const ua = req.headers['user-agent']
  if (typeof ua === 'string') return ua.slice(0, 256)
  if (Array.isArray(ua) && ua[0]) return ua[0].slice(0, 256)
  return null
}

/**
 * Admin 订单管理（Sprint 1 / Task 2）。路由前缀 /api/v1/admin/orders。
 * 全部受 JwtAuthGuard + RolesGuard 保护，仅 admin 角色可访问。
 *
 * 合规：线下打印运营订单管理，不接真实支付；改状态 / 退款均同步写审计。
 */
@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminOrdersController {
  constructor(
    private readonly orders: AdminOrdersService,
    private readonly audit: AuditService,
  ) {}

  /** 订单列表（筛选 + 分页）。 */
  @Get()
  async list(@Query() query: ListOrdersQueryDto): Promise<ApiResponse<AdminOrdersListResponse>> {
    return ApiResponse.ok(await this.orders.list(query))
  }

  /** 订单详情（含关联打印任务参数 + 状态日志）。 */
  @Get(':id')
  async detail(@Param('id') id: string): Promise<ApiResponse<AdminOrderDetail>> {
    return ApiResponse.ok(await this.orders.getById(id))
  }

  /**
   * 改订单状态：payStatus（支付状态，线下运营标记，不接真实支付）和/或
   * taskStatus（运营视图任务状态，仅改 Order 列，不动 PrintTask）。至少其一。
   */
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<AdminOrderDetail>> {
    const { previous, detail } = await this.orders.updateStatus(id, {
      ...(dto.payStatus !== undefined ? { payStatus: dto.payStatus } : {}),
      ...(dto.taskStatus !== undefined ? { taskStatus: dto.taskStatus } : {}),
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'order.status_change',
      targetType: 'order',
      targetId: id,
      payload: {
        orderNo: detail.orderNo,
        ...(dto.payStatus !== undefined ? { fromPayStatus: previous.payStatus, toPayStatus: dto.payStatus } : {}),
        ...(dto.taskStatus !== undefined ? { fromTaskStatus: previous.taskStatus, toTaskStatus: dto.taskStatus } : {}),
        note: dto.note ?? null,
      },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(detail)
  }

  /** 退款（仅 paid 可退）。只置状态 + 原因，不发生真实资金流。 */
  @Post(':id/refund')
  async refund(
    @Param('id') id: string,
    @Body() dto: RefundOrderDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<AdminOrderDetail>> {
    const { previousPayStatus, detail } = await this.orders.refund(id, dto.reason)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'order.refund',
      targetType: 'order',
      targetId: id,
      payload: {
        orderNo: detail.orderNo,
        fromPayStatus: previousPayStatus,
        reason: dto.reason,
        amountCents: detail.amountCents, // 本阶段恒为 0；不发生真实资金流
      },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(detail)
  }
}
