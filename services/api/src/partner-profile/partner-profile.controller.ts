import { Controller, Get, Patch, Body, Req, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { AuditService } from '../audit/audit.service'
import { PartnerProfileService } from './partner-profile.service'
import { UpdatePartnerProfileDto } from './dto/update-partner-profile.dto'
import type { PartnerProfile } from './partner-profile.types'

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
 * 合作机构资料（Sprint 1 / Task 4）。路由前缀 /api/v1/partner/profile。
 * **Partner 鉴权**（JwtAuthGuard + RolesGuard + @Roles('partner')），orgId 强制取自 JWT。
 *
 * 合规：仅机构主体资料维护，不涉招聘闭环；保存写审计。
 */
@Controller('partner/profile')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('partner')
export class PartnerProfileController {
  constructor(
    private readonly profile: PartnerProfileService,
    private readonly audit: AuditService,
  ) {}

  /** 读取本机构资料。 */
  @Get()
  async get(@CurrentUser() user: AuthedUser): Promise<ApiResponse<PartnerProfile>> {
    return ApiResponse.ok(await this.profile.getProfile(user))
  }

  /** 更新本机构资料（写审计 partner.profile_update）。 */
  @Patch()
  async update(
    @Body() dto: UpdatePartnerProfileDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<PartnerProfile>> {
    const { changedFields, before, after, detail } = await this.profile.updateProfile(user, dto)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'partner.profile_update',
      targetType: 'partner',
      targetId: detail.id,
      payload: { orgId: detail.id, changedFields, before, after },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(detail)
  }
}
