import {
  Controller,
  Get,
  Patch,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  BadRequestException,
  NotFoundException,
  HttpCode,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JobSyncService } from './job-sync.service'
import { UnpublishSourceContentDto, UpdateSourceEnabledDto } from './dto/source-operations.dto'
import { assertPartnerDataTypeCapability } from '../jobs/partner-capabilities'

/**
 * 路由前缀：/api/v1（由 main.ts 全局设置）
 *
 * Admin only:
 *   POST /admin/job-sync/sources/:sourceId/trigger  — 手动触发单个 API 数据源同步
 *   GET  /admin/job-sync/sources                    — 列出全部数据接入通道及同步状态
 *   PATCH /admin/job-sync/sources/:sourceId/enabled — Admin 审批/启停通道（不级联内容）
 *   GET  /admin/job-sync/sources/:sourceId/impact   — 启停/批量下架前影响预览
 *   POST /admin/job-sync/sources/:sourceId/unpublish-content — 独立批量下架已发布内容
 */
@Controller('admin/job-sync')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class JobSyncController {
  constructor(private readonly service: JobSyncService) {}

  /**
   * 手动触发单个 API 数据源同步。
   * 限流：10 次/分钟（防误操作；正常运维每次只打一个 source）。
   */
  @Post('sources/:sourceId/trigger')
  @HttpCode(202)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async triggerSync(
    @Param('sourceId') sourceId: string,
  ): Promise<ApiResponse<{ queued: boolean; jobId: string | null; sourceId: string }>> {
    let sourceInfo: { name: string; syncFreq: string; lastSyncAt: Date | null }
    try {
      sourceInfo = await this.service.getSourceForTrigger(sourceId)
    } catch (e) {
      const code = (e as Error).message
      if (code === 'SOURCE_NOT_FOUND') throw new NotFoundException({ error: { code, message: '数据源不存在' } })
      throw new BadRequestException({ error: { code, message: '该数据源不支持 API 拉取' } })
    }

    const jobId = await this.service.enqueue(sourceId, true)
    return ApiResponse.ok({
      queued: true,
      jobId,
      sourceId,
      sourceName: sourceInfo.name,
    } as { queued: boolean; jobId: string | null; sourceId: string })
  }

  /**
   * 获取单个数据源详情（含 responseConfig）。
   */
  @Get('sources/:sourceId')
  async getSource(
    @Param('sourceId') sourceId: string,
  ): Promise<ApiResponse<{
    id: string
    name: string
    orgId: string
    responseConfig: Record<string, unknown> | null
  }>> {
    const s = await this.service['prisma'].jobSource.findUnique({
      where: { id: sourceId },
      select: { id: true, name: true, orgId: true, responseConfig: true },
    })
    if (!s) throw new NotFoundException({ error: { code: 'SOURCE_NOT_FOUND', message: '数据源不存在' } })
    return ApiResponse.ok({
      id: s.id,
      name: s.name,
      orgId: s.orgId,
      responseConfig: s.responseConfig ? (JSON.parse(s.responseConfig) as Record<string, unknown>) : null,
    })
  }

  /**
   * 保存数据源的 responseConfig 字段映射配置。
   */
  @Put('sources/:sourceId/response-config')
  @HttpCode(200)
  async updateResponseConfig(
    @Param('sourceId') sourceId: string,
    @Body() dto: Record<string, unknown>,
  ): Promise<ApiResponse<{ updated: boolean; sourceId: string }>> {
    if (dto.dataType !== 'job' && dto.dataType !== 'fair') {
      throw new BadRequestException({ error: { code: 'INVALID_DATA_TYPE', message: 'dataType must be "job" or "fair"' } })
    }
    const exists = await this.service['prisma'].jobSource.findUnique({
      where: { id: sourceId },
      select: { id: true, org: { select: { type: true } } },
    })
    if (!exists) throw new NotFoundException({ error: { code: 'SOURCE_NOT_FOUND', message: '数据源不存在' } })
    assertPartnerDataTypeCapability(exists.org.type, dto.dataType)
    await this.service['prisma'].jobSource.update({
      where: { id: sourceId },
      data: { responseConfig: JSON.stringify(dto) },
    })
    return ApiResponse.ok({ updated: true, sourceId })
  }

  @Get('sources/:sourceId/impact')
  async getSourceImpact(@Param('sourceId') sourceId: string) {
    return ApiResponse.ok(await this.service.getSourceImpact(sourceId))
  }

  @Patch('sources/:sourceId/enabled')
  async setSourceEnabled(
    @Param('sourceId') sourceId: string,
    @Body() dto: UpdateSourceEnabledDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return ApiResponse.ok(await this.service.setSourceEnabled(sourceId, dto.enabled, user))
  }

  @Post('sources/:sourceId/unpublish-content')
  async unpublishSourceContent(
    @Param('sourceId') sourceId: string,
    @Body() _dto: UnpublishSourceContentDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return ApiResponse.ok(await this.service.unpublishSourceContent(sourceId, user))
  }

  /**
   * 列出全部数据接入通道。API/Webhook 的 enabled 由 Admin 管理；
   * 文件/手工来源也展示，便于统一做影响预览和批量下架。
   */
  @Get('sources')
  async listApiSources(): Promise<ApiResponse<{
    id: string
    name: string
    orgId: string
    orgName: string
    sourceKind: string
    accessMode: string
    syncFreq: string
    enabled: boolean
    lastSyncAt: string | null
    lastSyncStatus: string | null
    hasEndpoint: boolean
    hasCredential: boolean
    hasResponseConfig: boolean
  }[]>> {
    const sources = await this.service['prisma'].jobSource.findMany({
      select: {
        id: true, name: true, orgId: true,
        sourceKind: true, accessMode: true,
        org: { select: { name: true } },
        syncFreq: true, enabled: true,
        lastSyncAt: true, lastSyncStatus: true,
        endpoint: true, encryptedCredential: true, webhookSecret: true, responseConfig: true,
      },
      orderBy: { updatedAt: 'desc' },
    })
    return ApiResponse.ok(
      (sources as Array<{
        id: string
        name: string
        orgId: string
        sourceKind: string
        accessMode: string
        org: { name: string }
        syncFreq: string
        enabled: boolean
        lastSyncAt: Date | null
        lastSyncStatus: string | null
        endpoint: string | null
        encryptedCredential: string | null
        webhookSecret: string | null
        responseConfig: string | null
      }>).map((s) => ({
        id: s.id,
        name: s.name,
        orgId: s.orgId,
        orgName: s.org.name,
        sourceKind: s.sourceKind,
        accessMode: s.accessMode,
        syncFreq: s.syncFreq,
        enabled: s.enabled,
        lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
        lastSyncStatus: s.lastSyncStatus ?? null,
        hasEndpoint: Boolean(s.endpoint),
        hasCredential: Boolean(s.encryptedCredential || s.webhookSecret),
        hasResponseConfig: Boolean(s.responseConfig),
      })),
    )
  }
}
