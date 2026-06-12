import { Controller, Get, Param, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import { RedisService } from '../common/redis/redis.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { CareerPlanService } from './resume/career-plan.service'

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
 * 2E 职业规划（/api/v1/resume/career-plan）。
 *
 * 归属凭 parse 行门禁（会员 Bearer / 匿名 x-resume-access-token，对齐 C-2A）。
 * 合规：仅供本人参考；无薪资/录用/Offer/通过率承诺（服务端双层拦截）。
 * 限流：生成与打印触发 LLM/PDF，公共一体机单 IP 收紧。
 */
@Controller('resume/career-plan')
export class CareerPlanController {
  constructor(
    private readonly service: CareerPlanService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  private async requesterOf(req: ReqLike) {
    const member = await resolveOptionalEndUser(headerOf(req, 'authorization') ?? undefined, this.jwt, this.redis)
    if (member) return { endUserId: member.endUserId, accessToken: null }
    return { endUserId: null, accessToken: headerOf(req, 'x-resume-access-token') }
  }

  @Post(':taskId')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async generate(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    return this.service.generate(taskId, await this.requesterOf(req))
  }

  @Get(':taskId')
  async latest(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    return this.service.getLatest(taskId, await this.requesterOf(req))
  }

  @Post(':taskId/print')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async print(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    return this.service.printPlan(taskId, await this.requesterOf(req))
  }
}
