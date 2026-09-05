import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { AiLogService, AiUsageAccumulator, aiErrorCodeOf } from '../ai/ai-log.service'
import { LlmAdvisorService } from './llm-advisor.service'
import { AdvisorArtifactService } from './advisor-artifact.service'
import { AdvisorQaMemory } from './advisor-qa-memory'
import {
  ADVISOR_DISCLAIMER,
  COMPARE_LIMITS,
  SKILL_SPECS,
  SLOT_DRAFT_BLANK_POLICY,
  deriveStatus,
  isEvidenceLevel,
  missingRequiredSlots,
  nextSlotKey,
  parseSlots,
  slotSpecOf,
  slotViews,
  type AdvisorSkill,
  type EvidenceLevel,
  type StoredSlots,
} from './advisor-skills'
import type { AdvisorArtifactPayload } from './advisor-artifact.types'

export const MAX_ADVISOR_PINS = 40

// ============================================================
// S3-3 · P26 顾问作业面会话服务。
//
// 四件事（矩阵 §S3-3 任务定义）：
//   1. skill / session 模型   —— 三种作业型 + 会话状态机
//   2. 输入槽                 —— 用户分次补充，服务端保存已填与待填
//   3. 继续回答               —— 在已有会话上追加，不是每次从零
//   4. 真实产物               —— 落 AdvisorArtifact（见 advisor-artifact.service.ts）
//
// 归属门禁：会员凭 Bearer（endUserId），匿名凭创建时铸的 accessToken（DB 只存 SHA-256）。
// 与 MockInterviewSession / AiResumeResult 同口径；拒绝一律 NOT_FOUND，不泄露会话是否存在。
//
// ⚠️ 对话不落库：QA 多轮上下文只在本进程内存里按 TTL 保留（见 QaMemory）。
// 这是设计页对用户的明文承诺，不要为了排查方便改成落表。
// ============================================================

const SESSION_TTL_HOURS = (() => {
  const raw = Number(process.env['ADVISOR_SESSION_TTL_HOURS'])
  return Number.isFinite(raw) && raw > 0 ? raw : 24
})()

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function tokenMatches(token: string | null, expectedHash: string | null): boolean {
  if (!token || !expectedHash) return false
  const actual = Buffer.from(hashToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export interface AdvisorRequester {
  endUserId: string | null
  accessToken: string | null
}

@Injectable()
export class AdvisorService {
  /** 进程内存，不落库。重启即失 —— 这是刻意的，不是缺陷，理由见 advisor-qa-memory.ts。 */
  private readonly qaMemory = new AdvisorQaMemory()

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmAdvisorService,
    private readonly artifacts: AdvisorArtifactService,
    private readonly audit: AuditService,
    private readonly aiLog: AiLogService,
  ) {}

  /**
   * 可用性探针。
   *
   * 前端据此走 result-unavailable 诚实态：顾问不可用时这一页不给新结论，
   * 但已有会话、已填槽、已钉条目、已生成产物仍然可读可打印 —— 所以这个端点
   * **不影响**其它端点的可用性，更不该被用来把整站门控掉。
   */
  availability() {
    const available = this.llm.isAvailable()
    return {
      available,
      providerLabel: available ? this.llm.providerLabel() : null,
      reason: available ? null : 'AI 顾问暂不可用：管理员尚未配置或已停用该功能位',
      // 说清「不可用时还剩什么」，前端不必自己猜
      degradedCapabilities: available
        ? []
        : ['查看已有会话与已填内容', '查看与打印已钉住的条目', '查看与打印已生成的产物'],
      disclaimer: ADVISOR_DISCLAIMER,
    }
  }

  // ── 1. 建会话（含判型）────────────────────────────────────

  async createSession(topic: string, requester: AdvisorRequester) {
    const usage = new AiUsageAccumulator()
    const startedAt = Date.now()
    // classify 内部对模型故障已做兜底（退关键词判型），所以这里不会因 AI 挂掉而建不了会话
    const classification = await this.llm.classify(topic, { onLlmCall: usage.add })
    this.recordAiLog(usage, startedAt, 'success', requester.endUserId)

    const isAnonymous = !requester.endUserId
    const accessToken = isAnonymous ? randomBytes(24).toString('hex') : undefined
    const trimmedTopic = topic.trim().slice(0, 600)
    // 用户的开场诉求**就是**问答型的那一槽 —— 不预填的话，问答型会话会卡在
    // 「必填项没答完」而永远出不了活（问答走 /ask，本来就不会再填一次 question 槽）。
    // 槽位按全局 slotKey 存，所以这里无条件预填：后来改判成问答型时同样能直接开工。
    const seededSlots: StoredSlots = {
      question: { value: trimmedTopic.slice(0, slotSpecOf('question')!.maxChars), filledAt: new Date().toISOString() },
    }
    const row = await this.prisma.advisorSession.create({
      data: {
        endUserId: requester.endUserId,
        accessTokenHash: accessToken ? hashToken(accessToken) : null,
        skill: classification.skill,
        status: deriveStatus(classification.skill, seededSlots, false),
        topic: trimmedTopic,
        skillReason: classification.reason,
        skillSource: classification.source,
        slotsJson: JSON.stringify(seededSlots),
        expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000),
      },
    })
    await this.audit.write({
      actorId: null,
      actorRole: requester.endUserId ? 'enduser' : 'kiosk',
      action: 'advisor.session_create',
      targetType: 'advisor_session',
      targetId: row.id,
      // 仅元数据：不含用户诉求正文
      payload: { skill: classification.skill, skillSource: classification.source },
      ipAddress: null, userAgent: null, requestId: null,
    })
    const view = await this.viewOf(row)
    return { ...view, ...(accessToken ? { accessToken } : {}) }
  }

  // ── 2. 读会话（刷新恢复 / 继续作业的入口）──────────────────

  async getSession(sessionId: string, requester: AdvisorRequester) {
    return this.viewOf(await this.loadOwned(sessionId, requester))
  }

  // ── 3. 改型（判错了一键换，已填不丢）──────────────────────

  async switchSkill(sessionId: string, skill: AdvisorSkill, requester: AdvisorRequester) {
    const row = await this.loadOwned(sessionId, requester)
    if (row.skill === skill) return this.viewOf(row)
    const slots = parseSlots(row.slotsJson)
    // slotsJson 原样不动 —— 这就是「换的时候已填的内容不丢」的实现：
    // 槽位按全局 slotKey 存，换型只是换了读哪几个槽的视图。
    const updated = await this.prisma.advisorSession.update({
      where: { id: row.id },
      data: {
        skill,
        skillSource: 'user_override',
        skillReason: `你把作业型改成了「${SKILL_SPECS[skill].label}」——已填的内容都还在。`,
        status: deriveStatus(skill, slots, await this.hasArtifact(row.id, skill)),
      },
    })
    return this.viewOf(updated)
  }

  // ── 4. 填槽（分次补充）────────────────────────────────────

  async fillSlot(sessionId: string, slotKey: string, value: string, requester: AdvisorRequester) {
    const row = await this.loadOwned(sessionId, requester)
    const spec = slotSpecOf(slotKey)
    if (!spec) {
      throw new BadRequestException({
        error: { code: 'ADVISOR_SLOT_UNKNOWN', message: '未知的输入项' },
      })
    }
    const skill = this.skillOf(row)
    if (!SKILL_SPECS[skill].slotKeys.includes(slotKey)) {
      // 允许存在，但不允许在当前型下乱填：否则 UI 与服务端对不上，用户会以为填了却没用上
      throw new BadRequestException({
        error: { code: 'ADVISOR_SLOT_NOT_IN_SKILL', message: `当前作业型不需要这一项，请先切换作业型` },
      })
    }
    const trimmed = value.trim()
    if (!trimmed) {
      throw new BadRequestException({ error: { code: 'ADVISOR_SLOT_EMPTY', message: '内容不能为空' } })
    }
    const slots = parseSlots(row.slotsJson)
    slots[slotKey] = { value: trimmed.slice(0, spec.maxChars), filledAt: new Date().toISOString() }
    const updated = await this.prisma.advisorSession.update({
      where: { id: row.id },
      data: {
        slotsJson: JSON.stringify(slots),
        status: deriveStatus(skill, slots, await this.hasArtifact(row.id, skill)),
      },
    })
    return this.viewOf(updated)
  }

  // ── 5. 出活（三种型各自的产物）────────────────────────────

  async run(sessionId: string, requester: AdvisorRequester) {
    const row = await this.loadOwned(sessionId, requester)
    const skill = this.skillOf(row)
    const slots = parseSlots(row.slotsJson)
    const missing = missingRequiredSlots(skill, slots)
    if (missing.length > 0) {
      // 如实回报缺哪几项，不给半成品也不编内容顶上
      throw new BadRequestException({
        error: {
          code: 'ADVISOR_SLOTS_INCOMPLETE',
          message: '还有必填项没答完',
          details: { missingSlotKeys: missing, nextSlotKey: nextSlotKey(skill, slots) },
        },
      })
    }

    const usage = new AiUsageAccumulator()
    const startedAt = Date.now()
    let payload: AdvisorArtifactPayload
    try {
      payload = await this.buildPayload(row.id, skill, slots, usage)
    } catch (error) {
      this.recordAiLog(usage, startedAt, 'failed', row.endUserId, aiErrorCodeOf(error, 'ADVISOR_RUN_FAILED'))
      throw error
    }
    this.recordAiLog(usage, startedAt, 'success', row.endUserId)

    const providerLabel = skill === 'qa' ? 'server:pins' : this.llm.providerLabel()
    const saved = await this.artifacts.save(row.id, payload, providerLabel)
    await this.prisma.advisorSession.update({ where: { id: row.id }, data: { status: 'completed' } })
    await this.audit.write({
      actorId: null,
      actorRole: row.endUserId ? 'enduser' : 'kiosk',
      action: 'advisor.run',
      targetType: 'advisor_session',
      targetId: row.id,
      payload: { skill, artifactKind: payload.kind, artifactId: saved.artifactId },
      ipAddress: null, userAgent: null, requestId: null,
    })
    return this.getSession(sessionId, requester)
  }

  private async buildPayload(
    sessionId: string,
    skill: AdvisorSkill,
    slots: StoredSlots,
    usage: AiUsageAccumulator,
  ): Promise<AdvisorArtifactPayload> {
    if (skill === 'qa') {
      // 问答型的产物就是用户主动钉住的条目单 —— **不调模型**：
      // 对话不保存，钉住的内容早已由用户确认过，再让模型复述一遍等于重新编一次。
      const pins = await this.prisma.advisorPin.findMany({
        where: { sessionId },
        orderBy: { idx: 'asc' },
      })
      if (pins.length === 0) {
        throw new BadRequestException({
          error: { code: 'ADVISOR_NO_PINS', message: '还没有钉住任何条目，先把有用的钉住再生成' },
        })
      }
      return {
        kind: 'qa_pins',
        pins: pins.map((pin) => ({
          content: pin.content,
          evidenceLevel: pin.evidenceLevel as EvidenceLevel,
          sourceNote: pin.sourceNote,
        })),
      }
    }
    if (skill === 'slot_fill') {
      const spec = SKILL_SPECS.slot_fill
      const result = await this.llm.draft(slots, spec.slotKeys, { onLlmCall: usage.add })
      return {
        kind: 'slot_draft',
        draft: result.draft,
        blanks: result.blanks,
        summary: result.summary,
        basedOn: spec.slotKeys
          .filter((key) => slots[key])
          .map((key) => ({ slotKey: key, prompt: slotSpecOf(key)!.prompt, value: slots[key]!.value })),
      }
    }
    const result = await this.llm.compare(
      slots['my_material']!.value,
      slots['target_requirements']!.value,
      { onLlmCall: usage.add },
    )
    return { kind: 'compare_report', items: result.items, extras: result.extras, summary: result.summary }
  }

  // ── 6. 继续回答（问答型，多轮）────────────────────────────

  /**
   * QA 追问。上下文取自进程内存，不落库。
   *
   * 「继续回答」在本型的含义就是：同一个 sessionId 的第 2、3 轮能接住前文
   *（设计页的「那超过半年呢」），而不是每次都当成一个新问题。
   */
  async ask(sessionId: string, question: string, requester: AdvisorRequester) {
    const row = await this.loadOwned(sessionId, requester)
    if (this.skillOf(row) !== 'qa') {
      throw new BadRequestException({
        error: { code: 'ADVISOR_ASK_WRONG_SKILL', message: '当前作业型不是问答型，请先切换作业型' },
      })
    }
    const memory = this.qaMemory.read(sessionId)
    const usage = new AiUsageAccumulator()
    const startedAt = Date.now()
    let answer
    try {
      answer = await this.llm.answer(question, memory, { onLlmCall: usage.add })
    } catch (error) {
      this.recordAiLog(usage, startedAt, 'failed', row.endUserId, aiErrorCodeOf(error, 'ADVISOR_ANSWER_FAILED'))
      throw error
    }
    this.recordAiLog(usage, startedAt, 'success', row.endUserId)
    this.qaMemory.append(sessionId, question.trim().slice(0, 600), answer.answer)
    return {
      sessionId,
      ...answer,
      /** 前端据此决定「钉住这条」按钮是否可用；钉住才是唯一会留下的动作 */
      canPin: true,
      /** 如实告知：这一轮问答本身不会被保存 */
      persistence: 'not_saved' as const,
      providerLabel: this.llm.providerLabel(),
    }
  }

  // ── 7. 钉住 / 取消钉住 ────────────────────────────────────

  async pin(
    sessionId: string,
    input: { content: string; evidenceLevel: string; sourceNote?: string },
    requester: AdvisorRequester,
  ) {
    const row = await this.loadOwned(sessionId, requester)
    if (!isEvidenceLevel(input.evidenceLevel)) {
      throw new BadRequestException({
        error: { code: 'ADVISOR_EVIDENCE_INVALID', message: '证据分级取值非法（只允许 E1 / E2 / E3）' },
      })
    }
    const pinCount = await this.prisma.advisorPin.count({ where: { sessionId: row.id } })
    if (pinCount >= MAX_ADVISOR_PINS) {
      throw new BadRequestException({
        error: { code: 'ADVISOR_PIN_LIMIT', message: `最多钉住 ${MAX_ADVISOR_PINS} 条，请先取消部分条目` },
      })
    }
    const last = await this.prisma.advisorPin.findFirst({
      where: { sessionId: row.id },
      orderBy: { idx: 'desc' },
      select: { idx: true },
    })
    const created = await this.prisma.advisorPin.create({
      data: {
        sessionId: row.id,
        idx: (last?.idx ?? 0) + 1,
        content: input.content.trim().slice(0, 1200),
        evidenceLevel: input.evidenceLevel,
        sourceNote: input.sourceNote?.trim().slice(0, 200) || null,
      },
    })
    return { pinId: created.id, idx: created.idx }
  }

  async unpin(sessionId: string, pinId: string, requester: AdvisorRequester) {
    const row = await this.loadOwned(sessionId, requester)
    const deleted = await this.prisma.advisorPin.deleteMany({ where: { id: pinId, sessionId: row.id } })
    if (deleted.count === 0) {
      throw new NotFoundException({ error: { code: 'ADVISOR_PIN_NOT_FOUND', message: '条目不存在' } })
    }
    return { ok: true }
  }

  // ── 8. 打印产物（不调模型）────────────────────────────────

  async printArtifact(sessionId: string, artifactId: string, requester: AdvisorRequester) {
    const row = await this.loadOwned(sessionId, requester)
    return this.artifacts.print(artifactId, row.id, { endUserId: row.endUserId })
  }

  // ── 内部 ──────────────────────────────────────────────────

  /**
   * A-6 口径：落 AiServiceLog（仅元数据）。
   *
   * ⚠️ operation 复用 'chatAssistant'：顾问作业面与 P25 助手同源（同一个模型能力位家族）。
   * 本可以新建 'advisorWork'，但 ai-log.service.ts 顶部注明新增取值必须**三处同步**，
   * 其中一处在 apps/admin（本批次边界外，不得改）。只改后端会让 Admin 侧缺标签，
   * 属于「改一半」——所以留给拥有 apps/admin 的批次一并做，见 PR 未验证项。
   * AiServiceLog 是观测数据不是账单，此处复用不影响任何对账口径。
   */
  private recordAiLog(
    usage: AiUsageAccumulator,
    startedAt: number,
    status: 'success' | 'failed',
    endUserId: string | null,
    errorCode?: string,
  ): void {
    if (usage.callCount === 0) return
    this.aiLog.record({
      taskId: null,
      operation: 'chatAssistant',
      provider: usage.provider ?? 'llm',
      status,
      latencyMs: Math.max(0, Date.now() - startedAt),
      tokenUsage: usage.tokenUsage,
      errorCode,
      endUserId,
      terminalId: null,
    })
  }

  private skillOf(row: { skill: string }): AdvisorSkill {
    // 库里的值理论上恒合法（写入前已校验）；万一被外部改脏，退到问答型而不是抛错，
    // 因为问答型不需要任何已填槽，用户至少还能用。
    return row.skill in SKILL_SPECS ? (row.skill as AdvisorSkill) : 'qa'
  }

  private async hasArtifact(sessionId: string, skill: AdvisorSkill): Promise<boolean> {
    const found = await this.prisma.advisorArtifact.findFirst({
      where: { sessionId, kind: SKILL_SPECS[skill].artifactKind, expiresAt: { gt: new Date() } },
      select: { id: true },
    })
    return !!found
  }

  private async viewOf(row: {
    id: string
    endUserId: string | null
    skill: string
    status: string
    topic: string
    skillReason: string | null
    skillSource: string
    slotsJson: string
    createdAt: Date
    updatedAt: Date
    expiresAt: Date
  }) {
    const skill = this.skillOf(row)
    const slots = parseSlots(row.slotsJson)
    const spec = SKILL_SPECS[skill]
    const [pins, artifacts] = await Promise.all([
      this.prisma.advisorPin.findMany({ where: { sessionId: row.id }, orderBy: { idx: 'asc' } }),
      this.artifacts.listForSession(row.id),
    ])
    const missing = missingRequiredSlots(skill, slots)
    return {
      sessionId: row.id,
      skill,
      skillLabel: spec.label,
      skillTagline: spec.tagline,
      skillReason: row.skillReason,
      /** llm / fallback / user_override —— fallback 时前端应说明「这次按关键词判的型」 */
      skillSource: row.skillSource,
      status: deriveStatus(skill, slots, artifacts.length > 0),
      topic: row.topic,
      slots: slotViews(skill, slots),
      missingSlotKeys: missing,
      nextSlotKey: nextSlotKey(skill, slots),
      canRun: missing.length === 0,
      pins: pins.map((pin) => ({
        pinId: pin.id,
        idx: pin.idx,
        content: pin.content,
        evidenceLevel: pin.evidenceLevel,
        sourceNote: pin.sourceNote,
        createdAt: pin.createdAt.toISOString(),
      })),
      artifacts,
      /** 能力边界声明：服务端常量，前端直接渲染，不要自己写一份 */
      compareLimits: COMPARE_LIMITS,
      blankPolicy: SLOT_DRAFT_BLANK_POLICY,
      disclaimer: ADVISOR_DISCLAIMER,
      /** 对话保存口径，如实透出供页面展示 */
      conversationPersistence: 'not_saved' as const,
      aiAvailable: this.llm.isAvailable(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }
  }

  /** 归属门禁：会员行只放行本人；匿名行须正确 accessToken；过期视为不存在。 */
  private async loadOwned(sessionId: string, requester: AdvisorRequester) {
    const row = await this.prisma.advisorSession.findUnique({ where: { id: sessionId } })
    const notFound = () =>
      new NotFoundException({ error: { code: 'ADVISOR_SESSION_NOT_FOUND', message: '会话不存在或已过期，请重新开始' } })
    if (!row || row.expiresAt.getTime() < Date.now()) throw notFound()
    if (row.endUserId) {
      if (requester.endUserId !== row.endUserId) throw notFound()
    } else {
      if (!tokenMatches(requester.accessToken, row.accessTokenHash)) throw notFound()
    }
    return row
  }
}
