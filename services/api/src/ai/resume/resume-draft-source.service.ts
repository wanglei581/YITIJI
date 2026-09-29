/**
 * 简历「按原样导出」的正文来源（#1105 追加，总指挥 9/29 裁定 A+B）。
 *
 * 按原样导出（POST /resume/generate/export，draft=true）不查简历 AI 授权、不被 AI 闸门挡，
 * 产物不带 AI 标识、元数据写「非 AI」。所以它只许导出用户自己写的字——draft 标记不能只信客户端：
 *
 *   A. 带生成任务号：一律按任务号取生成时留存的原始填写（kind='generate_input'，与生成结果同一条留存、
 *      同一个到期时间、同一个归属与匿名令牌）来渲染，客户端正文一个字都不用；取不到（过期 / 不是本人 /
 *      不存在）就拒绝，给人话和下一步。
 *   B. 不带任务号（AI 挂了从头手填）：仍用客户端正文，但任何一段与比对范围内的 AI 结果逐字相同
 *      （规范化后）就拒绝 409，下一步是「导出 AI 版（带标识）」。比对范围：
 *        - 会员：本人保留期内的 AI 结果；在一体机上再并上本台本次使用里生成的；
 *        - 匿名在已验签的一体机上：本台本次使用（KioskSession 进行中那一段）里生成的；
 *          没有进行中的使用记录，退到本台保留期内生成的；
 *        - 匿名且不在已验签的一体机上（没带或验不过 x-terminal-id + x-terminal-session-token）：
 *          保留期内全部 AI 结果——拿不到身份就按最严的范围核对，匿名不能因此被排除在核对之外。
 *
 * 一体机身份只认已验签的终端票（TerminalSessionService.validate，与发短信验证码同一道），
 * 不认裸 x-terminal-id（客户端可伪造）。
 *
 * 为什么不放进 ai.controller.ts / ai.service.ts：两者分别已超 800 / 1000 行，按规模规则不得再加逻辑。
 */
import { ConflictException, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { TerminalSessionService } from '../../terminals/terminal-session.service'
import type { AiResultRequester } from '../ai.service'
import { verifyAccessToken } from '../ai.service'
import type { GeneratedResume, GenerateResumeOutput, OptimizeResumeOutput, ResumeGenerateInput } from '../interfaces/ai-provider.interface'
import {
  aiParagraphsOfResume,
  comparableParagraphs,
  findAiOverlap,
  inputAsDraftResume,
  inputTexts,
  ownTextOf,
  pickRenderableInput,
  RESUME_GENERATE_INPUT_KIND,
  type AiTextSource,
} from './resume-draft-ai-overlap'

export { RESUME_GENERATE_INPUT_KIND }


/** 比对只看模型写过字的两类结果。 */
const AI_TEXT_KINDS = ['generate', 'optimize'] as const

/**
 * 单次核对最多读多少条 AI 结果（按最近更新倒序）。会员与单台一体机远达不到；
 * 只有「匿名且不在一体机上」的最宽范围可能碰到，超出部分是保留期里更早的结果。
 */
const MAX_COMPARED_RESULTS = 500

interface HeaderedRequest { headers: Record<string, string | string[] | undefined> }

function headerOf(req: HeaderedRequest, name: string): string | undefined {
  const value = req.headers[name]
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first.trim() ? first.trim() : undefined
}

@Injectable()
export class ResumeDraftSourceService {
  private readonly logger = new Logger(ResumeDraftSourceService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly terminalSessions?: TerminalSessionService,
  ) {}

  /** 已验签的一体机编号；没带、验不过、校验暂不可用一律按「不在一体机上」处理（范围更宽，不是更松）。 */
  async verifiedTerminalId(req: HeaderedRequest): Promise<string | null> {
    const terminalId = headerOf(req, 'x-terminal-id')?.slice(0, 64)
    if (!terminalId || !this.terminalSessions) return null
    try {
      await this.terminalSessions.validate(terminalId, headerOf(req, 'x-terminal-session-token'))
      return terminalId
    } catch {
      return null
    }
  }

  /**
   * 生成之后立刻留存原始填写，并给 generate 结果记上一体机编号。
   * 归属、匿名令牌、到期时间一律照抄同一任务的 generate 行，不单独延长。
   * 写不进去就失败关闭（同 AI 结果持久化）：否则这次生成既取不回原话、匿名也核对不到。
   */
  async recordGenerateInput(taskId: string, input: ResumeGenerateInput, req: HeaderedRequest): Promise<void> {
    const terminalId = await this.verifiedTerminalId(req)
    try {
      const generated = await this.prisma.aiResumeResult.findUnique({
        where: { taskId_kind: { taskId, kind: 'generate' } },
        select: { endUserId: true, accessTokenHash: true, expiresAt: true, provider: true },
      })
      if (!generated) throw new Error('generate row missing')
      const same = {
        status: 'completed',
        payloadJson: JSON.stringify(pickRenderableInput(input)),
        provider: generated.provider,
        endUserId: generated.endUserId,
        accessTokenHash: generated.accessTokenHash,
        expiresAt: generated.expiresAt,
        terminalId,
      }
      await this.prisma.$transaction([
        this.prisma.aiResumeResult.upsert({
          where: { taskId_kind: { taskId, kind: RESUME_GENERATE_INPUT_KIND } },
          create: { taskId, kind: RESUME_GENERATE_INPUT_KIND, ...same },
          update: same,
        }),
        this.prisma.aiResumeResult.updateMany({ where: { taskId, kind: 'generate' }, data: { terminalId } }),
      ])
    } catch (err) {
      this.logger.error(`简历原始填写留存失败 taskId=${taskId}: ${err instanceof Error ? err.message : String(err)}`)
      throw new ServiceUnavailableException({
        error: { code: 'AI_RESULT_PERSISTENCE_FAILED', message: 'AI 结果保存失败，请稍后重试' },
      })
    }
  }

  /** 优化结果（按 parse 任务号）记上一体机编号；已经记过的不改。 */
  async tagOptimizeTerminal(taskId: string, req: HeaderedRequest): Promise<void> {
    const terminalId = await this.verifiedTerminalId(req)
    if (!terminalId) return
    await this.prisma.aiResumeResult.updateMany({ where: { taskId, kind: 'optimize', terminalId: null }, data: { terminalId } })
  }

  /** 按原样导出实际要渲染的正文（A / B 两条路见文件头）。 */
  async resolveDraftResume(
    clientResume: GeneratedResume,
    taskId: string | undefined,
    requester: AiResultRequester,
    req: HeaderedRequest,
  ): Promise<GeneratedResume> {
    if (taskId) return inputAsDraftResume(await this.loadOwnInput(taskId, requester))
    const hits = findAiOverlap(clientResume, await this.comparableAiSources(requester, req))
    if (hits.length > 0) {
      throw new ConflictException({
        error: {
          code: 'RESUME_DRAFT_CONTAINS_AI_OUTPUT',
          message: '这份内容里有 AI 润色过的段落，不能按原样导出。可以导出 AI 版（带标识），或把这些段落改成自己的话再导出。',
          details: hits,
          nextAction: 'export_ai_labeled',
        },
      })
    }
    return clientResume
  }

  private async loadOwnInput(taskId: string, requester: AiResultRequester): Promise<ResumeGenerateInput> {
    const row = await this.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId, kind: RESUME_GENERATE_INPUT_KIND } },
      select: { payloadJson: true, endUserId: true, accessTokenHash: true, expiresAt: true },
    })
    const owned = row && row.expiresAt && row.expiresAt.getTime() > Date.now() && (row.endUserId
      ? requester.endUserId === row.endUserId
      : Boolean(row.accessTokenHash) && verifyAccessToken(requester.accessToken, row.accessTokenHash as string))
    const input = owned ? parseJson<ResumeGenerateInput>(row.payloadJson) : null
    if (!input?.basic || !input.intention) {
      throw new NotFoundException({
        error: {
          code: 'RESUME_DRAFT_SOURCE_NOT_FOUND',
          message: '这次填写的内容已经过了保存时间，或不是在当前账号下填写的，没法按原来的内容导出。请核对表格后重新导出。',
          nextAction: 'export_draft_from_form',
        },
      })
    }
    return input
  }

  private async comparisonScope(requester: AiResultRequester, req: HeaderedRequest): Promise<Prisma.AiResumeResultWhereInput> {
    const terminalId = await this.verifiedTerminalId(req)
    let terminalScope: Prisma.AiResumeResultWhereInput | null = null
    if (terminalId) {
      const session = await this.prisma.kioskSession.findFirst({
        where: { terminalId, endedAt: null, isExpired: false, expiresAt: { gt: new Date() } },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      })
      terminalScope = session ? { terminalId, updatedAt: { gte: session.startedAt } } : { terminalId }
    }
    if (requester.endUserId) return { OR: [{ endUserId: requester.endUserId }, ...(terminalScope ? [terminalScope] : [])] }
    return terminalScope ?? {}
  }

  private async comparableAiSources(requester: AiResultRequester, req: HeaderedRequest): Promise<AiTextSource[]> {
    const rows = await this.prisma.aiResumeResult.findMany({
      where: { AND: [{ kind: { in: [...AI_TEXT_KINDS] }, expiresAt: { gt: new Date() } }, await this.comparisonScope(requester, req)] },
      select: { taskId: true, kind: true, payloadJson: true },
      orderBy: { updatedAt: 'desc' },
      take: MAX_COMPARED_RESULTS,
    })
    const generateIds = rows.filter((r) => r.kind === 'generate').map((r) => r.taskId)
    const inputs = generateIds.length === 0 ? [] : await this.prisma.aiResumeResult.findMany({
      where: { taskId: { in: generateIds }, kind: RESUME_GENERATE_INPUT_KIND },
      select: { taskId: true, payloadJson: true },
    })
    const inputByTask = new Map(inputs.map((r) => [r.taskId, parseJson<ResumeGenerateInput>(r.payloadJson)]))
    return rows.map((row): AiTextSource => {
      if (row.kind === 'generate') {
        const out = parseJson<GenerateResumeOutput>(row.payloadJson)
        return { paragraphs: aiParagraphsOfResume(out?.resume), ownText: ownTextOf(inputTexts(inputByTask.get(row.taskId))) }
      }
      const out = parseJson<OptimizeResumeOutput>(row.payloadJson)
      const modules = out?.modules ?? []
      return {
        paragraphs: [...aiParagraphsOfResume(out?.optimizedResume), ...modules.flatMap((m) => comparableParagraphs(m?.after))],
        // 优化的原话是上传的简历；这里只有各模块「改前」摘出来的那几段，够判断 AI 是否原样照抄。
        ownText: ownTextOf(modules.map((m) => m?.before)),
      }
    }).filter((s) => s.paragraphs.length > 0)
  }
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
