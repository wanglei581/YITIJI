import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { LlmConfigService } from '../ai/llm/llm-config.service'
import { normalizeLlmUsage, type AiLlmCallSink, type RawLlmUsage } from '../ai/ai-log.service'
import { maskUserTextForLlmText } from '../common/pii/llm-input-mask'
import {
  ADVISOR_DISCLAIMER,
  classifySkillByKeyword,
  isAdvisorSkill,
  type AdvisorSkill,
  type EvidenceLevel,
  type StoredSlots,
} from './advisor-skills'

// ============================================================
// S3-3 · P26 顾问作业面的模型层。四件事：判型 / 问答 / 成稿 / 比对。
//
// 合规硬约束（设计页 26-advisor-work.html + CLAUDE.md §9 + 矩阵 §S3-3）：
//
// 1.「她不会替你编什么」—— 数字、公司名、时间、离职原因、证书资质一律留空。
//    这条不能只靠 prompt 求模型配合，必须**服务端可验证**：
//    成稿里出现的每一个数字游程都必须能在用户自己填的槽位文本里找到，
//    否则整篇作废重试，连续失败就诚实报错。见 assertNoInventedNumbers。
//
// 2.「AI 只排序/解释，不得自动裁决」—— 比对型只输出 covered / missing / not_a_capability
//    三种事实判定，不给「建议投 / 不建议投」这类裁决；
//   「本机比不了的」三条是服务端常量（COMPARE_LIMITS），不让模型自述边界。
//
// 3. 不得声称做过检索。C0 事实冻结抓到过 5303 原型的机构助手在硬编码答案上说
//   「帮你查了」「逐条查库」。本层没有任何检索能力，所以凡是自称查过库/查过系统的
//    输出一律判为违规重试。见 CLAIMED_LOOKUP。
//
// 4. 送模型前一律过 PII 遮盖（#617 的 common/pii/llm-input-mask，不另写一份）。
//    校验也必须用**送出去的那一份**：否则遮盖过的原文和未遮盖的校验基准对不上，
//    会把合法输出误判成编造（同 llm-job-fit / llm-career-plan 的既有口径）。
//
// 5. 日志只写元数据，不写任何用户正文或模型输出正文。
// ============================================================

/** 与既有 AI 能力同源的禁用词。命中即整体重试，连续命中诚实失败。 */
const BANNED = [
  '保过', '通过率', '录用概率', '录用率', 'Offer 概率', 'Offer概率', '保录用', '保面试',
  '保证拿', '精准命中', '内部题库', '一键投递', '立即投递', '平台投递', '推荐给企业',
  '帮你投递', '替你投递', '代为投递', '收取简历',
] as const

/**
 * 自称做过检索 / 查询的表述。
 *
 * 本层只有：用户自己填的槽位文本 + 模型的语言能力。**没有任何数据库查询、没有联网检索**。
 * 所以任何「我查了 / 帮你查了 / 逐条核对了系统里的 X」都是编的，必须拦。
 * 这是 C0 事实冻结里 5303 原型踩过的坑，不重蹈。
 */
const CLAIMED_LOOKUP =
  /(帮你|已经?|我)?(查了|查询了|检索了|查过|检索过|核查了|查阅了)|逐条查(库|询)|查(了|询)(数据库|系统|后台|平台)|根据(数据库|系统|后台)(里|中)的(记录|数据)|已为你(查询|检索|核实)/

/** 承诺型薪资数字（同 career-plan 口径）。 */
const SALARY_PROMISE = /(月薪|年薪|薪资|工资)[^。；;]{0,12}(可达|能到|达到|不低于|保底)[^。；;]{0,8}\d/

const MAX_ATTEMPTS = 2

function findViolation(text: string): string | null {
  for (const term of BANNED) {
    if (text.includes(term)) return term
  }
  const pct = text.match(/\d{1,3}\s*%/)
  if (pct) return `percent:${pct[0]}`
  if (SALARY_PROMISE.test(text)) return 'salary_promise'
  if (CLAIMED_LOOKUP.test(text)) return 'claimed_lookup'
  return null
}

/** 归一化后做子串比对（同 career-plan 的 evidence 校验口径）。 */
function normalizeForMatch(text: string): string {
  // 全角空格用 U+3000 转义：直接写字面量会触发 eslint no-irregular-whitespace
  return text.replace(/[\s\u3000,，.。;；:：、·\-—()（）'"「」『』]/gu, '')
}

/**
 * 数字游程：连续的阿拉伯数字（含中间的 . 与 %）。
 * 中文数字（"六年"）不纳入 —— 它们无法与槽位做可靠的字面比对，
 * 强行拦会把合法改写（"6 年"→"六年"）判成编造，属于假阳性。
 * 本函数只拦**阿拉伯数字**，这已经覆盖了设计页点名的「数字」风险面（12%→3%、2015.09 这类）。
 */
function digitRuns(text: string): string[] {
  return text.match(/\d+(?:[.．]\d+)*/gu) ?? []
}

export interface AdvisorLlmContext {
  /** A-6 成本可见性：每次真实 LLM 调用回调一次元数据（不含正文）。 */
  onLlmCall?: AiLlmCallSink
}

// ── 各型输出契约 ─────────────────────────────────────────────

export interface AdvisorClassification {
  skill: AdvisorSkill
  reason: string
  /** llm = 模型判的；fallback = 模型不可用，按关键词判的 */
  source: 'llm' | 'fallback'
}

export interface AdvisorAnswer {
  answer: string
  evidenceLevel: EvidenceLevel
  /** 出处说明：这条结论凭什么。打印时随条目带上。 */
  sourceNote: string
  disclaimer: string
}

export interface AdvisorDraft {
  /** 成稿正文。留白处用 ____ 占位，服务端不替用户填。 */
  draft: string
  /** 明确留空的项（供页面提示用户自己补） */
  blanks: string[]
  summary: string
}

export interface CompareItem {
  requirement: string
  /** covered = 你写到了；missing = 没写到；not_a_capability = 不是能力项 */
  verdict: 'covered' | 'missing' | 'not_a_capability'
  /** covered 时是材料原文摘录（服务端校验必须真实出现）；其余为说明文字 */
  evidence: string
}

export interface AdvisorCompare {
  items: CompareItem[]
  /** 材料里有、但岗位正文没提的 */
  extras: Array<{ point: string; note: string }>
  summary: string
}

@Injectable()
export class LlmAdvisorService {
  private readonly logger = new Logger(LlmAdvisorService.name)

  constructor(private readonly config: LlmConfigService) {}

  /** 模型是否可用。前端据此走 result-unavailable 诚实态，而不是让整页瘫痪。 */
  isAvailable(): boolean {
    return this.config.isReady('advisor_work') && this.config.getConfig('advisor_work').enabled
  }

  /** 当前生效的 provider 标签（风险 R1 同源口径：前端据此区分真实模型与非模型产物）。 */
  providerLabel(): string {
    const cfg = this.config.getConfig('advisor_work')
    return `llm:${cfg.vendor}:${cfg.model}`
  }

  // ── 1. 判型 ────────────────────────────────────────────────

  /**
   * 按用户诉求判作业型。
   *
   * 模型不可用或输出不合法时**不抛错**，退到关键词兜底并如实标 source='fallback'——
   * 判型失败不该挡住用户开工（AI 是加速器不是前置条件）。
   */
  async classify(topic: string, ctx: AdvisorLlmContext = {}): Promise<AdvisorClassification> {
    if (!this.isAvailable()) return { ...classifySkillByKeyword(topic), source: 'fallback' }
    const sys =
      '你在判断求职者的诉求属于哪种作业型，只做分类，不回答问题本身。' +
      '\nqa：拿不准的判断题（「要不要」「该不该」），没有现成的两样东西可比。' +
      '\nslot_fill：东西还不存在，要先把信息问出来再写（「我不会写」「帮我写」）。' +
      '\ncompare：有明确的两样东西要放一起逐条看（「我够不够格」「符不符合要求」）。' +
      '\n只输出 JSON：{"skill":"qa|slot_fill|compare","reason":"一句话说明为什么按这个型办（用第二人称对用户说）"}'
    try {
      const masked = maskUserTextForLlmText(topic.slice(0, 600), 'advisor_classify')
      const raw = await this.callLlm(sys, `【用户诉求】${masked}`, ctx.onLlmCall)
      const parsed = this.parseJson<{ skill?: unknown; reason?: unknown }>(raw)
      const skill = parsed?.skill
      const reason = typeof parsed?.reason === 'string' ? parsed.reason.trim().slice(0, 200) : ''
      if (isAdvisorSkill(skill) && reason && !findViolation(reason)) {
        return { skill, reason, source: 'llm' }
      }
      this.logger.warn('advisor.classify invalid_output → keyword fallback')
    } catch {
      // 判型是整条链路最靠前的一步，模型挂在这里不该让用户开不了工
      this.logger.warn('advisor.classify llm_failed → keyword fallback')
    }
    return { ...classifySkillByKeyword(topic), source: 'fallback' }
  }

  // ── 2. 问答型 ──────────────────────────────────────────────

  /**
   * 回答一轮。history 是**进程内存里的**上下文，不落库（设计页：对话不保存）。
   */
  async answer(
    question: string,
    history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
    ctx: AdvisorLlmContext = {},
  ): Promise<AdvisorAnswer> {
    const sys =
      '你是求职者本人的顾问，回答他拿不准的求职判断题。' +
      '\n硬性要求：' +
      '\n1. 你没有任何检索能力：不得声称查过数据库、系统、后台或平台，不得说「帮你查了」「逐条查库」。' +
      '\n2. 不承诺录用、Offer、通过率、薪资数字；不输出任何百分比。' +
      '\n3. 不替用户做投递或预约决定，不代收简历；岗位申请只能引导用户去来源平台。' +
      '\n4. 没有依据时必须明说「本机没有你所在行业的具体数据，这条算参考」，不要编出处。' +
      '\n5. sourceNote 要如实写清这条结论凭什么：是通行做法，还是基于用户自己说过的话。' +
      '\n只输出 JSON（不要 markdown 代码块）：' +
      '{"answer":"回答正文（200 字以内，口语化，可分点）",' +
      '"evidenceLevel":"E1|E2|E3",' +
      '"sourceNote":"这条的出处与可信度说明（60 字以内）"}' +
      '\nevidenceLevel 口径：E1=依据用户自己说过的话或他的材料；E2=依据本机读到的来源事实；E3=你的判断与建议。' +
      '\n本层没有来源事实输入，所以一般只应输出 E1 或 E3，不要谎报 E2。'

    const masked = maskUserTextForLlmText(question.slice(0, 600), 'advisor_qa')
    const parts: string[] = []
    if (history.length > 0) {
      const transcript = history
        .slice(-6)
        .map((turn) => `${turn.role === 'user' ? '用户' : '你'}：${turn.content}`)
        .join('\n')
      // 历史里的用户发言在入内存前已遮盖过一次，这里不重复遮盖模型自己的输出
      parts.push(`【本轮之前的对话（不保存，仅本次会话内存）】\n${transcript.slice(0, 2000)}`)
    }
    parts.push(`【用户这一问】${masked}`)

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const raw = await this.callLlm(sys, parts.join('\n\n'), ctx.onLlmCall)
      const parsed = this.parseJson<{ answer?: unknown; evidenceLevel?: unknown; sourceNote?: unknown }>(raw)
      const answer = typeof parsed?.answer === 'string' ? parsed.answer.trim().slice(0, 1200) : ''
      const sourceNote = typeof parsed?.sourceNote === 'string' ? parsed.sourceNote.trim().slice(0, 200) : ''
      if (!answer || !sourceNote) {
        this.logger.warn(`advisor.qa invalid attempt=${attempt}`)
        continue
      }
      const violation = findViolation(`${answer}\n${sourceNote}`)
      if (violation) {
        this.logger.warn(`advisor.qa violation=${violation} attempt=${attempt}`)
        continue
      }
      // E2 需要「本机读到的来源事实」作支撑，本层没有这种输入 → 一律降级为 E3。
      // 让模型自评证据等级又不校验，等于把证据分级做成装饰。
      const claimed = parsed?.evidenceLevel
      const evidenceLevel: EvidenceLevel = claimed === 'E1' ? 'E1' : 'E3'
      return { answer, evidenceLevel, sourceNote, disclaimer: ADVISOR_DISCLAIMER }
    }
    throw new ServiceUnavailableException({
      error: { code: 'ADVISOR_ANSWER_FAILED', message: '这一问暂时答不了，请换个说法再问一次' },
    })
  }

  // ── 3. 填槽型成稿 ──────────────────────────────────────────

  /**
   * 把已填槽位拼成可直接念的稿子。
   *
   * 最硬的一条：**不替用户编**。服务端用 assertNoInventedNumbers 强制校验 ——
   * 稿子里的每个阿拉伯数字都必须在用户自己填的内容里出现过。
   */
  async draft(slots: StoredSlots, slotKeys: readonly string[], ctx: AdvisorLlmContext = {}): Promise<AdvisorDraft> {
    const sys =
      '你在把求职者自己说的话顺成一段可以直接念出口的书面表达。你不是在替他想内容。' +
      '\n硬性要求：' +
      '\n1. 只能使用用户提供的信息。数字、公司名、时间、离职原因、证书资质**一律不得编造**：' +
      '\n   用户没说的，在稿子里写成 ____ 留空，并在 blanks 里列出留空的是什么。' +
      '\n2. 不得出现用户没提供过的任何阿拉伯数字（年限、百分比、数量、金额一律如此）。' +
      '\n3. 不承诺录用、Offer、通过率、薪资；不输出百分比。' +
      '\n4. 不得声称查过任何数据库或系统。' +
      '\n5. 语气自然、口语可念，不要书面套话堆砌。' +
      '\n只输出 JSON（不要 markdown 代码块）：' +
      '{"draft":"成稿正文（留空处用 ____）","blanks":["留空的是什么"],"summary":"一句话说明这稿还差什么"}'

    // 校验基准必须与送模型的那一份完全一致（遮盖后），否则会把合法输出误判成编造
    const maskedParts: string[] = []
    for (const key of slotKeys) {
      const stored = slots[key]
      if (!stored) continue
      maskedParts.push(`【${key}】${maskUserTextForLlmText(stored.value, 'advisor_draft')}`)
    }
    const userInput = maskedParts.join('\n')
    const allowedNumbers = new Set(digitRuns(userInput))

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const raw = await this.callLlm(sys, `【用户自己填的内容】\n${userInput}`, ctx.onLlmCall)
      const parsed = this.parseJson<{ draft?: unknown; blanks?: unknown; summary?: unknown }>(raw)
      const draft = typeof parsed?.draft === 'string' ? parsed.draft.trim().slice(0, 4000) : ''
      const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim().slice(0, 300) : ''
      if (!draft) {
        this.logger.warn(`advisor.draft invalid attempt=${attempt}`)
        continue
      }
      const violation = findViolation(`${draft}\n${summary}`)
      if (violation) {
        this.logger.warn(`advisor.draft violation=${violation} attempt=${attempt}`)
        continue
      }
      const invented = digitRuns(draft).filter((run) => !allowedNumbers.has(run))
      if (invented.length > 0) {
        // 只记条数，不记具体数字（数字本身可能来自用户材料）
        this.logger.warn(`advisor.draft invented_numbers count=${invented.length} attempt=${attempt}`)
        continue
      }
      const blanks = Array.isArray(parsed?.blanks)
        ? (parsed.blanks as unknown[])
            .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
            .map((b) => b.trim().slice(0, 80))
            .slice(0, 10)
        : []
      return { draft, blanks, summary: summary || '空着的地方她不会替你编，请按实际情况补上。' }
    }
    throw new ServiceUnavailableException({
      error: { code: 'ADVISOR_DRAFT_FAILED', message: '成稿失败（可能是模型试图补上你没说过的内容），请稍后重试' },
    })
  }

  // ── 4. 比对型 ──────────────────────────────────────────────

  /**
   * 逐条比「有没有写到」，不比「写得好不好」。
   *
   * covered 项的 evidence 必须是材料原文的真实摘录（归一化子串校验），
   * 校验不过的条目直接降级为 missing —— 宁可说「没写到」也不能拿编的原文当证据。
   */
  async compare(material: string, requirements: string, ctx: AdvisorLlmContext = {}): Promise<AdvisorCompare> {
    const sys =
      '你在做一件很窄的事：把岗位正文的要求逐条拿去材料里找，看**有没有写到**。' +
      '\n硬性要求：' +
      '\n1. 只判断「有没有写到」，不判断「写得好不好」——后者需要行业经验，本机没有依据。' +
      '\n2. verdict 三选一：covered（材料里写到了）/ missing（材料里找不到对应内容）/ ' +
      'not_a_capability（这条不是能力要求，如学历不限、接受出差）。' +
      '\n3. covered 的 evidence **必须是材料里真实出现的原文摘录**，一个字都不能改写或补全。' +
      '\n4. 不得给出「建议投 / 不建议投 / 值得一试」这类裁决，不预测录用结果，不输出百分比。' +
      '\n5. 不得声称查过任何数据库或系统。' +
      '\n只输出 JSON（不要 markdown 代码块）：' +
      '{"items":[{"requirement":"要求原文","verdict":"covered|missing|not_a_capability","evidence":"covered 时填材料原文摘录(≤60字)，其余填一句说明"}],' +
      '"extras":[{"point":"材料里有但岗位没提的点","note":"一句说明"}],' +
      '"summary":"一句话总览（说明这是逐条比对结果，不代表录用判断）"}'

    const maskedMaterial = maskUserTextForLlmText(material.slice(0, 8000), 'advisor_compare_material')
    const maskedReq = maskUserTextForLlmText(requirements.slice(0, 4000), 'advisor_compare_req')
    const user = `【你的材料】\n${maskedMaterial}\n\n【岗位正文要求】\n${maskedReq}`
    const normalizedMaterial = normalizeForMatch(maskedMaterial)

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const raw = await this.callLlm(sys, user, ctx.onLlmCall)
      const parsed = this.parseJson<{ items?: unknown; extras?: unknown; summary?: unknown }>(raw)
      if (!Array.isArray(parsed?.items)) {
        this.logger.warn(`advisor.compare invalid attempt=${attempt}`)
        continue
      }
      const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim().slice(0, 300) : ''
      const violation = findViolation(`${JSON.stringify(parsed.items)}\n${summary}`)
      if (violation) {
        this.logger.warn(`advisor.compare violation=${violation} attempt=${attempt}`)
        continue
      }

      let downgraded = 0
      const items: CompareItem[] = (parsed.items as unknown[])
        .map((entry) => {
          const row = entry as { requirement?: unknown; verdict?: unknown; evidence?: unknown }
          const requirement = typeof row.requirement === 'string' ? row.requirement.trim().slice(0, 200) : ''
          if (!requirement) return null
          const evidence = typeof row.evidence === 'string' ? row.evidence.trim().slice(0, 200) : ''
          const verdict =
            row.verdict === 'covered' || row.verdict === 'not_a_capability' ? row.verdict : 'missing'
          if (verdict !== 'covered') {
            return { requirement, verdict, evidence: evidence || '材料里找不到对应内容' }
          }
          // covered 必须拿得出真实原文，否则降级为 missing（宁可少认，不能拿编的原文当证据）
          const needle = normalizeForMatch(evidence)
          if (needle.length < 4 || !normalizedMaterial.includes(needle)) {
            downgraded += 1
            return {
              requirement,
              verdict: 'missing' as const,
              evidence: '材料里找不到对应内容（AI 给的原文摘录未能在你的材料中核对上，已按「没写到」处理）',
            }
          }
          return { requirement, verdict: 'covered' as const, evidence }
        })
        .filter((row): row is CompareItem => row !== null)
        .slice(0, 30)

      if (items.length === 0) {
        this.logger.warn(`advisor.compare empty_items attempt=${attempt}`)
        continue
      }
      if (downgraded > 0) this.logger.warn(`advisor.compare evidence_downgraded count=${downgraded}`)

      const extras = Array.isArray(parsed.extras)
        ? (parsed.extras as unknown[])
            .map((entry) => {
              const row = entry as { point?: unknown; note?: unknown }
              const point = typeof row.point === 'string' ? row.point.trim().slice(0, 120) : ''
              if (!point) return null
              return { point, note: typeof row.note === 'string' ? row.note.trim().slice(0, 200) : '' }
            })
            .filter((row): row is { point: string; note: string } => row !== null)
            .slice(0, 10)
        : []

      return {
        items,
        extras,
        summary: summary || '以上是逐条比对结果，只反映「有没有写到」，不代表录用判断。',
      }
    }
    throw new ServiceUnavailableException({
      error: { code: 'ADVISOR_COMPARE_FAILED', message: '比对失败，请稍后重试' },
    })
  }

  // ── 传输层 ────────────────────────────────────────────────

  private parseJson<T>(raw: string): T | null {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    try {
      return JSON.parse(cleaned) as T
    } catch {
      const a = cleaned.indexOf('{')
      const b = cleaned.lastIndexOf('}')
      if (a >= 0 && b > a) {
        try { return JSON.parse(cleaned.slice(a, b + 1)) as T } catch { return null }
      }
      return null
    }
  }

  /**
   * 独立功能位 advisor_work（未单独配置时继承 assistant_chat）。
   *
   * 为什么挂 assistant_chat 而不是 resume_optimize：顾问作业面就是 P25 顾问在干活，
   * 与助手对话同源；而 resume_optimize 是简历链的名义归属，S0-3 拆键的目的正是
   * 不要再往它上面挂新能力。密钥仅服务端，绝不下发前端。
   */
  private async callLlm(system: string, user: string, onLlmCall?: AiLlmCallSink): Promise<string> {
    const apiKey = this.config.getApiKey('advisor_work')
    const cfg = this.config.getConfig('advisor_work')
    if (!apiKey || !cfg.enabled) {
      throw new ServiceUnavailableException({
        error: { code: 'AI_NOT_CONFIGURED', message: 'AI 顾问暂未启用，请联系管理员配置' },
      })
    }
    const url = `${cfg.baseURL.replace(/\/$/, '')}/chat/completions`
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: cfg.temperature,
          stream: false,
          // DeepSeek V4：关闭 thinking，避免 reasoning 占满输出导致 content 为空
          ...(cfg.model.startsWith('deepseek-v4') ? { thinking: { type: 'disabled' } } : {}),
        }),
      })
    } catch {
      this.logger.error('advisor.llm network_error')
      throw new ServiceUnavailableException({
        error: { code: 'AI_UNAVAILABLE', message: 'AI 模型连接失败，请稍后重试' },
      })
    }
    const providerLabel = `llm:${cfg.vendor}:${cfg.model}`
    if (!res.ok) {
      onLlmCall?.({ provider: providerLabel })
      this.logger.error(`advisor.llm upstream_non_2xx status=${res.status}`)
      throw new ServiceUnavailableException({
        error: { code: 'AI_UNAVAILABLE', message: `AI 模型返回错误 (${res.status})` },
      })
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: RawLlmUsage
    }
    onLlmCall?.({ provider: providerLabel, tokenUsage: normalizeLlmUsage(data.usage) })
    const reply = data.choices?.[0]?.message?.content?.trim()
    if (!reply) {
      throw new ServiceUnavailableException({
        error: { code: 'AI_UNAVAILABLE', message: 'AI 模型未返回内容' },
      })
    }
    return reply
  }
}

/** 供 verify 脚本做反向验证用（不导出给业务代码调用）。 */
export const __advisorGuardsForTest = { findViolation, digitRuns, normalizeForMatch, CLAIMED_LOOKUP }
