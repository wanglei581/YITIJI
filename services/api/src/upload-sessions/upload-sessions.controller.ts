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
import { PrismaService } from '../prisma/prisma.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CreateUploadSessionDto, PhoneUploadSessionDto, ResolveUploadSceneDto } from './upload-sessions.dto'
import {
  UploadSessionsService,
  type UploadSessionCancelResponse,
  type UploadSessionConfirmResponse,
  type UploadSessionCreateResponse,
  type UploadSessionSceneResolveResponse,
  type UploadSessionStatusResponse,
} from './upload-sessions.service'

@Controller('upload-sessions')
export class UploadSessionsController {
  constructor(
    private readonly sessions: UploadSessionsService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  async create(@Body() body: CreateUploadSessionDto, @Req() req: Request): Promise<ApiResponse<UploadSessionCreateResponse>> {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis, this.prisma)
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

  /**
   * 小程序扫码后用 scene 换上传凭据。
   *
   * 必须声明在 `@Get(':sessionId')` 之类的参数路由之前，避免将来有人加
   * `@Post(':sessionId')` 时把 `scene` 当成 sessionId 吃掉。
   *
   * 公开无鉴权：手机端此刻还没有任何本系统的身份，scene 本身就是凭据。
   * 因此限流收得比创建更紧 —— 兑换会消耗码，暴力探测的代价必须够高。
   */
  @Post('scene/resolve')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async resolveScene(
    @Body() body: ResolveUploadSceneDto,
  ): Promise<ApiResponse<UploadSessionSceneResolveResponse>> {
    return ApiResponse.ok(await this.sessions.resolveScene(body.scene))
  }

  @Get(':sessionId')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async status(
    @Param('sessionId') sessionId: string,
    @Headers('x-upload-session-control') controlToken: string | undefined,
  ): Promise<ApiResponse<UploadSessionStatusResponse>> {
    return ApiResponse.ok(await this.sessions.getStatus(sessionId, controlToken))
  }

  @Post(':sessionId/files')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, fieldNestingDepth: 0 } as { fieldNestingDepth: number; fileSize?: number } }))
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
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis, this.prisma)
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
