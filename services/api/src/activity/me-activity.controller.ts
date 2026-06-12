import { Controller, Delete, Get, Param, Query, Req, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { AuditService } from '../audit/audit.service'
import { parseMemberPageQuery } from '../common/utils/member-page'
import { ActivityService } from './activity.service'

interface ReqLike {
  headers?: Record<string, string | string[] | undefined>
  ip?: string
  requestId?: string
}

function ipOf(req: ReqLike): string | null {
  const fwd = req.headers?.['x-forwarded-for']
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim()
  return req.ip ?? null
}

function uaOf(req: ReqLike): string | null {
  const ua = req.headers?.['user-agent']
  return typeof ua === 'string' ? ua : null
}

/**
 * 「我的」浏览 / 外部跳转记录（/api/v1/me/browse-logs、/me/external-jump-logs）。
 *
 * 与 member-assets 同口径：EndUserAuthGuard 强制会员、endUserId 只来自校验后
 * token、游标分页封顶 50、删除统一 404 不泄露存在性、删除写审计。
 * 返回的只有目标快照与时间——没有也不会有投递/预约结果字段。
 */
@Controller('me')
@UseGuards(EndUserAuthGuard)
export class MeActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
  ) {}

  @Get('browse-logs')
  async browseLogs(
    @CurrentEndUser() user: AuthedEndUser,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
    @Query('targetType') targetType?: string,
  ) {
    return ApiResponse.ok(
      await this.activity.listBrowse(user.endUserId, parseMemberPageQuery(cursor, pageSize), targetType || undefined),
    )
  }

  @Get('external-jump-logs')
  async jumpLogs(
    @CurrentEndUser() user: AuthedEndUser,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
    @Query('targetType') targetType?: string,
  ) {
    return ApiResponse.ok(
      await this.activity.listJumps(user.endUserId, parseMemberPageQuery(cursor, pageSize), targetType || undefined),
    )
  }

  @Delete('browse-logs/:id')
  async deleteBrowseLog(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('id') id: string,
    @Req() req: ReqLike,
  ) {
    const result = await this.activity.deleteBrowse(user.endUserId, id)
    await this.audit.write({
      actorId: null, // AuditLog.actorId FK 指向运营 User，会员动作记 payload.endUserId
      actorRole: 'enduser',
      action: 'member.browse_log_delete',
      targetType: 'browse_log',
      targetId: id,
      payload: { endUserId: user.endUserId, logTargetType: result.targetType },
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok({ deleted: true })
  }

  @Delete('external-jump-logs/:id')
  async deleteJumpLog(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('id') id: string,
    @Req() req: ReqLike,
  ) {
    const result = await this.activity.deleteJump(user.endUserId, id)
    await this.audit.write({
      actorId: null,
      actorRole: 'enduser',
      action: 'member.external_jump_log_delete',
      targetType: 'external_jump_log',
      targetId: id,
      payload: { endUserId: user.endUserId, logTargetType: result.targetType },
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok({ deleted: true })
  }
}
