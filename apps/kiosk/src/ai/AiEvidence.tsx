import { useEffect } from 'react'
import type { ReactNode } from 'react'
// 样式随组件走（与 AssistantPage 的 assistant-advisor.css 同一模式），
// 不进 index.css —— index.css 的 import 顺序是 verify-fusion-shell 锁死的合同。
import '../styles/ai-primitives.css'

/**
 * AI 免责 / 证据分级共享组件（S1-2）。
 *
 * 契约来源：`docs/design/kiosk-ai-os-v3-2026-08/interface-handoff.md` §3
 *   | E1 | 用户自己的材料事实 |
 *   | E2 | 系统 / 来源方事实 |
 *   | E3 | AI 判断 —— **必须带「仅供参考」，禁止百分比 / 录用概率 / 通过率** |
 *   AIGC 标识：所有 AI 生成内容（含打印件）必须带可见标识，**每页恰好一次**。
 *
 * 为什么要收成共享组件：接线矩阵 §三 问题 F1 实测 —— 21+ 个页面各写各的免责文案，
 * 全站「AI 判断」字样 0 处。再往下接 17 个页面会得到 17 套不一致的免责表达。
 *
 * 字号口径：徽章字号走 `--kiosk-ai-ev-fz`，最小 13px。
 * 原型早期硬编码的 11px 已被判定为「把最该被读到的标记做成最读不到的」并上调为
 * `var(--fz-1)`=13px（`styles/components.css` `.ev`），生产实现不得回退到 11px。
 */

export type EvidenceLevel = 'E1' | 'E2' | 'E3'

/** 三档证据分级的用户可读名。文案与原型图例逐字对齐。 */
export const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  E1: '你的材料',
  E2: '来源信息',
  E3: 'AI 判断',
}

/** E3 结论必带的免责后缀，禁止调用方自行改写。 */
export const AI_JUDGEMENT_DISCLAIMER = '仅供参考'

/** 全站统一的「AI 判断 · 仅供参考」整串文案。 */
export const AI_JUDGEMENT_TEXT = `${EVIDENCE_LABEL.E3} · ${AI_JUDGEMENT_DISCLAIMER}`

/** AIGC 可见标识文案（每页恰好一次）。 */
export const AIGC_MARK_TEXT = 'AI 生成内容（AIGC）· 仅供参考'

/**
 * E3 结论里禁止出现的量化断言（`interface-handoff.md` §3：禁止百分比 / 录用概率 / 通过率）。
 * 导出给调用方在渲染模型输出前自检。
 */
export const FORBIDDEN_E3_CLAIM_PATTERNS: readonly RegExp[] = [
  /\d\s*%/,
  /百分之/,
  /录用(概)?率/,
  /通过率/,
  /命中率/,
  /成功率/,
  /(录用|通过|入职)(的)?可能性\s*\d/,
]

export function hasForbiddenE3Claim(text: string): boolean {
  return FORBIDDEN_E3_CLAIM_PATTERNS.some((pattern) => pattern.test(text))
}

type EvidenceBadgeProps =
  | {
      level: 'E1' | 'E2'
      /** 同段落已写明依据时可只显示级别代号。 */
      compact?: boolean
      className?: string
    }
  | {
      /**
       * E3 不提供 compact —— §3 要求「必须带『仅供参考』」，
       * 类型层面堵死「只显示 E3 三个字符」的写法。
       */
      level: 'E3'
      compact?: never
      className?: string
    }

/**
 * 证据分级徽章。E3 恒带「仅供参考」，不可省略。
 */
export function EvidenceBadge(props: EvidenceBadgeProps) {
  const { level, className } = props
  const compact = props.level === 'E3' ? false : props.compact === true
  const full =
    level === 'E3' ? `${level} ${AI_JUDGEMENT_TEXT}` : `${level} ${EVIDENCE_LABEL[level]}`

  return (
    <span
      className={['kiosk-ev', `kiosk-ev--${level.toLowerCase()}`, className].filter(Boolean).join(' ')}
      data-evidence={level}
      aria-label={full}
      title={full}
    >
      {compact ? level : full}
    </span>
  )
}

/**
 * 三档证据分级图例。放在带 AI 结论页面的底部，解释三种徽章各自代表什么。
 * 文案与原型 `09b-resume-optimize.html:292-294` 一致。
 */
export function EvidenceLegend({ className }: { className?: string }) {
  return (
    <div className={['kiosk-ev-legend', className].filter(Boolean).join(' ')}>
      <span className="kiosk-ev-legend__item">
        <EvidenceBadge level="E1" />
        你自己写的那句话
      </span>
      <span className="kiosk-ev-legend__item">
        <EvidenceBadge level="E2" />
        岗位公告等来源方给的事实
      </span>
      <span className="kiosk-ev-legend__item">
        <EvidenceBadge level="E3" />
        AI 写的，{AI_JUDGEMENT_DISCLAIMER}
      </span>
    </div>
  )
}

/**
 * 一行式 AI 免责声明，用于 AI 结论区顶部。
 */
export function AiDisclaimerLine({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <p className={['kiosk-ai-disclaimer', className].filter(Boolean).join(' ')} data-ai-disclaimer="true">
      <EvidenceBadge level="E3" />
      <span>{children ?? '以下结论由 AI 生成，不构成录用、薪资或办理结果的承诺。'}</span>
    </p>
  )
}

/** 域首屏用的状态标签口径（`32-resume-hub.html:192-193`）：状态标签，不是入口。 */
export type AiCapabilityTone = 'ai' | 'degraded' | 'none'

const CAPABILITY_CHIP_TEXT: Record<AiCapabilityTone, string> = {
  ai: `AI · ${AI_JUDGEMENT_DISCLAIMER}`,
  degraded: 'AI · 已降级',
  none: '不依赖 AI',
}

/**
 * 能力状态标签。`ai-down` 时 AI 卡改「AI · 已降级」而不是让标签消失 ——
 * 标签消失会让用户以为这张卡本来就与 AI 无关。
 */
export function AiCapabilityChip({ tone, className }: { tone: AiCapabilityTone; className?: string }) {
  return (
    <span
      className={['kiosk-ai-chip', `kiosk-ai-chip--${tone}`, className].filter(Boolean).join(' ')}
      data-ai-capability={tone}
    >
      {CAPABILITY_CHIP_TEXT[tone]}
    </span>
  )
}

/**
 * 每页恰好一次的 AIGC 可见标识。
 * DEV 下有单例守卫：同一时刻挂载超过一个会报错，防止「每页恰好一次」被稀释。
 */
let mountedAigcMarks = 0

export function AigcMark({ className }: { className?: string }) {
  useEffect(() => {
    mountedAigcMarks += 1
    if (import.meta.env.DEV && mountedAigcMarks > 1) {
      console.error(
        `[AigcMark] 当前页同时挂载了 ${mountedAigcMarks} 个 AIGC 标识；契约要求每页恰好一次。`,
      )
    }
    return () => {
      mountedAigcMarks -= 1
    }
  }, [])

  return (
    <span className={['kiosk-aigc-mark', className].filter(Boolean).join(' ')} data-aigc-mark="true">
      {AIGC_MARK_TEXT}
    </span>
  )
}

/**
 * 一条 E3 结论：徽章 + 正文。
 * DEV 下校验正文不含被禁止的量化断言（百分比 / 录用概率 / 通过率）。
 */
export function AiConclusion({ text, className }: { text: string; className?: string }) {
  if (import.meta.env.DEV && hasForbiddenE3Claim(text)) {
    console.error(
      '[AiConclusion] E3 结论不得出现百分比 / 录用概率 / 通过率等量化断言（interface-handoff.md §3）。',
    )
  }

  return (
    <p className={['kiosk-ai-conclusion', className].filter(Boolean).join(' ')}>
      <EvidenceBadge level="E3" />
      <span>{text}</span>
    </p>
  )
}
