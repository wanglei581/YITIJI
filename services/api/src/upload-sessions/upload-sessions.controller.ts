import { MaintenanceBlocked } from '../ai-access/ai-access.decorator'
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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import {
  AGE_14_PLUS_HEADER,
  AGE_14_PLUS_VERSION_HEADER,
  readClientDeclaration,
  VOICE_RECORDING_HEADER,
  VOICE_RECORDING_VERSION_HEADER,
} from '../common/privacy/client-declaration'
import {
  CreateUploadSessionDto,
  MemberFileUploadSessionDto,
  PhoneUploadSessionDto,
  ResolveUploadSceneDto,
} from './upload-sessions.dto'
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
  @MaintenanceBlocked()
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
    @Req() req: Request,
  ): Promise<ApiResponse<UploadSessionStatusResponse>> {
    return ApiResponse.ok(await this.sessions.uploadFile({
      sessionId,
      uploadToken: body.uploadToken,
      file,
      clientDeclaration: readClientDeclaration(req.headers),
      source: phoneUploadSource(req),
    }))
  }

  /**
   * 小程序已登录会员把「我的文档」里的一份文件递进这台一体机的这一单。
   * 与 `:sessionId/files` 同级、同一把 uploadToken、同形回执；落成的是匿名副本。
   */
  @Post(':sessionId/member-file')
  @UseGuards(EndUserAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async uploadMemberFile(
    @Param('sessionId') sessionId: string,
    @Body() body: MemberFileUploadSessionDto,
    @CurrentEndUser() user: AuthedEndUser,
    @Req() req: Request,
  ): Promise<ApiResponse<UploadSessionStatusResponse>> {
    return ApiResponse.ok(await this.sessions.uploadMemberFile({
      sessionId,
      uploadToken: body.uploadToken,
      fileId: body.fileId,
      endUserId: user.endUserId,
      // 声明头是给未登录用户的；会员请求只在真带了声明头时才记，照原入口的形状。
      clientDeclaration: hasClientDeclarationHeader(req) ? readClientDeclaration(req.headers) : undefined,
    }))
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

const CLIENT_DECLARATION_HEADERS = [
  AGE_14_PLUS_HEADER,
  AGE_14_PLUS_VERSION_HEADER,
  VOICE_RECORDING_HEADER,
  VOICE_RECORDING_VERSION_HEADER,
]

/**
 * 微信小程序发出的网络请求，Referer 固定是 https://servicewechat.com/{appid}/{版本}/page-frame.html，
 * 开发者改不了。只用于一体机确认屏提示文件从哪来；浏览器和脚本都能伪造，不作任何安全判断。
 */
function phoneUploadSource(req: Request): 'miniapp' | 'web' {
  const referer = req.headers.referer
  return typeof referer === 'string' && referer.startsWith('https://servicewechat.com/') ? 'miniapp' : 'web'
}

function hasClientDeclarationHeader(req: Request): boolean {
  return CLIENT_DECLARATION_HEADERS.some((name) => req.headers[name] !== undefined)
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
