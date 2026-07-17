import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { parseMemberPageQuery } from '../common/utils/member-page'
import { MockInterviewService, type InterviewRequester } from './mock-interview.service'
import { AsrService, ASR_MAX_AUDIO_BYTES } from './asr/asr.service'
import { TtsService } from './asr/tts.service'

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

  /** 交互方式偏好:voice=语音回合制(文字兜底);text=纯文字 */
  @IsOptional() @IsIn(['text', 'voice'])
  interactionMode?: string
}

export class InterviewAnswerDto {
  @IsOptional() @IsString() @MaxLength(2000)
  answer?: string

  @IsOptional()
  skip?: boolean

  /** 本回合输入方式(2C+):voice=语音转写后确认提交 */
  @IsOptional() @IsIn(['text', 'voice'])
  inputMode?: string

  /** 语音转写原文(用户编辑前;answer=最终确认文本) */
  @IsOptional() @IsString() @MaxLength(2000)
  transcriptText?: string

  /** 用户是否编辑过转写 */
  @IsOptional() @IsBoolean()
  transcriptEdited?: boolean

  /** 回答耗时(秒,前端计时;1-600) */
  @IsOptional() @IsInt() @Min(0) @Max(600)
  answerDurationSec?: number
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
    private readonly asr: AsrService,
    private readonly tts: TtsService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  private async requesterOf(req: ReqLike): Promise<InterviewRequester> {
    const auth = headerOf(req, 'authorization')
    const member = await resolveOptionalEndUser(auth ?? undefined, this.jwt, this.redis, this.prisma)
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
    return ApiResponse.ok(await this.service.answer(id, {
      answer: dto.answer,
      skip: dto.skip === true,
      inputMode: dto.inputMode === 'voice' ? 'voice' : 'text',
      transcriptText: dto.transcriptText,
      transcriptEdited: dto.transcriptEdited === true,
      answerDurationSec: dto.answerDurationSec,
    }, await this.requesterOf(req)))
  }

  /**
   * 语音回答转写(2C+):上传一段 16k 单声道 WAV → 转写文本(不落库、音频不落盘)。
   * 转写文本由用户在前端确认/编辑后随 /answer 提交。归属门禁与会话一致。
   */
  @Post(':id/transcribe')
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: ASR_MAX_AUDIO_BYTES, fieldNestingDepth: 0 } as { fieldNestingDepth: number; fileSize?: number } }))
  async transcribe(
    @Param('id') id: string,
    @UploadedFile() audio: Express.Multer.File | undefined,
    @Req() req: ReqLike,
  ) {
    // 先做归属校验(借 getSession 的门禁;不存在/越权统一 404),再消费音频
    await this.service.getSession(id, await this.requesterOf(req))
    if (!audio?.buffer?.length) {
      throw new BadRequestException({ error: { code: 'AUDIO_MISSING', message: '缺少音频内容' } })
    }
    const result = await this.asr.recognizeWav(audio.buffer)
    if (!result.ok) {
      throw new BadRequestException({ error: { code: result.errorCode ?? 'ASR_FAILED', message: result.errorMessage ?? '语音转写失败' } })
    }
    return ApiResponse.ok({ text: result.text })
  }

  /**
   * 面试官问题语音播报(2C+,腾讯官方 TTS,小青同音色):
   * 只为本会话已落库的 interviewer 轮次合成(不开放任意文本,防滥用;
   * 问题文本生成时已过禁词扫描)。失败 → 前端降级浏览器本地 TTS。
   */
  @Post(':id/turns/:idx/audio')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async questionAudio(@Param('id') id: string, @Param('idx') idx: string, @Req() req: ReqLike) {
    const session = await this.service.getSession(id, await this.requesterOf(req))
    const turnIdx = Number(idx)
    const turn = session.turns.find((t) => t.idx === turnIdx)
    if (!turn || turn.role !== 'interviewer') {
      throw new BadRequestException({ error: { code: 'TURN_NOT_FOUND', message: '该轮次不存在或不是面试官提问' } })
    }
    const result = await this.tts.synthesize(turn.content)
    if (!result.ok) {
      throw new BadRequestException({ error: { code: 'TTS_FAILED', message: result.errorMessage ?? '语音合成失败' } })
    }
    return ApiResponse.ok({ audio: result.audio, format: 'mp3' })
  }

  /** 语音能力可用性(前端进入会话页时探测;不可用自动回退文字输入) */
  @Get('capabilities/voice')
  voiceCapability() {
    return ApiResponse.ok({ asrEnabled: this.asr.enabled, ttsEnabled: this.tts.enabled })
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
