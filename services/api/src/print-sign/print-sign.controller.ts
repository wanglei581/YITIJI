import { Body, Controller, Headers, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import type { SignComposeResponse, SignInspectResponse } from './print-sign.types'
import { RedisService } from '../common/redis/redis.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { ApiResponse } from '../common/dto/api-response.dto'
import { SignComposeDto, SignInspectDto } from './print-sign.dto'
import { PrintSignService } from './print-sign.service'

@Controller('print/sign')
export class PrintSignController {
  constructor(
    private readonly sign: PrintSignService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  @Post('inspect')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async inspect(@Body() body: SignInspectDto, @Req() req: Request): Promise<ApiResponse<SignInspectResponse>> {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.sign.inspect({
      terminalId: body.terminalId,
      document: body.document,
      endUserId: endUser?.endUserId ?? null,
    })
    return ApiResponse.ok(result)
  }

  @Post('compose')
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  async compose(
    @Body() body: SignComposeDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Req() req: Request,
  ): Promise<ApiResponse<SignComposeResponse>> {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.sign.compose({
      terminalId: body.terminalId,
      document: body.document,
      stamp: body.stamp,
      placement: body.placement,
      authorizationConfirmed: body.authorizationConfirmed,
      endUserId: endUser?.endUserId ?? null,
      idempotencyKey: idempotencyKey ?? null,
      requestId: requestId?.slice(0, 64) ?? null,
    })
    return ApiResponse.ok(result)
  }
}

function extractAuth(req: Request): string | undefined {
  const raw = req.headers.authorization
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return raw[0]
  return undefined
}
