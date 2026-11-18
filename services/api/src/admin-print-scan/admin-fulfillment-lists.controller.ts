/**
 * 管理员只读履约列表。
 *
 *   GET /admin/print-scan/copy-jobs            屏上复印（CopyJob）
 *   GET /admin/print-scan/material-pack-orders 材料包订单（Order + OrderItem）
 *
 * 与统一任务聚合分开。聚合端点对这两类仍返回 implemented=false。
 * 不返回文件地址、文件编号、手机号或取件码。
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { AdminFulfillmentListsService, type AdminFulfillmentListPage } from './admin-fulfillment-lists'
import { ListFulfillmentQueryDto } from './dto/list-fulfillment-query.dto'

function safeInt(value: string | undefined, defaultValue: number, min: number, max: number): number {
  const n = value !== undefined ? Number(value) : defaultValue
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : defaultValue
}

function normalize(query: ListFulfillmentQueryDto) {
  return {
    status: query.status,
    terminalId: query.terminalId,
    page: safeInt(query.page, 1, 1, 10_000),
    pageSize: safeInt(query.pageSize, 20, 1, 100),
  }
}

@Controller('admin/print-scan')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminFulfillmentListsController {
  constructor(private readonly lists: AdminFulfillmentListsService) {}

  @Get('copy-jobs')
  async listCopyJobs(@Query() query: ListFulfillmentQueryDto): Promise<ApiResponse<AdminFulfillmentListPage>> {
    return ApiResponse.ok(await this.lists.listCopyJobs(normalize(query)))
  }

  @Get('material-pack-orders')
  async listMaterialPackOrders(@Query() query: ListFulfillmentQueryDto): Promise<ApiResponse<AdminFulfillmentListPage>> {
    return ApiResponse.ok(await this.lists.listMaterialPackOrders(normalize(query)))
  }
}
