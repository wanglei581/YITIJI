import { Controller, Get, Param, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { FairVisitPlanService } from './resume/fair-visit-plan.service'

interface ReqLike {
  headers?: Record<string, string | string[] | undefined>
}

function headerOf(req: ReqLike, name: string): string | null {
  const value = req.headers?.[name]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value) && value[0]) return value[0].trim()
  return null
}

@Controller('job-fairs/:fairId/visit-plan')
export class FairVisitPlanController {
  constructor(
    private readonly service: FairVisitPlanService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  private async requesterOf(req: ReqLike) {
    const member = await resolveOptionalEndUser(headerOf(req, 'authorization') ?? undefined, this.jwt, this.redis, this.prisma)
    if (member) return { endUserId: member.endUserId, accessToken: null }
    return { endUserId: null, accessToken: headerOf(req, 'x-resume-access-token') }
  }

  @Post(':taskId')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async generate(@Param('fairId') fairId: string, @Param('taskId') taskId: string, @Req() req: ReqLike) {
    return this.service.generate(fairId, taskId, await this.requesterOf(req))
  }

  @Get(':taskId')
  async latest(@Param('fairId') fairId: string, @Param('taskId') taskId: string, @Req() req: ReqLike) {
    return this.service.getLatest(fairId, taskId, await this.requesterOf(req))
  }

  @Post(':taskId/print')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async print(@Param('fairId') fairId: string, @Param('taskId') taskId: string, @Req() req: ReqLike) {
    return this.service.printPlan(fairId, taskId, await this.requesterOf(req))
  }
}
