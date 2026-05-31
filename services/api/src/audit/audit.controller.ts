import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { AuditService } from './audit.service'
import type { AuditLogListResponse } from './audit.types'

/**
 * 路由:
 *   GET /api/v1/admin/audit-logs?action=&actorId=&targetType=&targetId=&startAt=&endAt=&limit=&offset=
 *
 * 仅 admin 可访问。Audit 列表本身不可写、不可删(controller 无 POST/PUT/DELETE)。
 */
@Controller('admin/audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(
    @Query('action') action?: string,
    @Query('actorId') actorId?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('startAt') startAt?: string,
    @Query('endAt') endAt?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ApiResponse<AuditLogListResponse>> {
    return ApiResponse.ok(
      await this.audit.list({
        action,
        actorId,
        targetType,
        targetId,
        startAt,
        endAt,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      }),
    )
  }
}
