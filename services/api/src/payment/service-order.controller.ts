import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { TerminalScopedThrottle } from '../common/throttler/terminal-throttle'
import { TerminalIdentityGuard } from '../terminals/terminal-identity.guard'
import { CreateServiceOrderDto } from './dto/service-order.dto'
import { ServiceOrderService } from './service-order.service'

/**
 * 一体机按次付款。只认终端验签身份。生效价为 0 时不建单。
 * 查询和取消只认本机、本会话。
 */
@Controller('kiosk/service-orders')
@UseGuards(TerminalIdentityGuard)
export class ServiceOrderController {
  constructor(private readonly orders: ServiceOrderService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @TerminalScopedThrottle(10)
  async create(@Headers('x-terminal-id') terminalId: string, @Body() dto: CreateServiceOrderDto) {
    return ApiResponse.ok(await this.orders.create(terminalId, dto))
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
