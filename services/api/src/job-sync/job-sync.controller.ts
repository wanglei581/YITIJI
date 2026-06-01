import {
  Controller,
  Get,
  Post,
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
      sources.map((s) => ({
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
