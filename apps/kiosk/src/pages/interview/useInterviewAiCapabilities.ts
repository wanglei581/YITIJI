import { useEffect, useState } from 'react'
import type { KioskAiCapabilitiesResponse, KioskAiCapabilityItem } from '@ai-job-print/shared'
import { aiErrorCodeOf } from '../../ai'
import type { QxTouchAsk } from '../../components/qingxu/touch/QxTouchDock'
import { API_BASE_URL } from '../../services/api/client'
import { terminalAttributedFetch } from '../../services/terminalAuth'

/** 练面试三页用到的 AI 能力键，取自服务端 AI_MODEL_FEATURES。 */
export type InterviewAiKey = 'mock_interview' | 'self_assessment' | 'career_plan' | 'assistant_chat'

/**
 * checking：还没读回来；unconfirmed：读不到（接口失败、超时、返回里没有这一项）；
 * off：服务端明确报「关闭」或「降级」；available：服务端明确报可用。
 * 只有 available 放行，读不到一律按没确认处理，不当成可用。
 */
export type InterviewAiState = 'checking' | 'unconfirmed' | 'off' | 'available'

/** 与 useApiReadiness 同一量级：4 秒读不回来就写「没确认」，不让「正在确认」一直挂着。 */
const CAPABILITIES_TIMEOUT_MS = 4_000

/** 屏上只说用户能懂的话，不把服务端的内部原因（密钥、开发 mock）带上屏。 */
const REASON: Record<Exclude<InterviewAiState, 'available'>, string> = {
  checking: '正在确认AI能力状态',
  unconfirmed: '暂时无法确认AI能力状态',
  off: 'AI能力当前不可用',
}

/**
 * 读 GET /kiosk/ai/capabilities（匿名可读，不调计费 AI）。
 * 它反映后台配置与平台就绪情况，不是实时探活：配置可用不等于这一次调用一定成功，
 * 真正调用失败仍按各页自己的故障分支处理。
 */
export function useInterviewAiCapabilities() {
  const [items, setItems] = useState<KioskAiCapabilityItem[] | null>(null)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      controller.abort()
      if (active) setItems((prev) => prev ?? [])
    }, CAPABILITIES_TIMEOUT_MS)
    void terminalAttributedFetch(`${API_BASE_URL}/kiosk/ai/capabilities`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('capabilities unavailable')
        const body = await response.json() as { data?: KioskAiCapabilitiesResponse }
        if (!Array.isArray(body.data?.items)) throw new Error('invalid capabilities')
        if (active) setItems(body.data.items)
      })
      .catch(() => { if (active) setItems((prev) => prev ?? []) })
      .finally(() => window.clearTimeout(timer))
    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [])

  const state = (key: InterviewAiKey): InterviewAiState => {
    if (items === null) return 'checking'
    const item = items.find((entry) => entry.key === key)
    if (!item) return 'unconfirmed'
    return item.status === 'available' ? 'available' : 'off'
  }
  /** 可用时为 null；其余状态给出屏上要写的原因。 */
  const reason = (key: InterviewAiKey): string | null => {
    const current = state(key)
    return current === 'available' ? null : REASON[current]
  }
  return { state, reason }
}

/**
 * 服务端 AI 闸门（暂停、当日金额上限、公共额度）对所有 AI 入口一视同仁，
 * 命中这些码就能判定小青这次也用不了。其余能力级故障（某一项没配、模型连不上）只说明这一项，
 * 不拿来判小青。
 */
const AI_GATE_CODES: ReadonlySet<string> = new Set([
  'AI_PAUSED',
  'AI_BUDGET_EXHAUSTED',
  'AI_BUDGET_UNAVAILABLE',
  'AI_PUBLIC_QUOTA_EXCEEDED',
])

export function isAiGateDown(error: unknown): boolean {
  return AI_GATE_CODES.has(aiErrorCodeOf(error))
}

/** 顶栏胶囊：本场已观测到故障、或配置明确关闭 → 不能出题；读不到 → 没确认；读取中 → 确认中。 */
export function interviewAiPill(
  state: InterviewAiState,
  observedOutage: boolean,
  ready: { tone: 'ok' | 'warn'; label: string } = { tone: 'ok', label: 'AI 模拟面试' },
): { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string } {
  if (observedOutage || state === 'off') return { tone: 'bad', label: 'AI 暂时不能出题' }
  if (state === 'unconfirmed') return { tone: 'bad', label: 'AI 状态未确认' }
  if (state === 'checking') return { tone: 'unknown', label: 'AI 状态确认中' }
  return ready
}

/** 小青这次不能用时的底栏：位置留着，写明为什么，再写本屏还能做什么（照稿 st-ai-down）。 */
export function assistantOffAsk(state: InterviewAiState, hint: string): Extract<QxTouchAsk, { disabled: true }> {
  const head = state === 'checking' ? '小青状态确认中' : state === 'unconfirmed' ? '小青状态未确认' : '小青暂时不可用'
  return { label: `${head}，${hint}`, disabled: true }
}
