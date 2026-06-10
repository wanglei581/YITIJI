import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import type { AiProvider, AiProviderName, ParseResumeInput, ParseResumeOutput, OptimizeResumeOutput, ChatInput, ChatOutput } from './interfaces/ai-provider.interface'
import { MockAiProvider } from './providers/mock.provider'
import { OpenAiProvider } from './providers/openai.provider.stub'
import { ClaudeProvider } from './providers/claude.provider.stub'
import { LocalAiProvider } from './providers/local.provider.stub'
import { QwenProvider } from './providers/qwen.provider.stub'
import { ZhipuProvider } from './providers/zhipu.provider.stub'
import { LlmResumeProvider } from './providers/llm.provider'
import { AiLogService } from './ai-log.service'
import { LlmConfigService } from './llm/llm-config.service'
import { LlmChatService } from './llm/llm-chat.service'
import { ResumeExtractionService } from './resume/resume-extraction.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'

// 简历派生结果留存窗口(CLAUDE.md §11「不长期保存简历」)。
// MockProvider 阶段 payload 仅诊断评分 / 通用建议文本;接真 provider 后
// before/after 可能含简历原文摘录,到期即清理,不让其长期留存。
// 可经 env AI_RESUME_RESULT_TTL_HOURS 覆盖,默认 24h(覆盖一次 kiosk 会话 + 当日返回)。
const AI_RESUME_RESULT_TTL_HOURS = ((): number => {
  const raw = Number(process.env['AI_RESUME_RESULT_TTL_HOURS'])
  return Number.isFinite(raw) && raw > 0 ? raw : 24
})()

// ============================================================
// AiService — 选择 provider 并统一处理日志
//
// 切换提供商：修改服务端 env AI_PROVIDER（默认 mock）
// - 未知值启动时立即抛出，不允许静默 fallback 到 mock
// - qwen/zhipu 未实现时走各自 stub（抛 NotImplementedException）
// - task 不存在时抛 NotFoundException(AI_TASK_NOT_FOUND)
//
// 结果持久化（HIGH-6）：
// - 解析 / 优化结果写入 AiResumeResult 表（taskId + kind 唯一），
//   替换原进程内 Map。API 重启 / 多实例后 GET /resume/records/:taskId 仍可读。
// - payloadJson 当前（MockAiProvider）只存诊断评分 / 通用优化建议文本，不含简历原文 / 候选人 PII。
//
// 留存治理（CLAUDE.md §11「不长期保存简历」，已落地）：
// - persistResult 写入 expiresAt = now + AI_RESUME_RESULT_TTL_HOURS（默认 24h）。
// - loadResult 把已过期行 + 无 expiresAt 的迁移前历史行都视为不存在（不返回简历派生内容，即便 cron 尚未清扫）。
// - cleanupExpiredResults + AiResultCleanupTask（每小时 cron）硬删过期行 + NULL 历史行并写 system 审计。
//   接入真实 AI provider（before/after 可能含简历摘录）后无需再改留存逻辑，仅按需调小 TTL。
//
// 匿名结果一次性 accessToken（Phase C-2A，CLAUDE.md §18）：
// - 匿名 parse（endUserId 为 null）铸造 192-bit 随机 token，DB 只存 accessTokenHash=SHA-256(token)；
//   明文 token 只在 POST /resume/parse 响应里返回一次。
// - loadAuthorizedResult 对匿名行要求 x-resume-access-token 与 hash 匹配（timingSafeEqual）才放行；
//   无 token / 错 token / 仅会员 token / 迁移前 hash 为 null 的历史匿名行一律 fail-closed → AI_TASK_NOT_FOUND。
// - optimize 行懒生成时继承 parse 行的 endUserId 与 accessTokenHash，不铸新 token。
// ============================================================

const KNOWN_PROVIDERS: readonly AiProviderName[] = [
  'mock', 'openai', 'claude', 'local', 'qwen', 'zhipu', 'llm',
] as const

/**
 * AI 简历结果读取请求方（Phase C-2A）。
 *
 * - 会员请求：endUserId 非空，accessToken 为 null（归属按 endUserId 本人校验）。
 * - 匿名请求：endUserId 为 null，accessToken 为 parse 时铸造的一次性令牌
 *   （走 x-resume-access-token header，DB 只存其 SHA-256 hash）。
 *
 * 二者由 controller 的 resolveAiResultRequester 决定：有效会员 Authorization → 会员；
 * 否则匿名 + header token。service 层据此对每行结果做归属 / 令牌门禁。
 */
export interface AiResultRequester {
  endUserId: string | null
  accessToken: string | null
}

/** SHA-256(token) 的十六进制串（64 hex chars）。DB 只存此 hash，绝不存明文 token。 */
function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 恒定时间比较 token 与已存 hash，避免计时侧信道（对齐 materials 任务机制）。 */
function verifyAccessToken(token: string | null, expectedHash: string): boolean {
  if (!token) return false
  const actual = Buffer.from(hashAccessToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  if (actual.length !== expected.length || actual.length === 0) return false
  return timingSafeEqual(actual, expected)
}

@Injectable()
export class AiService {
  private readonly provider: AiProvider

  constructor(
    private readonly mockProvider: MockAiProvider,
    private readonly openAiProvider: OpenAiProvider,
    private readonly claudeProvider: ClaudeProvider,
    private readonly localProvider: LocalAiProvider,
    private readonly qwenProvider: QwenProvider,
    private readonly zhipuProvider: ZhipuProvider,
    private readonly llmResumeProvider: LlmResumeProvider,
    private readonly logService: AiLogService,
    private readonly llmConfig: LlmConfigService,
    private readonly llmChat: LlmChatService,
    private readonly resumeExtraction: ResumeExtractionService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    const rawName = process.env['AI_PROVIDER'] ?? 'mock'
    if (!(KNOWN_PROVIDERS as readonly string[]).includes(rawName)) {
      throw new InternalServerErrorException({
        error: {
          code: 'AI_PROVIDER_INVALID',
          message: `Unknown AI_PROVIDER "${rawName}". Must be one of: ${KNOWN_PROVIDERS.join(', ')}`,
        },
      })
    }
    const name = rawName as AiProviderName
    const providerMap: Record<AiProviderName, AiProvider> = {
      mock:   this.mockProvider,
      openai: this.openAiProvider,
      claude: this.claudeProvider,
      local:  this.localProvider,
      qwen:   this.qwenProvider,
      zhipu:  this.zhipuProvider,
      llm:    this.llmResumeProvider,
    }
    this.provider = providerMap[name]
  }

  /**
   * 持久化 AI 结果（parse / optimize）。taskId+kind upsert，失败只记日志不阻塞业务。
   *
   * accessTokenHash（Phase C-2A）：仅匿名 parse 铸造的令牌 hash，或 optimize 继承自 parse 行的 hash。
   * 显式传 string → 写入；传 null → 写 null（会员行）；传 undefined → update 时保持原值不动。
   * 注意：payload 里绝不含明文 token（response 才返回明文一次），DB 只存 hash。
   */
  private async persistResult(
    taskId: string,
    kind: 'parse' | 'optimize',
    status: string,
    payload: ParseResumeOutput | OptimizeResumeOutput,
    endUserId?: string | null,
    accessTokenHash?: string | null,
  ): Promise<void> {
    // 明文 token 只在 response 返回；落库前从 payload 防御性摘掉 accessToken，
    // 确保即便未来调整调用顺序，payloadJson 也绝不含明文 token。
    const persistablePayload: Record<string, unknown> = { ...payload }
    delete persistablePayload['accessToken']
    const payloadJson = JSON.stringify(persistablePayload)
    const provider = this.provider.name
    // 每次写入(含 update)都刷新留存窗口,避免活跃任务被提前清理。
    const expiresAt = new Date(Date.now() + AI_RESUME_RESULT_TTL_HOURS * 60 * 60 * 1000)
    try {
      await this.prisma.aiResumeResult.upsert({
        where: { taskId_kind: { taskId, kind } },
        create: {
          taskId, kind, status, payloadJson, provider, expiresAt,
          endUserId: endUserId ?? null,
          accessTokenHash: accessTokenHash ?? null,
        },
        update: {
          status,
          payloadJson,
          provider,
          expiresAt,
          ...(endUserId !== undefined ? { endUserId } : {}),
          ...(accessTokenHash !== undefined ? { accessTokenHash } : {}),
        },
      })
    } catch {
      // 持久化失败不应让用户的解析/优化动作失败（结果仍在本次响应里返回）
    }
  }

  async submitResumeParse(input: ParseResumeInput, endUserId?: string | null): Promise<ParseResumeOutput> {
    const t0 = Date.now()
    try {
      // 真实诊断路径（llm provider）：先服务端提取简历文本。提取失败 → 直接返回明确原因，
      // 不调 LLM、不落假报告。mock / stub provider 保持原行为（自包含演示，不提取）。
      let result: ParseResumeOutput
      let extractionErrorCode: string | undefined
      if (this.provider.name === 'llm') {
        const extraction = await this.resumeExtraction.extractResumeText({
          fileId: input.fileId,
          endUserId: endUserId ?? null,
        })
        if (!extraction.ok) {
          extractionErrorCode = extraction.errorCode
          result = {
            taskId: `extract-fail-${randomBytes(8).toString('hex')}`,
            status: 'failed',
            failReason: extraction.errorMessage ?? '简历文件无法提取文本，请重新上传',
          }
        } else {
          result = await this.provider.parseResume({
            ...input,
            extractedText: extraction.text,
            extractedPageCount: extraction.pageCount,
          })
        }
      } else {
        result = await this.provider.parseResume(input)
      }

      const resultWithProvider: ParseResumeOutput = { ...result, providerName: this.provider.name }
      // Phase C-2A：匿名 parse（无会员归属）铸造一次性访问令牌。
      // DB 只存 SHA-256 hash；明文 token 只随本次响应返回一次。会员 parse 不铸 token。
      const isAnonymous = !endUserId
      const accessToken = isAnonymous ? randomBytes(24).toString('hex') : undefined
      const accessTokenHash = accessToken ? hashAccessToken(accessToken) : null
      await this.persistResult(resultWithProvider.taskId, 'parse', resultWithProvider.status, resultWithProvider, endUserId ?? null, accessTokenHash)
      this.logService.record({
        taskId:    resultWithProvider.taskId,
        provider:  this.provider.name,
        operation: 'parseResume',
        latencyMs: Date.now() - t0,
        status:    resultWithProvider.status === 'failed' ? 'failed' : 'success',
        ...(extractionErrorCode ? { errorCode: extractionErrorCode } : {}),
      })
      return accessToken ? { ...resultWithProvider, accessToken } : resultWithProvider
    } catch (err) {
      this.logService.record({
        taskId:    `err-${Date.now()}`,
        provider:  this.provider.name,
        operation: 'parseResume',
        latencyMs: Date.now() - t0,
        status:    'failed',
        errorCode: err instanceof Error ? err.constructor.name : 'UNKNOWN',
      })
      throw err
    }
  }

  /**
   * 读取已落库的结果，按 kind 反序列化为对应的 Output 形状。
   *
   * 归属 / 令牌门禁（Phase C-1 + C-2A，CLAUDE.md §11/§18）。命中任一拒绝条件都返回 null
   * → 上层统一抛 AI_TASK_NOT_FOUND，既阻断越权，也不泄露结果是否存在：
   * - 留存治理：已过期 / 无 expiresAt（迁移前历史行）一律视为不存在。
   * - 会员行（endUserId 非空）：只能本人（requester.endUserId 一致）读取；
   *   其他会员、匿名请求一律拒绝。
   * - 新匿名行（endUserId 为 null 且 accessTokenHash 非空）：须带正确 accessToken
   *   （x-resume-access-token）才放行；无 token / 错 token / 仅会员 token 一律拒绝。
   * - 历史匿名行（endUserId 为 null 且 accessTokenHash 为 null，C-2A 迁移前写入）：
   *   fail-closed，任何请求都拒绝。
   */
  private async loadAuthorizedResult<T>(
    taskId: string,
    kind: 'parse' | 'optimize',
    requester: AiResultRequester,
  ): Promise<T | null> {
    const row = await this.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId, kind } },
    })
    if (!row) return null
    // 留存治理:已过期 或 无 expiresAt（迁移前写入的历史行）一律视为不存在。
    if (!row.expiresAt || row.expiresAt.getTime() < Date.now()) return null
    if (!this.isAuthorized(row, requester)) return null
    try {
      return JSON.parse(row.payloadJson) as T
    } catch {
      return null
    }
  }

  /** 单行结果的归属 / 令牌门禁判定（见 loadAuthorizedResult 文档）。 */
  private isAuthorized(
    row: { endUserId: string | null; accessTokenHash: string | null },
    requester: AiResultRequester,
  ): boolean {
    if (row.endUserId) {
      // 会员行:只放行本人会员;匿名请求(endUserId null)与其他会员都拒绝。
      return requester.endUserId !== null && requester.endUserId === row.endUserId
    }
    // 匿名行:历史 null-hash 行 fail-closed;否则须 token 匹配。
    if (!row.accessTokenHash) return false
    return verifyAccessToken(requester.accessToken, row.accessTokenHash)
  }

  async getResumeRecord(
    taskId: string,
    requester: AiResultRequester = { endUserId: null, accessToken: null },
  ): Promise<ParseResumeOutput> {
    const stored = await this.loadAuthorizedResult<ParseResumeOutput>(taskId, 'parse', requester)
    if (stored) return stored
    throw new NotFoundException({
      error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在，请重新提交简历' },
    })
  }

  async getResumeOptimize(
    taskId: string,
    requester: AiResultRequester = { endUserId: null, accessToken: null },
  ): Promise<OptimizeResumeOutput> {
    const cached = await this.loadAuthorizedResult<OptimizeResumeOutput>(taskId, 'optimize', requester)
    if (cached) return cached

    // optimize 懒生成前必须先通过 parse 行门禁（会员本人 / 匿名持正确 token），
    // 否则越权请求无法触达 provider，也拿不到 optimize 结果。
    const parseResult = await this.loadAuthorizedResult<ParseResumeOutput>(taskId, 'parse', requester)
    if (!parseResult) {
      throw new NotFoundException({
        error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在，请先提交简历解析' },
      })
    }
    if (!parseResult.report) {
      // Parse failed earlier — cannot optimize
      return { taskId, status: 'failed', failReason: '简历解析未成功，无法生成优化建议' }
    }

    const t0 = Date.now()
    try {
      const result = await this.provider.optimizeResume(taskId, parseResult.report)
      // optimize 行继承 parse 行的 endUserId 与 accessTokenHash（不铸新 token）。
      const parseOwner = await this.prisma.aiResumeResult.findUnique({
        where: { taskId_kind: { taskId, kind: 'parse' } },
        select: { endUserId: true, accessTokenHash: true },
      })
      await this.persistResult(
        taskId, 'optimize', result.status, result,
        parseOwner?.endUserId ?? null,
        parseOwner?.accessTokenHash ?? null,
      )
      this.logService.record({
        taskId,
        provider:  this.provider.name,
        operation: 'optimizeResume',
        latencyMs: Date.now() - t0,
        status:    result.status === 'failed' ? 'failed' : 'success',
      })
      return result
    } catch (err) {
      this.logService.record({
        taskId,
        provider:  this.provider.name,
        operation: 'optimizeResume',
        latencyMs: Date.now() - t0,
        status:    'failed',
        errorCode: err instanceof Error ? err.constructor.name : 'UNKNOWN',
      })
      throw err
    }
  }

  getProviderName(): string {
    return this.provider.name
  }

  /**
   * 清理已过期的简历派生结果（CLAUDE.md §11）。
   * 硬删 expiresAt < now 或 expiresAt 为空(迁移前历史行)的行，并写 system 审计
   * （只放数量 / 按 kind 摘要，不含 taskId / payload）。
   * 由 AiResultCleanupTask 每小时触发；亦可手动调用。
   */
  async cleanupExpiredResults(triggeredBy: 'manual' | 'cron'): Promise<{ deletedCount: number }> {
    const now = new Date()
    // 清理对象:已过期行 + 无 expiresAt 的迁移前历史行（后者按过期处理，不长期留存简历派生数据）。
    // 统计与删除使用同一过期谓词:groupBy 取 byKind 快照在前,deleteMany 直接按谓词原子删除——
    // 避免"先 findMany 取 id、再 deleteMany(id in ...)"的 TOCTOU 窗口与 SQLite IN 列表上限。
    const expiredWhere = { OR: [{ expiresAt: null }, { expiresAt: { lt: now } }] }

    const grouped = await this.prisma.aiResumeResult.groupBy({
      by: ['kind'],
      where: expiredWhere,
      _count: { _all: true },
    })
    if (grouped.length === 0) return { deletedCount: 0 }

    const byKind: Record<string, number> = {}
    for (const g of grouped) byKind[g.kind] = g._count._all

    const { count: deletedCount } = await this.prisma.aiResumeResult.deleteMany({
      where: expiredWhere,
    })
    if (deletedCount === 0) return { deletedCount: 0 }

    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'ai_resume_result.cleanup_expired',
      targetType: 'ai_resume_result',
      targetId: null,
      payload: { triggeredBy, deletedCount, byKind },
    })

    return { deletedCount }
  }

  async chatWithAssistant(input: ChatInput): Promise<ChatOutput> {
    const t0 = Date.now()
    const sessionId = input.sessionId ?? `session-${Date.now()}`
    // 配置就绪时走真实大模型（DeepSeek/通义/MiniMax），否则降级到默认 provider
    const useLlm = this.llmConfig.isReady('assistant_chat')
    const providerLabel = useLlm ? `llm:${this.llmConfig.getConfig('assistant_chat').vendor}` : this.provider.name
    try {
      const result = useLlm
        ? await this.llmChat.chat({ ...input, sessionId })
        : await this.provider.chatAssistant({ ...input, sessionId })
      this.logService.record({
        taskId:    sessionId,
        provider:  providerLabel,
        operation: 'chatAssistant',
        latencyMs: Date.now() - t0,
        status:    'success',
      })
      return result
    } catch (err) {
      this.logService.record({
        taskId:    sessionId,
        provider:  providerLabel,
        operation: 'chatAssistant',
        latencyMs: Date.now() - t0,
        status:    'failed',
        errorCode: err instanceof Error ? err.constructor.name : 'UNKNOWN',
      })
      throw err
    }
  }
}
