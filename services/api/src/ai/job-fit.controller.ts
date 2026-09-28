import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common'
import { AiUse, AiUseExempt } from '../ai-access/ai-access.decorator'
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

import { resolveClientIp } from '../common/client-ip'
import { PaidAiThrottle } from '../common/throttler/terminal-throttle'
import {
  isRecruitmentContentHostingEnabled,
  recruitmentHostingDisabledException,
} from '../recruitment-hosting/recruitment-hosting'
import {
  KIOSK_JOB_BOARD_DISABLED_CODE,
  KioskJobBoardService,
  kioskJobBoardTerminalRef,
  type KioskJobBoardRequest,
} from '../terminals/kiosk-job-board.service'
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

function ipOf(req: unknown): string | null {
  return resolveClientIp(req)
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
    private readonly jobBoard?: KioskJobBoardService,
  ) {}

  /**
   * 岗位板块只拦系统内岗位。手填岗位要求和手填存档在板块关闭时仍可用。
   * 运行时探针若没注入开关服务，assertOpen 不存在，保持原配额测试路径。
   */
  private async assertJobBoard(req: ReqLike): Promise<void> {
    const gate = this.jobBoard as { assertOpen?: (terminalRef: string | null) => Promise<void> } | undefined
    if (!gate || typeof gate.assertOpen !== 'function') return
    await gate.assertOpen(kioskJobBoardTerminalRef(req as KioskJobBoardRequest))
  }

  /** 板块开着，或这台终端没有开关服务。关闭时返回 false，其它错误原样抛出。 */
  private async jobBoardOpen(req: ReqLike): Promise<boolean> {
    try {
      await this.assertJobBoard(req)
      return true
    } catch (error) {
      const response = (error as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()
      if (response?.error?.code === KIOSK_JOB_BOARD_DISABLED_CODE) return false
      throw error
    }
  }

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
  @PaidAiThrottle(6)
  @AiUse('generate')

  async analyze(@Body() dto: JobFitRequestDto, @Req() req: ReqLike) {
    // 两道开关都只拦系统内 jobId。手填岗位要求在板块关闭、托管关闭时都照常可用。
    if (dto.jobId) await this.assertJobBoard(req)
    if (!isRecruitmentContentHostingEnabled() && dto.jobId) throw recruitmentHostingDisabledException()
    if (!dto.jobId && !dto.manualJob) {
      throw new BadRequestException({ error: { code: 'JOB_FIT_TARGET_MISSING', message: '请选择系统内岗位或填写目标岗位' } })
    }
    const requester = await this.requesterOf(req)
    return this.governed.analyzeForJobFit(dto, requester, quotaContextOf(req, requester))
  }

  @Post('consent')
  @AiUse('read')

  async grantConsent(@Body() dto: JobFitConsentDto, @Req() req: ReqLike) {
    const requester = this.anonymousConsentRequesterOf(req)
    return this.service.grantJobFitConsent(dto.taskId, requester)
  }

  @Get('consent/:taskId')
  @AiUse('read')

  async consentStatus(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    const requester = this.anonymousConsentRequesterOf(req)
    return this.service.getJobFitConsentStatus(taskId, requester)
  }
  @Delete('consent/:taskId')
  @AiUseExempt('撤回或删除本人数据，不调模型；AI 暂停、维护期间也必须能做')
  async revokeConsent(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    const requester = this.anonymousConsentRequesterOf(req)
    return this.service.revokeJobFitConsent(taskId, requester)
  }

  @Post(':taskId/print')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @AiUse('export')

  async print(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    // 先把板块是否打开交给服务；服务读完存档再决定。手填放行，系统内岗位拒绝。
    return this.service.printReport(taskId, await this.requesterOf(req), await this.jobBoardOpen(req))
  }

  @Get(':taskId')
  @AiUse('read')

  async latest(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    return this.service.getLatest(taskId, await this.requesterOf(req), await this.jobBoardOpen(req))
  }
}
