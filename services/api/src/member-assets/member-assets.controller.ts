import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { MemberAssetsService } from './member-assets.service'
import type { MemberAiRecordItem, MemberDocumentItem, MemberResumeItem } from './member-assets.types'

/**
 * 会员个人资产中心只读接口（Phase C-2B）。路由前缀 /api/v1/me/*。
 *
 * 全部受 EndUserAuthGuard 保护：
 * - 必须携带有效会员 token（Bearer，audience=enduser，且 Redis 会话有效）。
 * - 匿名 / 缺 token / 失效 token / 内部运营 token → 401（MEMBER_MISSING_TOKEN /
 *   MEMBER_TOKEN_INVALID / MEMBER_SESSION_EXPIRED）。
 * - endUserId 来自校验后的 token（req.endUser），不接受任何外部传入的用户 id，
 *   service 只按本人 endUserId 查询 → 跨用户越权天然不可能。
 *
 * 只读、不改任何数据；只回元数据；空列表返回 []。
 */
@Controller('me')
@UseGuards(EndUserAuthGuard)
export class MemberAssetsController {
  constructor(private readonly assets: MemberAssetsService) {}

  @Get('resumes')
  async resumes(@CurrentEndUser() user: AuthedEndUser): Promise<ApiResponse<MemberResumeItem[]>> {
    return ApiResponse.ok(await this.assets.listResumes(user.endUserId))
  }

  @Get('documents')
  async documents(@CurrentEndUser() user: AuthedEndUser): Promise<ApiResponse<MemberDocumentItem[]>> {
    return ApiResponse.ok(await this.assets.listDocuments(user.endUserId))
  }

  @Get('ai-records')
  async aiRecords(@CurrentEndUser() user: AuthedEndUser): Promise<ApiResponse<MemberAiRecordItem[]>> {
    return ApiResponse.ok(await this.assets.listAiRecords(user.endUserId))
  }
}
