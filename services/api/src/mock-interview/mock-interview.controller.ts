import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { RedisService } from '../common/redis/redis.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { parseMemberPageQuery } from '../common/utils/member-page'
import { MockInterviewService, type InterviewRequester } from './mock-interview.service'

// ── DTO（全局 forbidNonWhitelisted：未知字段直接 400）─────────────────────────

const INTERVIEWER_TYPES = ['hr', 'manager', 'tech', 'campus', 'final'] as const
const EXPERIENCES = ['fresh', 'lt1', 'y1_3', 'y3_5', 'gt5', 'switch'] as const
const DIFFICULTIES = ['easy', 'standard', 'pressure'] as const

export class CreateInterviewDto {
  @IsIn([...INTERVIEWER_TYPES])
  interviewerType!: string

  @IsString() @IsNotEmpty() @MaxLength(30)
  industry!: string

  @IsString() @IsNotEmpty() @MaxLength(50)
  position!: string

  @IsIn([...EXPERIENCES])
  experience!: string

  @IsIn([...DIFFICULTIES])
  difficulty!: string

  @IsInt() @IsIn([3, 5, 8])
  durationMin!: number

  @IsOptional() @IsString() @MaxLength(64)
  resumeFileId?: string
}

export class InterviewAnswerDto {
  @IsOptional() @IsString() @MaxLength(2000)
  answer?: string

  @IsOptional()
  skip?: boolean
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
 * 2C 模拟面试接口（/api/v1/mock-interviews）。
 *
 * 归属：登录会员 Bearer（结果按 endUserId 本人校验）；匿名凭创建时一次性下发的
 * x-interview-access-token。任何越权统一 NOT_FOUND。
 * 限流：创建/答题/结束触发 LLM 调用，公共一体机单 IP 收紧。
 */
@Controller('mock-interviews')
export class MockInterviewController {
  constructor(
    private readonly service: MockInterviewService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  private async requesterOf(req: ReqLike): Promise<InterviewRequester> {
    const auth = headerOf(req, 'authorization')
    const member = await resolveOptionalEndUser(auth ?? undefined, this.jwt, this.redis)
    if (member) return { endUserId: member.endUserId, accessToken: null }
    return { endUserId: null, accessToken: headerOf(req, 'x-interview-access-token') }
  }

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async create(@Body() dto: CreateInterviewDto, @Req() req: ReqLike) {
    const requester = await this.requesterOf(req)
    return ApiResponse.ok(await this.service.createSession(dto, requester))
  }

  @Post(':id/start')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async start(@Param('id') id: string, @Req() req: ReqLike) {
    return ApiResponse.ok(await this.service.start(id, await this.requesterOf(req)))
  }

  @Post(':id/answer')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async answer(@Param('id') id: string, @Body() dto: InterviewAnswerDto, @Req() req: ReqLike) {
    return ApiResponse.ok(await this.service.answer(id, { answer: dto.answer, skip: dto.skip === true }, await this.requesterOf(req)))
  }

  @Post(':id/end')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async end(@Param('id') id: string, @Req() req: ReqLike) {
    return ApiResponse.ok(await this.service.end(id, await this.requesterOf(req)))
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: ReqLike) {
    return ApiResponse.ok(await this.service.getSession(id, await this.requesterOf(req)))
  }

  @Get(':id/report')
  async report(@Param('id') id: string, @Req() req: ReqLike) {
    return ApiResponse.ok(await this.service.getReport(id, await this.requesterOf(req)))
  }

  @Post(':id/report/print')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async print(@Param('id') id: string, @Req() req: ReqLike) {
    return ApiResponse.ok(await this.service.printReport(id, await this.requesterOf(req)))
  }
}

/** 会员历史练习记录（/api/v1/me/mock-interviews，EndUserAuthGuard 保护）。 */
@Controller('me/mock-interviews')
@UseGuards(EndUserAuthGuard)
export class MemberMockInterviewController {
  constructor(private readonly service: MockInterviewService) {}

  @Get()
  async list(
    @CurrentEndUser() user: AuthedEndUser,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const page = parseMemberPageQuery(cursor, pageSize)
    return ApiResponse.ok(await this.service.listMine(user.endUserId, page.cursor, page.pageSize))
  }

  @Delete(':id')
  async remove(@CurrentEndUser() user: AuthedEndUser, @Param('id') id: string) {
    return ApiResponse.ok(await this.service.deleteMine(user.endUserId, id))
  }
}
