import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { BulkPublishService } from './bulk-publish.service'
import { BulkPublishExecuteDto, BulkPublishPreviewDto } from './dto/bulk-publish.dto'

/**
 * 信息源批量发布(Admin only)。
 *
 * 路由表(含 /api/v1 前缀):
 *   POST /admin/bulk-publish/preview   只读预览:本轮会发布哪些、共多少、排除了哪些及原因
 *   POST /admin/bulk-publish/execute   按显式 id 逐条发布,返回逐条结果
 *
 * 两步是**强制**的:execute 只接受 id 列表,没有「按条件直接全发」的入口,
 * 操作者必须先看到清单。
 *
 * 合规:批量发布只是把**已审核通过**的条目由 draft/unpublished 推到 published;
 * 它不改变审核状态,也不能让 pending / rejected 的外部数据上线(CLAUDE.md §18)。
 */
@Controller('admin/bulk-publish')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class BulkPublishController {
  constructor(private readonly bulk: BulkPublishService) {}

  @Post('preview')
  preview(@Body() dto: BulkPublishPreviewDto) {
    return this.bulk.previewBulkPublish({
      kind: dto.kind,
      sourceOrgId: dto.sourceOrgId,
      syncTimeFrom: dto.syncTimeFrom,
      syncTimeTo: dto.syncTimeTo,
    })
  }

  @Post('execute')
  execute(@Body() dto: BulkPublishExecuteDto, @CurrentUser() user: AuthedUser) {
    return this.bulk.executeBulkPublish(dto.kind, dto.ids, user)
  }
}
