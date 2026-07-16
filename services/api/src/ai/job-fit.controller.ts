import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import { IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { JobFitService } from './resume/job-fit.service'
import { GovernedJobFitService } from '../job-ai/governed-job-fit.service'
import type { JobAiQuotaContext } from '../job-ai/job-ai-quota.service'

// ── DTO（全局 forbidNonWhitelisted）─────────────────────────────────────────

class ManualJobDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  title!: string

  @IsOptional() @IsString() @MaxLength(2000)
  requirements?: string
}

export class JobFitRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  taskId!: string

  @IsOptional() @IsString() @MaxLength(64)
  jobId?: string

  @IsOptional() @ValidateNested() @Type(() => ManualJobDto)
  manualJob?: ManualJobDto
}

export class JobFitConsentDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  taskId!: string
}

interface ReqLike {
  headers?: Record<string, string | string[] | undefined>
  ip?: string
  socket?: { remoteAddress?: string }
}

function headerOf(req: ReqLike, name: string): string | null {
  const v = req.headers?.[name]
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (Array.isArray(v) && v[0]) return v[0].trim()
  return null
}

function terminalIdOf(req: ReqLike): string | null {
  return headerOf(req, 'x-terminal-id')?.slice(0, 64) ?? null
}

function ipOf(req: ReqLike): string | null {
  const forwarded = headerOf(req, 'x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim().slice(0, 64) ?? null
  return req.ip ?? req.socket?.remoteAddress ?? null
}

function quotaContextOf(req: ReqLike, requester: { endUserId: string | null }): JobAiQuotaContext {
  return { member: requester.endUserId, terminal: terminalIdOf(req), ip: ipOf(req) }
}

/**
 * 2D 岗位匹配参考（/api/v1/resume/job-fit）。
 *
 * 归属凭 parse 行门禁（会员 Bearer / 匿名 x-resume-access-token，对齐 C-2A）。
 * 合规：输出为参考等级（无百分比/匹配率/录用概率，服务端双层拦截）；
 * 投递只引导「去来源平台投递」。限流：触发 LLM，公共一体机单 IP 收紧。
 */
@Controller('resume/job-fit')
export class JobFitController {
  constructor(
    private readonly service: JobFitService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly governed: GovernedJobFitService,
  ) {}

  private async requesterOf(req: ReqLike) {
    const member = await resolveOptionalEndUser(headerOf(req, 'authorization') ?? undefined, this.jwt, this.redis, this.prisma)
    if (member) return { endUserId: member.endUserId, accessToken: null }
    return { endUserId: null, accessToken: headerOf(req, 'x-resume-access-token') }
  }

  /**
   * 匿名岗位匹配授权只能使用 parse 任务的一次性 token。
   * Bearer 一律在访问任务或服务前拒绝，避免把会员授权误当匿名 parse 授权。
   */
  private anonymousConsentRequesterOf(req: ReqLike) {
    const authorization = headerOf(req, 'authorization')
    if (authorization?.toLowerCase().startsWith('bearer ')) {
      throw new BadRequestException({
        error: {
          code: 'ANONYMOUS_CONSENT_TOKEN_REQUIRED',
          message: '匿名岗位匹配授权请使用简历访问令牌',
        },
      })
    }
    return { endUserId: null, accessToken: headerOf(req, 'x-resume-access-token') }
  }

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async analyze(@Body() dto: JobFitRequestDto, @Req() req: ReqLike) {
    if (!dto.jobId && !dto.manualJob) {
      throw new BadRequestException({ error: { code: 'JOB_FIT_TARGET_MISSING', message: '请选择系统内岗位或填写目标岗位' } })
    }
    const requester = await this.requesterOf(req)
    return this.governed.analyzeForJobFit(dto, requester, quotaContextOf(req, requester))
  }

  @Post('consent')
  async grantConsent(@Body() dto: JobFitConsentDto, @Req() req: ReqLike) {
    const requester = this.anonymousConsentRequesterOf(req)
    return this.service.grantJobFitConsent(dto.taskId, requester)
  }

  @Get('consent/:taskId')
  async consentStatus(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    const requester = this.anonymousConsentRequesterOf(req)
    return this.service.getJobFitConsentStatus(taskId, requester)
  }

  @Delete('consent/:taskId')
  async revokeConsent(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    const requester = this.anonymousConsentRequesterOf(req)
    return this.service.revokeJobFitConsent(taskId, requester)
  }

  @Post(':taskId/print')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async print(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    return this.service.printReport(taskId, await this.requesterOf(req))
  }

  @Get(':taskId')
  async latest(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    return this.service.getLatest(taskId, await this.requesterOf(req))
  }
}
