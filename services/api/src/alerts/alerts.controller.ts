import { Controller, Get, Patch, Param, Query, Body, Req, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { AuditService } from '../audit/audit.service'
import { AlertsService } from './alerts.service'
import { ListAlertsQueryDto } from './dto/list-alerts-query.dto'
import { UpdateAlertStatusDto } from './dto/update-alert-status.dto'
import type { AdminAlertDetail, AdminAlertsListResponse } from './alerts.types'

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
 * Admin 告警中心（Sprint 1 / Task 3）。路由前缀 /api/v1/admin/alerts。
 * JwtAuthGuard + RolesGuard，仅 admin。
 *
 * 合规：处理 / 忽略只是运营状态记录，不远程控制设备；状态变更同步写审计。
 */
@Controller('admin/alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
  ) {}

  /** 告警列表（筛选 + 分页）。 */
  @Get()
  async list(@Query() query: ListAlertsQueryDto): Promise<ApiResponse<AdminAlertsListResponse>> {
    return ApiResponse.ok(await this.alerts.list(query))
  }

  /** 告警详情。 */
  @Get(':id')
  async detail(@Param('id') id: string): Promise<ApiResponse<AdminAlertDetail>> {
    return ApiResponse.ok(await this.alerts.getById(id))
  }

  /** 处理告警：标记 处理中 / 已处理 / 已忽略（运营状态记录，不远程控制设备）。 */
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateAlertStatusDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<AdminAlertDetail>> {
    const { previous, detail } = await this.alerts.updateStatus(id, dto.status, dto.note, user.userId)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'alert.status_change',
      targetType: 'alert',
      targetId: id,
      payload: {
        alertNo: detail.alertNo,
        fromStatus: previous.status,
        toStatus: dto.status,
        note: dto.note ?? null,
      },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(detail)
  }
}
