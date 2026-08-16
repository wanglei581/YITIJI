import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { AdvisorService } from './advisor.service'
import { ADVISOR_SKILLS, EVIDENCE_LEVELS, type AdvisorSkill } from './advisor-skills'

// ============================================================
// S3-3 · P26 顾问作业面（/api/v1/advisor）—— 前端 /ai/plan 的后端。
//
// 归属：会员 Bearer 或匿名 x-advisor-access-token（建会话时铸，只回传一次），
// 与 2E 职业规划 / 2C 模拟面试同口径。
//
// 限流：一体机是公共设备，所有触发模型的端点单 IP 收紧；
// 只读端点（会话读取）不限流，否则 AI 挂掉时用户连已有进度都刷不出来。
// ============================================================

interface ReqLike {
  headers?: Record<string, string | string[] | undefined>
}

function headerOf(req: ReqLike, name: string): string | null {
  const v = req.headers?.[name]
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (Array.isArray(v) && v[0]) return v[0].trim()
  return null
}

// ── DTO（全局 forbidNonWhitelisted：未知字段直接 400）─────────────────────────

export class CreateAdvisorSessionDto {
  /** 用户的原始诉求。服务端据此判型，用户不需要自己选型。 */
  @IsString() @IsNotEmpty() @MaxLength(600)
  topic!: string
}

export class SwitchSkillDto {
  @IsIn([...ADVISOR_SKILLS])
  skill!: string
}

export class FillSlotDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  slotKey!: string

  /** 上限按槽位 spec 再截断一次，这里只做粗粒度防滥用 */
  @IsString() @IsNotEmpty() @MaxLength(8000)
  value!: string
}

export class AskDto {
  @IsString() @IsNotEmpty() @MaxLength(600)
  question!: string
}

export class PinDto {
  @IsString() @IsNotEmpty() @MaxLength(1200)
  content!: string

  @IsIn([...EVIDENCE_LEVELS])
  evidenceLevel!: string

  @IsOptional() @IsString() @MaxLength(200)
  sourceNote?: string
}

@Controller('advisor')
export class AdvisorController {
  constructor(
    private readonly service: AdvisorService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  private async requesterOf(req: ReqLike) {
    const member = await resolveOptionalEndUser(headerOf(req, 'authorization') ?? undefined, this.jwt, this.redis, this.prisma)
    if (member) return { endUserId: member.endUserId, accessToken: null }
    return { endUserId: null, accessToken: headerOf(req, 'x-advisor-access-token') }
  }

  /**
   * 顾问是否可用。
   *
   * 不可用**不是错误**（返回 200 + available:false），前端据此走 result-unavailable 诚实态：
   * 这一页不给新结论，但已有内容照常可读可打印，其它功能不受影响。
   */
  @Get('availability')
  availability() {
    return this.service.availability()
  }

  @Post('sessions')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async create(@Body() dto: CreateAdvisorSessionDto, @Req() req: ReqLike) {
    return this.service.createSession(dto.topic, await this.requesterOf(req))
  }

  /** 只读：刷新恢复 / 换设备继续。刻意不限流 —— AI 挂了也要能看到已有进度。 */
  @Get('sessions/:sessionId')
  async get(@Param('sessionId') sessionId: string, @Req() req: ReqLike) {
    return this.service.getSession(sessionId, await this.requesterOf(req))
  }

  /** 判错了一键换型；已填输入槽不丢。 */
  @Patch('sessions/:sessionId/skill')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async switchSkill(
    @Param('sessionId') sessionId: string,
    @Body() dto: SwitchSkillDto,
    @Req() req: ReqLike,
  ) {
    return this.service.switchSkill(sessionId, dto.skill as AdvisorSkill, await this.requesterOf(req))
  }

  /** 分次补充输入。不触发模型，所以限流宽松。 */
  @Post('sessions/:sessionId/slots')
  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  async fillSlot(
    @Param('sessionId') sessionId: string,
    @Body() dto: FillSlotDto,
    @Req() req: ReqLike,
  ) {
    return this.service.fillSlot(sessionId, dto.slotKey, dto.value, await this.requesterOf(req))
  }

  /** 出活：按当前作业型生成产物并落库。必填项没答完时 400 并回报缺哪几项。 */
  @Post('sessions/:sessionId/run')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async run(@Param('sessionId') sessionId: string, @Req() req: ReqLike) {
    return this.service.run(sessionId, await this.requesterOf(req))
  }

  /** 问答型追问：在同一会话上继续，不是每次从零。 */
  @Post('sessions/:sessionId/ask')
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  async ask(@Param('sessionId') sessionId: string, @Body() dto: AskDto, @Req() req: ReqLike) {
    return this.service.ask(sessionId, dto.question, await this.requesterOf(req))
  }

  /** 钉住一条。这是问答型唯一会跨请求留下的动作。 */
  @Post('sessions/:sessionId/pins')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async pin(@Param('sessionId') sessionId: string, @Body() dto: PinDto, @Req() req: ReqLike) {
    return this.service.pin(sessionId, dto, await this.requesterOf(req))
  }

  @Delete('sessions/:sessionId/pins/:pinId')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async unpin(
    @Param('sessionId') sessionId: string,
    @Param('pinId') pinId: string,
    @Req() req: ReqLike,
  ) {
    return this.service.unpin(sessionId, pinId, await this.requesterOf(req))
  }

  /**
   * 产物打印版：PDF → 我的文档 → 打印订单。
   *
   * 这条链路**不调模型**：AI 不可用时已生成的产物仍然打得出来（设计页硬要求）。
   */
  @Post('sessions/:sessionId/artifacts/:artifactId/print')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async print(
    @Param('sessionId') sessionId: string,
    @Param('artifactId') artifactId: string,
    @Req() req: ReqLike,
  ) {
    return this.service.printArtifact(sessionId, artifactId, await this.requesterOf(req))
  }
}
