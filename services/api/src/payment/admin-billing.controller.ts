// Admin 计费配置端点（W-C part1）。
//
// 端点（全局前缀 /api/v1；JwtAuthGuard + admin role，与 admin-order-actions 同口径）：
//   GET /admin/billing/price-config              全量价目（含 inactive + 时间戳）
//   PUT /admin/billing/price-config/:serviceKey  改价/启停（唯一合法改价路径，必审计）
//   GET /admin/billing/reconciliation            本地对账报表（账本交叉核对 + 差异清单；只读）
//
// 合规/安全：只做价目管理与对账核查，无任何支付凭证字段；改价审计带 old/new 快照；
// 本波不开放新建/删除价目项。
import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { AdminBillingService } from './admin-billing.service'
import { ReconciliationService } from './reconciliation.service'
import { AdminReconciliationQueryDto, AdminUpdatePriceConfigDto } from './dto/admin-billing.dto'

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminBillingController {
  constructor(
    private readonly billing: AdminBillingService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Get('admin/billing/price-config')
  async list() {
    return this.billing.listPriceConfig()
  }

  @Put('admin/billing/price-config/:serviceKey')
  async update(
    @Param('serviceKey') serviceKey: string,
    @Body() body: AdminUpdatePriceConfigDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.billing.updatePriceConfig(serviceKey, body, user.userId)
  }

  @Get('admin/billing/reconciliation')
  async reconcile(@Query() query: AdminReconciliationQueryDto) {
    return this.reconciliation.report({ from: query.from, to: query.to, nowMs: Date.now() })
  }
}
