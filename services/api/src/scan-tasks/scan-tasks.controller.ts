import {
  BadRequestException,
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
import { ApiResponse } from '../common/dto/api-response.dto'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalsService } from '../terminals/terminals.service'
import { CreateScanTaskDto } from './dto/create-scan-task.dto'
import { ScanTasksService } from './scan-tasks.service'

@Controller()
export class ScanTasksController {
  constructor(
    private readonly scanTasks: ScanTasksService,
    private readonly terminals: TerminalsService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('scan/sessions')
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  async create(@Body() dto: CreateScanTaskDto, @Req() req: Request) {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis, this.prisma)
    const result = await this.scanTasks.create(dto, endUser?.endUserId ?? null)
    return ApiResponse.ok(result)
  }

  // controlToken 走 header 而非 query string，对齐 upload-sessions 的既有惯例
  // （X-Upload-Session-Control，见 upload-sessions.controller.ts）：header 通常不进
  // 访问日志/浏览器历史，query string 通常会。B1-8（Kiosk 前台接线）请使用
  // `X-Scan-Session-Control` 这个 header 名传递 controlToken。
  @Get('scan/sessions/:id')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async status(
    @Param('id') id: string,
    @Headers('x-scan-session-control') controlToken: string | undefined,
    @Req() req: Request,
  ) {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis, this.prisma)
    const result = await this.scanTasks.getStatus(id, endUser?.endUserId ?? null, controlToken)
    return ApiResponse.ok(result)
  }

  @Delete('scan/sessions/:id')
  async cancel(
    @Param('id') id: string,
    @Headers('x-scan-session-control') controlToken: string | undefined,
    @Req() req: Request,
  ) {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis, this.prisma)
    const result = await this.scanTasks.cancel(id, endUser?.endUserId ?? null, controlToken)
    return ApiResponse.ok(result)
  }

  /** 仅 Terminal Agent 调用：投递扫描到共享目录后产生的文件。 */
  @Post('terminals/:terminalId/scan-sessions/deliver')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, fieldNestingDepth: 0 } as { fieldNestingDepth: number; fileSize?: number } }))
  async deliver(
    @Param('terminalId') terminalId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    await this.terminals.assertAgentAuthorized(terminalId, authHeader)
    if (!file) {
      throw new BadRequestException({ error: { code: 'FILE_MISSING', message: '缺少上传文件字段(field name: file)' } })
    }
    const result = await this.scanTasks.deliverScanFile({
      terminalId,
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
    })
    return ApiResponse.ok(result)
  }
}

function extractAuth(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const auth = req.headers.authorization
  if (typeof auth === 'string') return auth
  if (Array.isArray(auth)) return auth[0]
  return undefined
}
