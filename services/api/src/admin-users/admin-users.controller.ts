import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { isIP } from 'node:net'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { AdminUsersService } from './admin-users.service'
import type { AdminUserAuditContext, AdminUserListQuery } from './admin-users.types'
import { ChangeAdminUserStatusDto } from './dto/change-admin-user-status.dto'
import { ListAdminUsersDto } from './dto/list-admin-users.dto'

type AuditRequest = Request & { requestId?: string }

function firstHeader(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value
  return first?.trim() || null
}

function limitedHeader(value: string | string[] | undefined, maxLength: number): string | null {
  return firstHeader(value)?.slice(0, maxLength) || null
}

function safeIpAddress(request: AuditRequest): string | null {
  const candidates = [request.ip, request.socket.remoteAddress]
  return candidates.find((candidate): candidate is string =>
    Boolean(candidate && candidate.length <= 64 && isIP(candidate) !== 0),
  ) ?? null
}

function auditContextOf(admin: AuthedUser, request: AuditRequest): AdminUserAuditContext {
  return {
    actorId: admin.userId,
    actorRole: admin.role,
    ipAddress: safeIpAddress(request),
    userAgent: limitedHeader(request.headers['user-agent'], 512),
    requestId: request.requestId?.trim().slice(0, 128) || null,
  }
}

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Query() query: ListAdminUsersDto,
    @CurrentUser() admin: AuthedUser,
    @Req() request: AuditRequest,
  ) {
    const serviceQuery: AdminUserListQuery = {
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword,
      phone: query.phone,
      enabled: query.enabled === undefined ? undefined : query.enabled === 'true',
      registeredFrom: query.registeredFrom,
      registeredTo: query.registeredTo,
    }
    return this.service.list(serviceQuery, auditContextOf(admin, request))
  }

  @Get(':endUserId')
  @Header('Cache-Control', 'no-store')
  async getDetail(
    @Param('endUserId') endUserId: string,
    @CurrentUser() admin: AuthedUser,
    @Req() request: AuditRequest,
  ) {
    return this.service.getDetail(endUserId, auditContextOf(admin, request))
  }

  /**
   * 停用终端用户。停用后该账号无法登录，已登录会话在下一次请求时被
   * EndUserAuthGuard 拒绝并清出 Redis（common/guards/end-user-auth.guard.ts:61-71）。
   *
   * 注意：本端点**不影响已付款的打印订单** —— 取件链路按终端 + 取件码放行，
   * 不查用户状态（print-jobs.controller.ts:33、pickup-order.service.ts:41）。
   * 这是有意的产品决策：停用是阻止继续消费，不是没收已付费的服务。
   */
  @Post(':endUserId/disable')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async disable(
    @Param('endUserId') endUserId: string,
    @Body() dto: ChangeAdminUserStatusDto,
    @CurrentUser() admin: AuthedUser,
    @Req() request: AuditRequest,
  ) {
    return this.service.setStatus(endUserId, 'disable', dto.reason, auditContextOf(admin, request))
  }

  /** 恢复被停用的终端用户。只接受 status='disabled'；closing / anonymized 一律 409。 */
  @Post(':endUserId/restore')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async restore(
    @Param('endUserId') endUserId: string,
    @Body() dto: ChangeAdminUserStatusDto,
    @CurrentUser() admin: AuthedUser,
    @Req() request: AuditRequest,
  ) {
    return this.service.setStatus(endUserId, 'restore', dto.reason, auditContextOf(admin, request))
  }
}
