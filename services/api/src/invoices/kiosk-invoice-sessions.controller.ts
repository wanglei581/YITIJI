import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request } from 'express'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { TerminalScopedThrottle } from '../common/throttler/terminal-throttle'
import { TerminalIdentityGuard } from '../terminals/terminal-identity.guard'
import { CreateInvoiceSessionDto, ResolveInvoiceSceneDto, SubmitInvoiceSessionDto } from './invoice-sessions.dto'
import { InvoiceSessionsService } from './invoice-sessions.service'

@Controller('kiosk/invoice-sessions')
export class KioskInvoiceSessionsController {
  constructor(private readonly sessions: InvoiceSessionsService) {}

  @Post()
  @UseGuards(TerminalIdentityGuard, EndUserAuthGuard)
  @TerminalScopedThrottle(12)
  async create(
    @Headers('x-terminal-id') terminalId: string,
    @CurrentEndUser() user: AuthedEndUser,
    @Body() body: CreateInvoiceSessionDto,
    @Req() req: Request,
  ) {
    return ApiResponse.ok(await this.sessions.create({
      terminalId,
      endUserId: user.endUserId,
      orderKind: body.orderKind,
      orderId: body.orderId,
      origin: invoicePublicOrigin(req),
    }))
  }

  @Post('scene/resolve')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async resolve(@Body() body: ResolveInvoiceSceneDto) {
    return ApiResponse.ok(await this.sessions.resolveScene(body.scene))
  }

  @Get(':sessionId')
  @UseGuards(TerminalIdentityGuard)
  @TerminalScopedThrottle(60)
  async poll(
    @Param('sessionId') sessionId: string,
    @Headers('x-invoice-control') controlToken: string | undefined,
  ) {
    return ApiResponse.ok(await this.sessions.poll(sessionId, controlToken))
  }

  @Post(':sessionId/submit')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async submit(@Param('sessionId') sessionId: string, @Body() body: SubmitInvoiceSessionDto) {
    return ApiResponse.ok(await this.sessions.submit(sessionId, body))
  }
}

function invoicePublicOrigin(req: Request): string {
  const configured = process.env['KIOSK_PUBLIC_BASE_URL']?.trim()
  if (process.env['NODE_ENV'] === 'production') {
    if (!configured) throw new Error('KIOSK_PUBLIC_BASE_URL is required in production for invoice QR codes')
    if (!configured.startsWith('https://')) throw new Error('KIOSK_PUBLIC_BASE_URL must be https:// in production')
  }
  return configured || `${req.protocol}://${req.get('host')}`
}
