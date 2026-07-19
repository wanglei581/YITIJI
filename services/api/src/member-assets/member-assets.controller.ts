import { Controller, Delete, Get, Param, Query, Req, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { AuditService } from '../audit/audit.service'
import { parseMemberPageQuery } from '../common/utils/member-page'
import { MemberAssetsService } from './member-assets.service'
import type { MemberAiRecordItem, MemberAssetPage, MemberDocumentItem, MemberResumeItem } from './member-assets.types'

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
 * 会员个人资产中心接口（Phase C-2B 只读 → C-2D 真实管理）。路由前缀 /api/v1/me/*。
 *
 * 全部受 EndUserAuthGuard 保护：
 * - 必须携带有效会员 token（Bearer，audience=enduser，且 Redis 会话有效）。
 * - 匿名 / 缺 token / 失效 token / 内部运营 token → 401（MEMBER_MISSING_TOKEN /
 *   MEMBER_TOKEN_INVALID / MEMBER_SESSION_EXPIRED）。
 * - endUserId 来自校验后的 token（req.endUser），不接受任何外部传入的用户 id，
 *   service 只按本人 endUserId 读写 → 跨用户越权天然不可能。
 *
 * C-2D：列表统一游标分页（?cursor=&pageSize=，封顶 50）；新增 AI 记录删除（硬删 + 审计）。
 * 审计注意：AuditLog.actorId 外键指向运营 User 表，会员动作 actorId 写 null、
 * actorRole='enduser'，endUserId 放 payload（否则 FK 失败审计行写不进去）。
 */
@Controller('me')
@UseGuards(EndUserAuthGuard)
export class MemberAssetsController {
  constructor(
    private readonly assets: MemberAssetsService,
    private readonly audit: AuditService,
  ) {}

  @Get('resumes')
  async resumes(
    @CurrentEndUser() user: AuthedEndUser,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ApiResponse<MemberAssetPage<MemberResumeItem>>> {
    return ApiResponse.ok(await this.assets.listResumes(user.endUserId, parseMemberPageQuery(cursor, pageSize)))
  }

  @Get('documents')
  async documents(
    @CurrentEndUser() user: AuthedEndUser,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ApiResponse<MemberAssetPage<MemberDocumentItem>>> {
    return ApiResponse.ok(await this.assets.listDocuments(user.endUserId, parseMemberPageQuery(cursor, pageSize)))
  }

  @Get('ai-records')
  async aiRecords(
    @CurrentEndUser() user: AuthedEndUser,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ApiResponse<MemberAssetPage<MemberAiRecordItem>>> {
    return ApiResponse.ok(await this.assets.listAiRecords(user.endUserId, parseMemberPageQuery(cursor, pageSize)))
  }

  /**
   * 删除本人一条 AI 记录（C-2D）。硬删（payload 含敏感内容）；parse 行级联删同任务
   * 全部派生结果和 JobAiSession，job_fit 行仅级联同任务 match 会话。
   * 删他人 / 不存在统一 404（service 层归属校验）；动作写审计日志留痕。
   */
  @Delete('ai-records/:id')
  async deleteAiRecord(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('id') id: string,
    @Req() req: ReqLike,
  ): Promise<ApiResponse<{ deleted: true; deletedCount: number }>> {
    const result = await this.assets.deleteAiRecord(user.endUserId, id)
    await this.audit.write({
      actorId: null, // AuditLog.actorId FK 指向运营 User，会员动作记 payload.endUserId
      actorRole: 'enduser',
      action: 'member.ai_record_delete',
      targetType: 'ai_resume_result',
      targetId: id,
      payload: {
        endUserId: user.endUserId,
        taskId: result.taskId,
        kind: result.kind,
        deletedCount: result.deletedCount,
        cascade: result.kind === 'parse',
      },
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok({ deleted: true, deletedCount: result.deletedCount })
  }

  /**
   * 删除本人一条简历记录（Wave 2）。
   * kind 限定 parse/generate；parse 行级联删同任务所有派生行和 JobAiSession。
   * 删他人 / 不存在统一 404；动作写审计日志。
   */
  @Delete('resumes/:id')
  async deleteResume(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('id') id: string,
    @Req() req: ReqLike,
  ): Promise<ApiResponse<{ deleted: true; deletedCount: number }>> {
    const result = await this.assets.deleteResume(user.endUserId, id)
    await this.audit.write({
      actorId: null,
      actorRole: 'enduser',
      action: 'member.resume_delete',
      targetType: 'ai_resume_result',
      targetId: id,
      payload: {
        endUserId: user.endUserId,
        taskId: result.taskId,
        kind: result.kind,
        deletedCount: result.deletedCount,
        cascade: result.kind === 'parse',
      },
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok({ deleted: true, deletedCount: result.deletedCount })
  }
}
