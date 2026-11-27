import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { ApiResponse } from '../common/dto/api-response.dto'
import { RedisService } from '../common/redis/redis.service'
import { TerminalScopedThrottle } from '../common/throttler/terminal-throttle'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalIdentityGuard } from '../terminals/terminal-identity.guard'
import { CreateServiceOrderDto } from './dto/service-order.dto'
import { ServiceOrderService } from './service-order.service'

/**
 * 订单归属人取自登录身份：只认服务端验过的会员登录态（与打印建单同一种取法）。
 * 请求体里的 endUserId 只用来和登录态核对；没有有效登录态或两者对不上，按匿名单建，不打断付款。
 */
function serviceOrderOwner(claimed: string | undefined, verified: string | null): string | null {
  if (!verified) return null
  const declared = claimed?.trim()
  if (declared && declared !== verified) return null
  return verified
}

/**
 * 一体机按次付款。只认终端验签身份。生效价为 0 时不建单。
 * 查询和取消只认本机、本会话。
 */
@Controller('kiosk/service-orders')
@UseGuards(TerminalIdentityGuard)
export class ServiceOrderController {
  constructor(
    private readonly orders: ServiceOrderService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @TerminalScopedThrottle(10)
  async create(
    @Headers('x-terminal-id') terminalId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: CreateServiceOrderDto,
  ) {
    const member = await resolveOptionalEndUser(authorization, this.jwt, this.redis, this.prisma)
    return ApiResponse.ok(await this.orders.create(terminalId, {
      serviceKey: dto.serviceKey,
      kioskSessionId: dto.kioskSessionId,
      endUserId: serviceOrderOwner(dto.endUserId, member?.endUserId ?? null),
    }))
  }

  @Get(':id')
  @TerminalScopedThrottle(30)
  async get(
    @Headers('x-terminal-id') terminalId: string,
    @Headers('x-kiosk-session-id') kioskSessionId: string | undefined,
    @Param('id') id: string,
    @Query('refresh') refresh?: string,
  ) {
    return ApiResponse.ok(await this.orders.getForSession(terminalId, id, kioskSessionId ?? '', refresh === '1'))
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @TerminalScopedThrottle(10)
  async close(
    @Headers('x-terminal-id') terminalId: string,
    @Headers('x-kiosk-session-id') kioskSessionId: string | undefined,
    @Param('id') id: string,
  ) {
    return ApiResponse.ok(await this.orders.close(terminalId, id, kioskSessionId ?? ''))
  }
}
