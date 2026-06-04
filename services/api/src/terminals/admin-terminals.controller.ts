// ============================================================
// Admin Terminals Controller — 契约 C1 (HIGH-4)
//
// Route (prefixed with /api/v1):
//   GET /admin/terminals   — admin-only, lists terminals + latest heartbeat + online
//
// 消费方：Agent3 admin 设备页。响应字段/类型必须严格匹配契约 C1。
// ============================================================

import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { TerminalsService, type AdminTerminalView } from './terminals.service'

@Controller('admin/terminals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminTerminalsController {
  constructor(private readonly terminalsService: TerminalsService) {}

  // GET /api/v1/admin/terminals
  @Get()
  async list(): Promise<ApiResponse<{ terminals: AdminTerminalView[] }>> {
    return ApiResponse.ok(await this.terminalsService.listTerminalsForAdmin())
  }
}
