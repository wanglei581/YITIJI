import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { RedisService } from '../common/redis/redis.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CreateUploadSessionDto, PhoneUploadSessionDto } from './upload-sessions.dto'
import {
  UploadSessionsService,
  type UploadSessionCancelResponse,
  type UploadSessionConfirmResponse,
  type UploadSessionCreateResponse,
  type UploadSessionStatusResponse,
} from './upload-sessions.service'

@Controller('upload-sessions')
export class UploadSessionsController {
  constructor(
    private readonly sessions: UploadSessionsService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  async create(@Body() body: CreateUploadSessionDto, @Req() req: Request): Promise<ApiResponse<UploadSessionCreateResponse>> {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.sessions.create({
      purpose: body.purpose,
      mode: body.mode,
      channel: body.channel,
      terminalId: body.terminalId,
      endUserId: endUser?.endUserId ?? null,
      uploadUrl: buildPhoneUploadUrl(req),
    })
    return ApiResponse.ok(result)
  }

  @Get(':sessionId')
  async status(
    @Param('sessionId') sessionId: string,
    @Headers('x-upload-session-control') controlToken: string | undefined,
  ): Promise<ApiResponse<UploadSessionStatusResponse>> {
    return ApiResponse.ok(await this.sessions.getStatus(sessionId, controlToken))
  }

  @Post(':sessionId/files')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(
    @Param('sessionId') sessionId: string,
    @Body() body: PhoneUploadSessionDto,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ApiResponse<UploadSessionStatusResponse>> {
    return ApiResponse.ok(await this.sessions.uploadFile({ sessionId, uploadToken: body.uploadToken, file }))
  }

  @Post(':sessionId/confirm')
  async confirm(
    @Param('sessionId') sessionId: string,
    @Headers('x-upload-session-control') controlToken: string | undefined,
    @Req() req: Request,
  ): Promise<ApiResponse<UploadSessionConfirmResponse>> {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    return ApiResponse.ok(await this.sessions.confirm(sessionId, controlToken, endUser?.endUserId ?? null))
  }

  @Delete(':sessionId')
  async cancel(
    @Param('sessionId') sessionId: string,
    @Headers('x-upload-session-control') controlToken: string | undefined,
  ): Promise<ApiResponse<UploadSessionCancelResponse>> {
    return ApiResponse.ok(await this.sessions.cancel(sessionId, controlToken))
  }
}

function extractAuth(req: Request): string | undefined {
  const raw = req.headers.authorization
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return raw[0]
  return undefined
}

function buildPhoneUploadUrl(req: Request): string {
  const configured = process.env['KIOSK_PUBLIC_BASE_URL']?.trim()
  if (process.env['NODE_ENV'] === 'production') {
    if (!configured) {
      throw new Error('KIOSK_PUBLIC_BASE_URL is required in production for phone upload QR codes')
    }
    if (!configured.startsWith('https://')) {
      throw new Error('KIOSK_PUBLIC_BASE_URL must be https:// in production')
    }
  }
  const origin = configured || `${req.protocol}://${req.get('host')}`
  return new URL('/upload/phone', origin).toString()
}
