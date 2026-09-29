import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { isIP } from 'node:net'
import { resolveClientIpOrUnknown } from '../common/client-ip'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { AdminInternalAccountsService } from './admin-internal-accounts.service'
import { BackupAdminCreateService } from './backup-admin-create.service'
import {
  ListInternalAccountsDto,
  SetInternalAccountStatusDto,
  StartBackupAdminDto,
  VerifyBackupAdminDto,
} from './dto/internal-accounts.dto'
import type { InternalAccountRequestContext } from './internal-accounts.types'

type ContextRequest = Request & { requestId?: string }

function requestContext(request: ContextRequest, deviceId?: string): InternalAccountRequestContext {
  const ip = resolveClientIpOrUnknown(request)
  const ua = request.headers['user-agent']
  const userAgent = (Array.isArray(ua) ? ua[0] : ua)?.trim().slice(0, 512) || null
  return {
    ip,
    ipAddress: ip.length <= 64 && isIP(ip) !== 0 ? ip : null,
    userAgent,
    requestId: request.requestId?.trim().slice(0, 128) || null,
    ...(deviceId ? { deviceId } : {}),
  }
}

/**
 * 内部账号名册（3.9，仅管理员）：
 *   GET   /admin/internal-accounts                         名册（admin / partner / kiosk，不含已删除）
 *   POST  /admin/internal-accounts/backup-admin/start      建备用管理员第一步：本人密码 + 给备用手机号发码
 *   POST  /admin/internal-accounts/backup-admin/verify     第二步：验证码通过即建号（默认停用）
 *   PATCH /admin/internal-accounts/:id/status              启停管理员账号（合作机构账号仍走 /admin/orgs）
 */
@Controller('admin/internal-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminInternalAccountsController {
  constructor(
    private readonly accounts: AdminInternalAccountsService,
    private readonly backupAdmin: BackupAdminCreateService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() query: ListInternalAccountsDto) {
    return this.accounts.list({
      role: query.role,
      enabled: query.enabled === undefined ? undefined : query.enabled === 'true',
      orgId: query.orgId,
      keyword: query.keyword,
      page: query.page,
      pageSize: query.pageSize,
    })
  }

  @Post('backup-admin/start')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  startBackupAdmin(
    @Body() dto: StartBackupAdminDto,
    @CurrentUser() admin: AuthedUser,
    @Req() request: ContextRequest,
  ) {
    return this.backupAdmin.start(admin, dto, requestContext(request, dto.deviceId))
  }

  @Post('backup-admin/verify')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  verifyBackupAdmin(
    @Body() dto: VerifyBackupAdminDto,
    @CurrentUser() admin: AuthedUser,
    @Req() request: ContextRequest,
  ) {
    return this.backupAdmin.verify(admin, dto, requestContext(request))
  }

  @Patch(':id/status')
  @Header('Cache-Control', 'no-store')
  setStatus(
    @Param('id') id: string,
    @Body() dto: SetInternalAccountStatusDto,
    @CurrentUser() admin: AuthedUser,
    @Req() request: ContextRequest,
  ) {
    return this.accounts.setStatus(admin, id, dto, requestContext(request))
  }
}
