import { Body, Controller, Get, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Throttle } from '@nestjs/throttler'
import { MaintenanceBlocked } from '../ai-access/ai-access.decorator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalIdentityGuard } from '../terminals/terminal-identity.guard'
import { ConfirmCopyJobDto, CopyGenerationDto, CreateCopyJobDto } from './copy-job.dto'
import { CopyJobsService } from './copy-jobs.service'
import { copyError } from './copy-job.policy'

@Controller('copy/jobs')
@UseGuards(TerminalIdentityGuard)
export class CopyJobsController {
  constructor(private readonly jobs: CopyJobsService, private readonly jwt: JwtService,
    private readonly redis: RedisService, private readonly prisma: PrismaService) {}

  private async user(auth?: string) {
    return (await resolveOptionalEndUser(auth, this.jwt, this.redis, this.prisma))?.endUserId ?? null
  }

  @Post()
  @HttpCode(200)
  @MaintenanceBlocked()
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  async create(@Body() dto: CreateCopyJobDto, @Headers('x-terminal-id') terminalId: string,
    @Headers('authorization') auth?: string) {
    if (terminalId !== dto.terminalId) copyError(403, 'COPY_UNAUTHORIZED')
    return ApiResponse.ok(await this.jobs.create(dto, await this.user(auth)))
  }

  @Get(':id')
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  async get(@Param('id') id: string, @Headers('x-terminal-id') terminalId: string,
    @Headers('x-copy-control') token?: string, @Headers('authorization') auth?: string) {
    return ApiResponse.ok(await this.jobs.get(id, terminalId, await this.user(auth), token))
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Body() dto: CopyGenerationDto,
    @Headers('x-terminal-id') terminalId: string, @Headers('x-copy-control') token?: string,
    @Headers('authorization') auth?: string) {
    return ApiResponse.ok(await this.jobs.cancel(id, terminalId, await this.user(auth), token, dto.generation))
  }

  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(@Param('id') id: string, @Body() dto: ConfirmCopyJobDto,
    @Headers('x-terminal-id') terminalId: string, @Headers('x-copy-control') token?: string,
    @Headers('authorization') auth?: string) {
    return ApiResponse.ok(await this.jobs.confirm(id, terminalId, await this.user(auth), token, dto.quoteVersion))
  }
}
