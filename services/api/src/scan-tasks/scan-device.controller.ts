import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { ApiResponse } from '../common/dto/api-response.dto'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalsService } from '../terminals/terminals.service'
import { ScanDeviceReportDto } from './dto/scan-device-report.dto'
import { ScanDeviceSettingsDto } from './dto/scan-device-settings.dto'
import { ScanDeviceSessionsService } from './scan-device-sessions.service'

/**
 * 屏上扫描（device 路线）的三个云端写入口：终端程序回报进度、用户改用面板扫描、用户改扫描设置。
 *
 * 刻意不带 @MaintenanceBlocked：维护模式只拦「新建」入口（verify-ai-access 钉住，本控制器登记为「没有任何受拦接口」），
 * 已经开始的会话必须还能回报进度、还能改用面板扫描、还能换来源 / 颜色，否则用户会卡在半路。
 */
@Controller()
export class ScanDeviceController {
  constructor(
    private readonly device: ScanDeviceSessionsService,
    private readonly terminals: TerminalsService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 仅 Terminal Agent Bearer 调用：回报屏上扫描进度（照 current-lease 与 deliver 的守卫：先验终端令牌，
   * service 里再核任务属于本终端）。限额按 IP 计，一个大厅的多台机器共用，所以给得比 current-lease 宽。
   */
  @Post('terminals/:terminalId/scan-tasks/:taskId/device-report')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  async deviceReport(
    @Param('terminalId') terminalId: string,
    @Param('taskId') taskId: string,
    @Body() dto: ScanDeviceReportDto,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    await this.terminals.assertAgentAuthorized(terminalId, authHeader)
    const result = await this.device.report(terminalId, taskId, {
      state: dto.state,
      pageCount: dto.pageCount,
      errorCode: dto.errorCode,
      source: dto.source,
      colorMode: dto.colorMode,
    })
    return ApiResponse.ok(result)
  }

  /**
   * 「改用面板扫描」：凭控制令牌把同一个会话原地切回面板路线（权限检查照 DELETE /scan/sessions/:id）。
   * 不走取消重建，所以不触发终端静默期；会话、控制令牌、ACK 原样保留。
   */
  @Post('scan/sessions/:id/switch-to-panel')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async switchToPanel(
    @Param('id') id: string,
    @Headers('x-scan-session-control') controlToken: string | undefined,
    @Req() req: Request,
  ) {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis, this.prisma)
    const result = await this.device.switchToPanel(id, endUser?.endUserId ?? null, controlToken)
    return ApiResponse.ok(result)
  }

  /**
   * 「改用玻璃台 / 改颜色」：凭控制令牌在同一个会话里原地改来源与颜色（权限检查照 switch-to-panel）。
   * 只在 ready / error 时允许；不检查也不触发终端静默期，会话、控制令牌、ACK 原样保留。限额同 switch-to-panel。
   */
  @Post('scan/sessions/:id/device-settings')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async deviceSettings(
    @Param('id') id: string,
    @Body() dto: ScanDeviceSettingsDto,
    @Headers('x-scan-session-control') controlToken: string | undefined,
    @Req() req: Request,
  ) {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis, this.prisma)
    const result = await this.device.updateDeviceSettings(id, endUser?.endUserId ?? null, controlToken, {
      source: dto.source,
      colorMode: dto.colorMode,
    })
    return ApiResponse.ok(result)
  }
}

function extractAuth(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const auth = req.headers.authorization
  if (typeof auth === 'string') return auth
  if (Array.isArray(auth)) return auth[0]
  return undefined
}
