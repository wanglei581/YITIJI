// ============================================================
// S3-3 · P26 顾问作业面 —— 作业型与输入槽注册表（纯函数，不依赖 Nest / DB / 模型）。
//
// 设计真值：docs/design/kiosk-ai-os-v3-2026-08/26-advisor-work.html
//
// 设计页的两条硬要求直接决定了本文件的结构：
//   1.「型由你的问题决定，不用你选」→ 判型是服务端行为（见 llm-advisor.service.ts），
//      本文件只提供**关键词兜底**，供模型不可用时仍能给出一个诚实的型（skillSource='fallback'）。
//   2.「判错了顶部能一键换，换的时候已填的内容不丢」→ 槽位按 slotKey 全局存，
//      **不按作业型分桶**。换型只是换了「读哪几个槽」的视图，已填值原样留在 slotsJson 里。
//
// 因此 SLOT_SPECS 是一张全局槽表，SKILL_SPECS 只声明各型「要看哪几个槽、哪几个必填」。
// 两个型共用同一个 slotKey 时（如 target_requirements），换型后那一槽自动继承已填值。
// ============================================================

/** 三种作业型。取值与 AdvisorSession.skill 列一致。 */
export const ADVISOR_SKILLS = ['qa', 'slot_fill', 'compare'] as const
export type AdvisorSkill = (typeof ADVISOR_SKILLS)[number]

export function isAdvisorSkill(value: unknown): value is AdvisorSkill {
  return typeof value === 'string' && (ADVISOR_SKILLS as readonly string[]).includes(value)
}

/** 会话状态机取值。 */
export const ADVISOR_STATUSES = ['collecting', 'ready', 'completed', 'abandoned'] as const
export type AdvisorStatus = (typeof ADVISOR_STATUSES)[number]

/**
 * 证据分级（设计页「比对口径与证据分级」）：
 * - E1 你说过的话与你的材料
 * - E2 本机读到的岗位正文等来源事实
 * - E3 AI 的判断与建议，仅供参考
 */
export const EVIDENCE_LEVELS = ['E1', 'E2', 'E3'] as const
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number]

export function isEvidenceLevel(value: unknown): value is EvidenceLevel {
  return typeof value === 'string' && (EVIDENCE_LEVELS as readonly string[]).includes(value)
}

/** 统一免责标注。任何 AI 判断出口都必须带上（CLAUDE.md §9「不伪造能力」）。 */
export const ADVISOR_DISCLAIMER = 'AI 判断，仅供参考'

export interface AdvisorSlotSpec {
  readonly key: string
  /** 问用户的那句话（页面直接展示） */
  readonly prompt: string
  /** 补充说明 / 输入提示 */
  readonly hint: string
  readonly maxChars: number
}

/**
 * 全局输入槽表。
 *
 * 槽位内容是**用户自己填的材料**，送模型前一律过 PII 遮盖（见 llm-advisor.service.ts）。
 */
export const SLOT_SPECS: readonly AdvisorSlotSpec[] = [
  // ── 问答型 ──
  {
    key: 'question',
    prompt: '你想问什么？',
    hint: '直接说就行，不用组织语言',
    maxChars: 600,
  },
  // ── 填槽型（对应设计页「帮你写一段自我介绍 · 共 4 问」）──
  {
    key: 'current_role',
    prompt: '你现在做什么，做了多久？',
    hint: '岗位方向 + 年限即可',
    maxChars: 300,
  },
  {
    key: 'best_achievement',
    prompt: '这些年里，你做成过最拿得出手的一件事是什么？',
    hint: '说清做了什么、结果是什么；数字按你实际的写，没有就不写',
    maxChars: 600,
  },
  {
    key: 'why_this_job',
    prompt: '你为什么想投这个岗？',
    hint: '最后一句要落到「所以我想做什么」，否则听完不知道你要什么',
    maxChars: 400,
  },
  {
    key: 'extra_note',
    prompt: '有没有希望对方知道、但简历上没写的？',
    hint: '比如证书在考、能接受出差、离职原因；没有就填「无」',
    maxChars: 400,
  },
  // ── 比对型 ──
  {
    key: 'my_material',
    prompt: '你的简历里写了什么？',
    hint: '粘贴简历正文，或从简历工作台带过来',
    maxChars: 8000,
  },
  {
    key: 'target_requirements',
    prompt: '要对照的岗位正文要求是什么？',
    hint: '粘贴岗位正文的要求部分',
    maxChars: 4000,
  },
]

const SLOT_BY_KEY = new Map(SLOT_SPECS.map((slot) => [slot.key, slot]))

export function slotSpecOf(key: string): AdvisorSlotSpec | undefined {
  return SLOT_BY_KEY.get(key)
}

export interface AdvisorSkillSpec {
  readonly skill: AdvisorSkill
  readonly label: string
  /** 页面副标题：这一型在干什么 */
  readonly tagline: string
  /** 本型按顺序要问的槽 */
  readonly slotKeys: readonly string[]
  /** 必填槽（缺任一 → status 停在 collecting，run 拒绝并如实回报缺哪几个） */
  readonly requiredSlotKeys: readonly string[]
  /** 产物类型，落 AdvisorArtifact.kind */
  readonly artifactKind: 'qa_pins' | 'slot_draft' | 'compare_report'
}

export const SKILL_SPECS: Readonly<Record<AdvisorSkill, AdvisorSkillSpec>> = {
  qa: {
    skill: 'qa',
    label: '问答型',
    tagline: '有用的记得钉住 —— 对话不保存，钉住的能打成纸',
    slotKeys: ['question'],
    requiredSlotKeys: ['question'],
    artifactKind: 'qa_pins',
  },
  slot_fill: {
    skill: 'slot_fill',
    label: '填槽型',
    tagline: '她问，你答，最后拼成一段可以直接念的话',
    slotKeys: ['current_role', 'best_achievement', 'why_this_job', 'extra_note'],
    requiredSlotKeys: ['current_role', 'best_achievement', 'why_this_job'],
    artifactKind: 'slot_draft',
  },
  compare: {
    skill: 'compare',
    label: '比对型',
    tagline: '逐条比「有没有写到」，不比「写得好不好」',
    slotKeys: ['my_material', 'target_requirements'],
    requiredSlotKeys: ['my_material', 'target_requirements'],
    artifactKind: 'compare_report',
  },
}

// ── 输入槽状态 ────────────────────────────────────────────────

export interface StoredSlotValue {
  value: string
  filledAt: string
}

/** slotsJson 的形状。键是全局 slotKey，不按作业型分桶 —— 换型不丢的实现基础。 */
export type StoredSlots = Record<string, StoredSlotValue>

export function parseSlots(raw: string): StoredSlots {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: StoredSlots = {}
    for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!SLOT_BY_KEY.has(key)) continue // 未知槽（旧版本遗留）静默丢弃，不炸会话
      const value = (entry as { value?: unknown })?.value
      const filledAt = (entry as { filledAt?: unknown })?.filledAt
      if (typeof value !== 'string' || !value) continue
      out[key] = { value, filledAt: typeof filledAt === 'string' ? filledAt : new Date(0).toISOString() }
    }
    return out
  } catch {
    return {} // 损坏行按「还没填」处理，用户重填即可；绝不因此让整个会话不可读
  }
}

export interface AdvisorSlotView {
  key: string
  prompt: string
  hint: string
  maxChars: number
  required: boolean
  filled: boolean
  /** 已填值原样回显（供用户核对 / 修改）。未填为 null。 */
  value: string | null
  filledAt: string | null
}

/** 当前作业型下的槽位视图（按 spec 顺序）。 */
export function slotViews(skill: AdvisorSkill, slots: StoredSlots): AdvisorSlotView[] {
  const spec = SKILL_SPECS[skill]
  return spec.slotKeys.map((key) => {
    const slotSpec = SLOT_BY_KEY.get(key)!
    const stored = slots[key]
    return {
      key,
      prompt: slotSpec.prompt,
      hint: slotSpec.hint,
      maxChars: slotSpec.maxChars,
      required: spec.requiredSlotKeys.includes(key),
      filled: !!stored,
      value: stored?.value ?? null,
      filledAt: stored?.filledAt ?? null,
    }
  })
}

/** 还缺哪些必填槽。空数组 = 可以出活了。 */
export function missingRequiredSlots(skill: AdvisorSkill, slots: StoredSlots): string[] {
  return SKILL_SPECS[skill].requiredSlotKeys.filter((key) => !slots[key])
}

/** 下一个该问的槽（先补必填，再问选填）。全填完返回 null。 */
export function nextSlotKey(skill: AdvisorSkill, slots: StoredSlots): string | null {
  const spec = SKILL_SPECS[skill]
  return (
    spec.requiredSlotKeys.find((key) => !slots[key]) ??
    spec.slotKeys.find((key) => !slots[key]) ??
    null
  )
}

/**
 * 会话状态推导（纯函数）。
 *
 * completed 是「已出过产物」的粘性状态：出过产物之后用户改槽位，状态回到 ready
 * 而不是倒回 collecting —— 已有产物仍然可查可打印（设计页：AI 不可用时已生成的内容不受影响）。
 */
export function deriveStatus(
  skill: AdvisorSkill,
  slots: StoredSlots,
  hasArtifact: boolean,
): AdvisorStatus {
  if (missingRequiredSlots(skill, slots).length > 0) return 'collecting'
  return hasArtifact ? 'completed' : 'ready'
}

// ── 判型关键词兜底 ────────────────────────────────────────────
//
// 设计页把三种型的触发语义写得很直白：
//   「够不够格」→ 比对型 / 「我不会写」→ 填槽型 / 「要不要、该不该」→ 问答型
// 模型可用时由模型判（更准）；模型不可用时用这张表，并如实标 skillSource='fallback'，
// 前端可据此说明「这次是按关键词判的型，判错了可以一键换」。

const COMPARE_HINTS = [
  '够不够', '够格', '符合吗', '符不符合', '匹配', '对得上', '差多少', '差距',
  '达标', '合不合适', '要求', '对照', '比一比', '比对', '能不能投',
]

const SLOT_FILL_HINTS = [
  '不会写', '怎么写', '帮我写', '写一段', '写一份', '起草', '润色', '组织语言',
  '自我介绍', '求职信', '自荐信', '开场白', '说辞', '成稿',
]

/**
 * 关键词判型兜底。
 *
 * 顺位：比对型 > 填槽型 > 问答型。
 * 问答型是**默认落点**而不是「判不出来」—— 设计页对问答型的定义就是
 * 「没有现成的两样东西可比、东西也已经存在，那就是直接问」，所以它天然是兜底型。
 */
export function classifySkillByKeyword(topic: string): { skill: AdvisorSkill; reason: string } {
  const text = topic.trim()
  if (COMPARE_HINTS.some((hint) => text.includes(hint))) {
    return {
      skill: 'compare',
      reason: '你问的像是「够不够格」——有明确的两样东西要放一起看，所以按比对型办。',
    }
  }
  if (SLOT_FILL_HINTS.some((hint) => text.includes(hint))) {
    return {
      skill: 'slot_fill',
      reason: '你说的像是「我不会写」——东西还不存在，得先问出来，所以按填槽型办。',
    }
  }
  return {
    skill: 'qa',
    reason: '你问的是一个拿不准的判断，没有现成的两样东西可比——所以按问答型办。',
  }
}

// ── 「本机比不了的」：服务端常量，不由模型生成 ────────────────
//
// 设计页把这块单独列出来，是因为它是**能力边界声明**，不是 AI 的输出。
// 让模型生成等于让它自己声明自己的边界 —— 模型完全可能漏说或改口。
// 所以这三条写死在服务端，每份比对产物无条件带上。
export const COMPARE_LIMITS: ReadonlyArray<{ what: string; why: string }> = [
  {
    what: '你写的这些是不是真的',
    why: '本机只看材料上有没有这句话，核不了真伪 —— 面试会问细节。',
  },
  {
    what: '写得好不好、有没有说服力',
    why: '这要懂这一行的人才看得出来，本机没有依据。',
  },
  {
    what: '你会不会被录用',
    why: '由用人单位决定，本机不预测。',
  },
]

/** 填槽型「不替你编」的留白口径，随成稿产物一起返回给前端展示。 */
export const SLOT_DRAFT_BLANK_POLICY: readonly string[] = [
  '数字', '公司名', '时间', '离职原因', '证书 / 资质',
]
