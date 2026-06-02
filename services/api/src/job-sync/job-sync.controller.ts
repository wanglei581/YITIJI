import {
  Controller,
  Get,
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
import { ApiResponse } from '../common/dto/api-response.dto'
import { JobSyncService } from './job-sync.service'

/**
 * 路由前缀：/api/v1（由 main.ts 全局设置）
 *
 * Admin only:
 *   POST /admin/job-sync/sources/:sourceId/trigger  — 手动触发单个 API 数据源同步
 *   GET  /admin/job-sync/sources                    — 列出所有 API 模式数据源及同步状态
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
    const exists = await this.service['prisma'].jobSource.findUnique({ where: { id: sourceId }, select: { id: true } })
    if (!exists) throw new NotFoundException({ error: { code: 'SOURCE_NOT_FOUND', message: '数据源不存在' } })
    await this.service['prisma'].jobSource.update({
      where: { id: sourceId },
      data: { responseConfig: JSON.stringify(dto) },
    })
    return ApiResponse.ok({ updated: true, sourceId })
  }

  /**
   * 列出所有 accessMode='api' 的数据源及其同步状态，供 Admin 工作台使用。
   */
  @Get('sources')
  async listApiSources(): Promise<ApiResponse<{
    id: string
    name: string
    orgId: string
    syncFreq: string
    enabled: boolean
    lastSyncAt: string | null
    lastSyncStatus: string | null
    hasEndpoint: boolean
    hasCredential: boolean
    hasResponseConfig: boolean
  }[]>> {
    const sources = await this.service['prisma'].jobSource.findMany({
      where: { accessMode: 'api' },
      select: {
        id: true, name: true, orgId: true,
        syncFreq: true, enabled: true,
        lastSyncAt: true, lastSyncStatus: true,
        endpoint: true, encryptedCredential: true, responseConfig: true,
      },
      orderBy: { updatedAt: 'desc' },
    })
    return ApiResponse.ok(
      (sources as Array<{
        id: string
        name: string
        orgId: string
        syncFreq: string
        enabled: boolean
        lastSyncAt: Date | null
        lastSyncStatus: string | null
        endpoint: string | null
        encryptedCredential: string | null
        responseConfig: string | null
      }>).map((s) => ({
        id: s.id,
        name: s.name,
        orgId: s.orgId,
        syncFreq: s.syncFreq,
        enabled: s.enabled,
        lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
        lastSyncStatus: s.lastSyncStatus ?? null,
        hasEndpoint: Boolean(s.endpoint),
        hasCredential: Boolean(s.encryptedCredential),
        hasResponseConfig: Boolean(s.responseConfig),
      })),
    )
  }
}
