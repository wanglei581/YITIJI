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
  ) {}

  @Post('scan/sessions')
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  async create(@Body() dto: CreateScanTaskDto, @Req() req: Request) {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.scanTasks.create(dto, endUser?.endUserId ?? null)
    return ApiResponse.ok(result)
  }

  @Get('scan/sessions/:id')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async status(@Param('id') id: string, @Req() req: Request) {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.scanTasks.getStatus(id, endUser?.endUserId ?? null)
    return ApiResponse.ok(result)
  }

  @Delete('scan/sessions/:id')
  async cancel(@Param('id') id: string, @Req() req: Request) {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.scanTasks.cancel(id, endUser?.endUserId ?? null)
    return ApiResponse.ok(result)
  }

  /** 仅 Terminal Agent 调用：投递扫描到共享目录后产生的文件。 */
  @Post('terminals/:terminalId/scan-sessions/deliver')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
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
