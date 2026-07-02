import { BadRequestException, Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import { IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { RedisService } from '../common/redis/redis.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { JobMasterService } from './resume/job-master.service'

// ── DTO（全局 forbidNonWhitelisted）─────────────────────────────────────────

class ManualJobDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  title!: string

  @IsOptional() @IsString() @MaxLength(2000)
  requirements?: string
}

export class JobMasterRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  taskId!: string

  @IsOptional() @IsString() @MaxLength(64)
  jobId?: string

  @IsOptional() @ValidateNested() @Type(() => ManualJobDto)
  manualJob?: ManualJobDto
}

interface ReqLike {
  headers?: Record<string, string | string[] | undefined>
}

function headerOf(req: ReqLike, name: string): string | null {
  const v = req.headers?.[name]
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (Array.isArray(v) && v[0]) return v[0].trim()
  return null
}

/**
 * 岗位大师（岗位决策分析台，/api/v1/resume/job-master）。
 *
 * 归属凭 parse 行门禁（会员 Bearer / 匿名 x-resume-access-token，对齐 C-2A）。
 * 合规：适配度为参考等级（无百分比/录用概率，服务端双层拦截）；薪资只透传来源方
 * 文本；风险定性三档。投递只引导「去来源平台投递」。限流：触发 LLM，公共一体机
 * 单 IP 收紧（对齐 job-fit 6 次/分钟）。POST :taskId/print 生成决策报告 PDF 进打印链路。
 */
@Controller('resume/job-master')
export class JobMasterController {
  constructor(
    private readonly service: JobMasterService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  private async requesterOf(req: ReqLike) {
    const member = await resolveOptionalEndUser(headerOf(req, 'authorization') ?? undefined, this.jwt, this.redis)
    if (member) return { endUserId: member.endUserId, accessToken: null }
    return { endUserId: null, accessToken: headerOf(req, 'x-resume-access-token') }
  }

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async analyze(@Body() dto: JobMasterRequestDto, @Req() req: ReqLike) {
    if (!dto.jobId && !dto.manualJob) {
      throw new BadRequestException({ error: { code: 'JOB_MASTER_TARGET_MISSING', message: '请选择系统内岗位或填写目标岗位' } })
    }
    return this.service.analyze(dto, await this.requesterOf(req))
  }

  @Get(':taskId')
  async latest(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    return this.service.getLatest(taskId, await this.requesterOf(req))
  }

  @Post(':taskId/print')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async print(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    return this.service.printReport(taskId, await this.requesterOf(req))
  }
}
