import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { SelfAssessmentService } from './resume/self-assessment.service'
import { AppendedSelfAssessmentService } from './resume/appended-self-assessment.service'
import type { SelfAssessmentAnswerV1 } from './resume/self-assessment.types'

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
 * 自我探索 · 倾向参考（/api/v1/resume/self-assessment）。
 *
 * 合规口径（与 docs/compliance/compliance-boundary.md §4.5 同档）：
 * - 不做临床 / 心理 / 人格诊断；不复用 MBTI / 大五 / DISC / 霍兰德标签；
 * - 结果对本人可见，对企业 / 合作机构 / Partner / Admin 不可见；不参与匹配 / 排序。
 * - 答案原文不入库，匿名 session 仅会话内存。
 * - 撤回 = 物理删除 payload 字段，保留行用于审计。
 *
 * 限流：公共一体机单 IP 收紧；本端点不依赖现有 parse 任务（独立闸门）。
 */
@Controller('resume/self-assessment')
export class SelfAssessmentController {
  constructor(
    private readonly service: SelfAssessmentService,
    private readonly append: AppendedSelfAssessmentService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  private async requesterOf(req: ReqLike) {
    const member = await resolveOptionalEndUser(headerOf(req, 'authorization') ?? undefined, this.jwt, this.redis, this.prisma)
    if (member) return { endUserId: member.endUserId, accessToken: null }
    return { endUserId: null, accessToken: headerOf(req, 'x-resume-access-token') }
  }

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async submit(
    @Body() body: { answers: SelfAssessmentAnswerV1[]; consent: { nonSensitive: boolean; sensitive: boolean } },
    @Req() req: ReqLike,
  ) {
    return this.service.submit(await this.requesterOf(req), body)
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

  /**
   * 合并「自我探索 + 简历 PDF」，生成新的可打印 PDF 文件。
   * 仅本人持有本人简历与自我探索记录时调用。
   */
  @Post(':taskId/append')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async appendToResume(
    @Param('taskId') taskId: string,
    @Body() body: { resumeFileId: string },
    @Req() req: ReqLike,
  ) {
    return this.append.appendToResume({
      taskId,
      requester: await this.requesterOf(req),
      resumeFileId: body.resumeFileId,
    })
  }

  @Delete(':taskId')
  async withdraw(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    return this.service.withdraw(taskId, await this.requesterOf(req))
  }
}
