import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiResponse } from '../common/dto/api-response.dto'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { RedisService } from '../common/redis/redis.service'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { parseMemberPageQuery } from '../common/utils/member-page'
import { JobAiService } from './job-ai.service'
import type { JobAiQuotaContext } from './job-ai-quota.service'

interface ReqLike {
  headers?: Record<string, string | string[] | undefined>
  ip?: string
  socket?: { remoteAddress?: string }
}

function headerOf(req: ReqLike, name: string): string | null {
  const value = req.headers?.[name]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value) && value[0]?.trim()) return value[0].trim()
  return null
}

function terminalIdOf(req: ReqLike): string | null {
  return headerOf(req, 'x-terminal-id')?.slice(0, 64) ?? null
}

function ipOf(req: ReqLike): string | null {
  const fwd = headerOf(req, 'x-forwarded-for')
  if (fwd) return fwd.split(',')[0]?.trim().slice(0, 64) ?? null
  return req.ip ?? req.socket?.remoteAddress ?? null
}

function quotaContextOf(req: ReqLike, requester: { endUserId: string | null }): JobAiQuotaContext {
  return {
    member: requester.endUserId,
    terminal: terminalIdOf(req),
    ip: ipOf(req),
  }
}

class JobRecommendationIntentDto {
  @IsOptional() @IsString() @MaxLength(80)
  targetTitle?: string

  @IsOptional() @IsString() @MaxLength(80)
  city?: string

  @IsOptional() @IsString() @MaxLength(80)
  industry?: string

  @IsOptional() @IsArray() @IsString({ each: true })
  keywords?: string[]
}

class JobRecommendationFiltersDto {
  @IsOptional() @IsString() @MaxLength(80)
  city?: string

  @IsOptional() @IsString() @MaxLength(80)
  category?: string

  @IsOptional() @IsArray() @IsString({ each: true })
  skills?: string[]

  @IsOptional() @IsString() @MaxLength(80)
  sourceOrgId?: string
}

class JobRecommendationsDto {
  @IsString() @IsNotEmpty() @MaxLength(80)
  resumeTaskId!: string

  @IsOptional() @ValidateNested() @Type(() => JobRecommendationIntentDto)
  intent?: JobRecommendationIntentDto

  @IsOptional() @ValidateNested() @Type(() => JobRecommendationFiltersDto)
  filters?: JobRecommendationFiltersDto

  @IsOptional() @IsInt() @Min(1) @Max(10)
  limit?: number
}

class JobAiMatchDto {
  @IsString() @IsNotEmpty() @MaxLength(80)
  resumeTaskId!: string
}

@Controller('jobs')
export class JobAiController {
  constructor(
    private readonly service: JobAiService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  @Post('ai/recommendations')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async recommendations(@Body() dto: JobRecommendationsDto, @Req() req: ReqLike) {
    const requester = await this.requesterOf(req)
    const quota = quotaContextOf(req, requester)
    return ApiResponse.ok(await this.service.recommendations({
      resumeTaskId: dto.resumeTaskId,
      intent: dto.intent,
      filters: dto.filters,
      limit: dto.limit,
      terminalId: quota.terminal,
    }, requester, quota))
  }

  @Post(':id/ai/explain')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async explain(@Param('id') id: string, @Req() req: ReqLike) {
    const requester = await this.requesterOf(req)
    const quota = quotaContextOf(req, requester)
    return ApiResponse.ok(await this.service.explainJob(id, requester, quota.terminal, quota))
  }

  @Post(':id/ai/match')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async match(@Param('id') id: string, @Body() dto: JobAiMatchDto, @Req() req: ReqLike) {
    const requester = await this.requesterOf(req)
    const quota = quotaContextOf(req, requester)
    return ApiResponse.ok(await this.service.matchJob(id, dto.resumeTaskId, requester, quota.terminal, quota))
  }

  private async requesterOf(req: ReqLike) {
    const member = await resolveOptionalEndUser(headerOf(req, 'authorization') ?? undefined, this.jwt, this.redis)
    if (member) return { endUserId: member.endUserId, accessToken: null }
    return { endUserId: null, accessToken: headerOf(req, 'x-resume-access-token') }
  }
}

@Controller('me/job-ai-sessions')
@UseGuards(EndUserAuthGuard)
export class MemberJobAiSessionsController {
  constructor(private readonly service: JobAiService) {}

  @Get()
  async list(
    @CurrentEndUser() user: AuthedEndUser,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ApiResponse.ok(await this.service.listMine(user.endUserId, parseMemberPageQuery(cursor, pageSize)))
  }

  @Delete(':id')
  async remove(@CurrentEndUser() user: AuthedEndUser, @Param('id') id: string) {
    return ApiResponse.ok(await this.service.deleteMine(user.endUserId, id))
  }
}
