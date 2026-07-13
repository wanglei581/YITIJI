import { Body, Controller, Delete, Headers, Param, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import type { IdPhotoLayoutResponse } from './id-photo.types'
import { RedisService } from '../common/redis/redis.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CreateIdPhotoLayoutDto, DeleteIdPhotoSourceDto } from './id-photo.dto'
import { IdPhotoService } from './id-photo.service'

@Controller('print/id-photo')
export class IdPhotoController {
  constructor(
    private readonly idPhoto: IdPhotoService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  @Post('layout')
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  async layout(
    @Body() body: CreateIdPhotoLayoutDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ): Promise<ApiResponse<IdPhotoLayoutResponse>> {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.idPhoto.generateLayout({
      source: body.source,
      specId: body.specId,
      terminalId: body.terminalId,
      endUserId: endUser?.endUserId ?? null,
      idempotencyKey: idempotencyKey ?? null,
    })
    return ApiResponse.ok(result)
  }

  // 设计 §4.9：删除 token 走请求体，不放 URL query。
  @Delete('file/:fileId')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async deleteFile(
    @Param('fileId') fileId: string,
    @Body() body: DeleteIdPhotoSourceDto,
    @Req() req: Request,
  ): Promise<ApiResponse<{ deleted: true }>> {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.idPhoto.deleteSource({
      fileId,
      endUserId: endUser?.endUserId ?? null,
      deleteToken: body?.deleteToken ?? null,
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
