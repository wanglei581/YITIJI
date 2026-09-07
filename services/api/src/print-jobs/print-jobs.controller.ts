// ============================================================
// PrintJobs Controller — W7
//
// Kiosk-facing endpoints (no auth — Kiosk is a controlled device).
//
// Routes (all prefixed with /api/v1):
//   POST  /print/jobs          — Kiosk submits a new print job (rate-limited: 10/min per IP)
//   GET   /print/jobs/:taskId  — Kiosk polls task status
// ============================================================

import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Ip, Param, Post, UseGuards } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Throttle } from '@nestjs/throttler'
import { TerminalScopedThrottle } from '../common/throttler/terminal-throttle'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { PrintJobsService } from './print-jobs.service'
import { CreatePrintJobDto } from './dto/create-print-job.dto'
import { ClaimPickupDto } from './dto/claim-pickup.dto'
import { PickupOrderService } from './pickup-order.service'
import { TerminalIdentityGuard } from '../terminals/terminal-identity.guard'

@Controller('print/jobs')
export class PrintJobsController {
  constructor(
    private readonly service: PrintJobsService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly pickupOrders: PickupOrderService,
  ) {}

  @Post('claim-pickup')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  claimPickup(@Body() dto: ClaimPickupDto, @Headers('x-terminal-id') terminalId: string | undefined) {
    return this.pickupOrders.claim(dto.code, terminalId)
  }

  @Post(':orderId/release')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  releasePickup(
    @Param('orderId') orderId: string,
    @Headers('x-terminal-id') terminalId: string | undefined,
    @Headers('x-payment-session-token') paymentSessionToken: string | undefined,
  ) {
    return this.pickupOrders.release(orderId, terminalId, paymentSessionToken)
  }

  // HIGH-3：已改用终端会话令牌，签名 fileUrl + 限流 + 审计仍保留为第二层。
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UseGuards(TerminalIdentityGuard)
  async create(
    @Body() dto: CreatePrintJobDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-terminal-id') terminalId: string | undefined,
  ) {
    const endUser = await resolveOptionalEndUser(authorization, this.jwt, this.redis, this.prisma)
    return this.service.create(dto, {
      ipAddress: ip ?? null,
      userAgent: userAgent ?? null,
      endUserId: endUser?.endUserId ?? null,
      terminalId: terminalId ?? null,
    })
  }

  // PrintProgressPage 每 3 秒轮询一次、最长 10 分钟 = 20 次/分钟/台。
  // 按 IP 计数时一个大厅的 3 台机器就能打满 60 次/分钟的默认桶，第 4 次轮询 429，
  // 前端 catch 分支会把它显示成「无法连接打印服务」。改成按台计数后每台各有一份。
  @Get(':taskId')
  @TerminalScopedThrottle(40)
  getStatus(@Param('taskId') taskId: string) {
    return this.service.getStatus(taskId)
  }

  @Post(':taskId/takeaway-url')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async issueTakeawayUrl(
    @Param('taskId') taskId: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-payment-session-token') paymentSessionToken: string | undefined,
  ) {
    const endUser = await resolveOptionalEndUser(authorization, this.jwt, this.redis, this.prisma)
    return this.service.issueTakeawayUrl(taskId, {
      endUserId: endUser?.endUserId ?? null,
      paymentSessionToken,
      ipAddress: ip ?? null,
      userAgent: userAgent ?? null,
    })
  }

  @Post(':taskId/retry')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UseGuards(TerminalIdentityGuard)
  async retryPaidFailedJob(
    @Param('taskId') taskId: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-payment-session-token') paymentSessionToken: string | undefined,
  ) {
    const endUser = await resolveOptionalEndUser(authorization, this.jwt, this.redis, this.prisma)
    return this.service.retryPaidFailedJob(taskId, {
      endUserId: endUser?.endUserId ?? null,
      paymentSessionToken,
      ipAddress: ip ?? null,
      userAgent: userAgent ?? null,
    })
  }
}
