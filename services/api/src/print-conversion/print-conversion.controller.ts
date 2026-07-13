import { Body, Controller, Headers, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import type { ComposeSignatureOverlayResponse, ConvertImagesResponse } from './print-conversion.types'
import { RedisService } from '../common/redis/redis.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { ApiResponse } from '../common/dto/api-response.dto'
import { ComposeSignatureOverlayDto, ConvertImagesDto } from './print-conversion.dto'
import { PrintConversionService } from './print-conversion.service'

@Controller('print/convert')
export class PrintConversionController {
  constructor(
    private readonly conversion: PrintConversionService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  @Post('images-to-pdf')
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  async imagesToPdf(
    @Body() body: ConvertImagesDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ): Promise<ApiResponse<ConvertImagesResponse>> {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.conversion.convertImagesToPdf({
      sources: body.sources,
      endUserId: endUser?.endUserId ?? null,
      idempotencyKey: idempotencyKey ?? null,
    })
    return ApiResponse.ok(result)
  }

  @Post('sign-overlay')
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  async signOverlay(
    @Body() body: ComposeSignatureOverlayDto,
    @Req() req: Request,
  ): Promise<ApiResponse<ComposeSignatureOverlayResponse>> {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.conversion.composeSignatureOverlay({
      target: body.target,
      signature: body.signature,
      position: body.position,
      size: body.size,
      endUserId: endUser?.endUserId ?? null,
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
