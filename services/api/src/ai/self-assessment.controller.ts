import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common'
import { AiUse, AiUseExempt, MaintenanceBlocked, type AiUseKind } from '../ai-access/ai-access.decorator'
import { AiAccessService } from '../ai-access/ai-access.service'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { resolveClientIp } from '../common/client-ip'
import type { AuditContext } from './resume/self-assessment.service'
import { SelfAssessmentService } from './resume/self-assessment.service'
import { AppendedSelfAssessmentService } from './resume/appended-self-assessment.service'
import { PaidAiThrottle } from '../common/throttler/terminal-throttle'
import { AppendSelfAssessmentDto, SubmitSelfAssessmentDto } from './dto/self-assessment.dto'
import { SELF_ASSESSMENT_CONSENT_VERSION } from './resume/self-assessment.types'
import { SELF_ASSESSMENT_QUESTIONS_V1 } from './resume/self-assessment-questions'
import { aiGateRefusal, type SelfAssessmentAiGates } from './resume/self-assessment-interpretation'

interface ReqLike {
  headers?: Record<string, string | string[] | undefined>
  ip?: string
  socket?: { remoteAddress?: string }
  requestId?: string
}

function headerOf(req: ReqLike, name: string): string | null {
  const v = req.headers?.[name]
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (Array.isArray(v) && v[0]) return v[0].trim()
  return null
}

function auditContextOf(req: ReqLike): AuditContext {
  const ipAddress = resolveClientIp(req)
  const rawUa = headerOf(req, 'user-agent')
  const requestId =
    typeof req.requestId === 'string' && req.requestId.trim()
      ? req.requestId.trim()
      : headerOf(req, 'x-request-id')
  return {
    ipAddress: ipAddress ?? null,
    userAgent: rawUa ?? null,
    requestId: requestId ?? null,
  }
}

/**
 * 提交 / 打印 / 附加到简历三处不挂 @AiUse：维度打分是纯函数，AI 被拦时打分照常出。
 * 这三处的 AI 闸门改在接口里调同一个 AiAccessService.enforce：
 *   - 提交：解读前问一次，拦下就只回打分（interpretationAvailable=false + aiUnavailableReason）；
 *   - 打印 / 附加：记录里有 AI 解读时照旧过闸（原错误码原样抛），只有打分时不过 AI 闸门、文件不带 AIGC 标识。
 * 全机维护照旧拦（@MaintenanceBlocked），那是设备停办，不是 AI 闸门。
 */
const SCORING_EXEMPT_REASON =
  '维度打分是纯函数，不调模型；AI 解读是否调用由接口内按同一 AI 闸门判定，拦下时只回打分'
const RULE_ONLY_FILE_EXEMPT_REASON =
  '只有打分的报告不含 AI 内容、不写 AIGC 标识；含 AI 解读时接口内照旧过 AI 闸门'

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
    private readonly aiAccess: AiAccessService,
  ) {}

  private aiGates(req: ReqLike, exportKind: AiUseKind): SelfAssessmentAiGates {
    return {
      interpretation: () => aiGateRefusal(() => this.aiAccess.enforce('generate', false, req)),
      aiContentExport: () => this.aiAccess.enforce(exportKind, false, req),
    }
  }

  private async requesterOf(req: ReqLike) {
    const member = await resolveOptionalEndUser(headerOf(req, 'authorization') ?? undefined, this.jwt, this.redis, this.prisma)
    if (member) return { endUserId: member.endUserId, accessToken: null }
    return { endUserId: null, accessToken: headerOf(req, 'x-resume-access-token') }
  }

  @Post()
  @PaidAiThrottle(6)
  /**
   * `consent.consentVersion` 可选：现网前端只发两个布尔。缺省 ⇒ 记为「未版本化同意」；
   * 显式带旧版本 ⇒ 400 `SELF_ASSESSMENT_CONSENT_VERSION_STALE`，要求重新确认。
   * 判定逻辑集中在 service，controller 不做第二份版本比较（避免两处口径漂移）。
   */
  @AiUseExempt(SCORING_EXEMPT_REASON)
  @MaintenanceBlocked()
  async submit(
    @Body() body: SubmitSelfAssessmentDto,
    @Req() req: ReqLike,
  ) {
    return this.service.submit(await this.requesterOf(req), body, auditContextOf(req), this.aiGates(req, 'generate'))
  }

  /**
   * 题目下发。**这个装饰器必须排在 @Get(':taskId') 之前** ——
   * Nest 按声明顺序匹配，放后面 'questions' 会被当成 taskId 吃掉。
   * （同一个坑在 policies.controller.ts 的 eligibility-* 上踩过一次。）
   *
   * 为什么需要它：微信小程序是原生 JS、无构建、零依赖，**导不进
   * packages/shared 的题库模块**。Kiosk 能 import（Vite/TS），小程序不能。
   * 与其把 JSON 抄进小程序（文件名就叫 v1，v2 切换时必然静默漂移），
   * 不如由服务端下发——而且下发的正是本服务用来计分的那一份，
   * 从根上排除「题目和计分口径不一致」。
   *
   * 免登录：与 POST 同口径（submit 也允许匿名 x-resume-access-token）。
   * 只返回题目与同意版本，不含任何本人数据。
   */
  @Get('questions')
  @AiUse('read')

  questions() {
    return {
      version: SELF_ASSESSMENT_QUESTIONS_V1.version,
      dimensions: SELF_ASSESSMENT_QUESTIONS_V1.dimensions,
      consentVersion: SELF_ASSESSMENT_CONSENT_VERSION,
    }
  }

  @Get(':taskId')
  @AiUse('read')

  async latest(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    return this.service.getLatest(taskId, await this.requesterOf(req), auditContextOf(req))
  }

  @Post(':taskId/print')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @AiUseExempt(RULE_ONLY_FILE_EXEMPT_REASON)
  @MaintenanceBlocked()
  async print(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    return this.service.printReport(taskId, await this.requesterOf(req), auditContextOf(req), this.aiGates(req, 'export'))
  }

  /**
   * 合并「自我探索 + 简历 PDF」，生成新的可打印 PDF 文件。
   * 仅本人持有本人简历与自我探索记录时调用。
   */
  @Post(':taskId/append')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @AiUseExempt(RULE_ONLY_FILE_EXEMPT_REASON)
  @MaintenanceBlocked()
  async appendToResume(
    @Param('taskId') taskId: string,
    @Body() body: AppendSelfAssessmentDto,
    @Req() req: ReqLike,
  ) {
    return this.append.appendToResume({
      taskId,
      requester: await this.requesterOf(req),
      resumeFileId: body.resumeFileId,
      auditCtx: auditContextOf(req),
      // 含 AI 解读时照旧按改动前的 generate 档过闸（该接口不调模型，档位是否改成 export 待定）
      gates: this.aiGates(req, 'generate'),
    })
  }
  @Delete(':taskId')
  @AiUseExempt('撤回或删除本人数据，不调模型；AI 暂停、维护期间也必须能做')
  async withdraw(@Param('taskId') taskId: string, @Req() req: ReqLike) {
    return this.service.withdraw(taskId, await this.requesterOf(req), auditContextOf(req))
  }
}
