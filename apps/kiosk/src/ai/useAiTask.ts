import { useMemo } from 'react'

/**
 * AI 任务状态原语 —— `data-aitask` 的生产实现（S1-1）。
 *
 * 契约来源：`docs/design/kiosk-ai-os-v3-2026-08/01-home-v6.html:161-190`
 * 「AI 任务状态绑定：data-aitask —— 接线契约（生产必须照此实现）」。
 * 原型里该契约只落在 P01 一页，这里把它提升为全站共享原语。
 *
 * 四态只有 `idle / running / done / failed`，不得扩充。
 *
 * 原型五条接线要求，本文件逐条如何满足：
 *
 *  1. 「只能由后端任务状态驱动（轮询 / SSE / WebSocket），前端不得用计时器自行推进。」
 *     → 本文件没有 `useState` / `useEffect` / `setTimeout` / `setInterval`。
 *       状态是对调用方传入的真实生命周期的**纯派生**，前端根本没有可推进的地方。
 *
 *  2. 「没有任务时（idle）不许自转。」
 *     → 派生值直接落到容器的 `data-aitask` 上；`AiTaskRegion` 更进一步：
 *       `running` 之外根本不挂载进度子树，动效没有存在的机会。
 *
 *  3. 「running 的存续时间由后端决定，前端不得设『到点就变 done』的兜底计时器。」
 *     → 同第 1 条：没有计时器。`done` 只可能来自调用方给出的 `hasResult`。
 *       原型里标了 `PROTOTYPE-ONLY` 的计时器回收逻辑（`01-home-v6.html:1071-1075`）
 *       **没有**被搬运过来。
 *
 *  4. 「data-state="ai-down" 时 data-aitask 恒为 failed，任何用户输入都不得把它推回 running。」
 *     → `availability: 'unavailable'` 的硬钳位写在派生函数第一条分支，
 *       `pending` / `hasResult` 为真也一律不例外。
 *
 *  5. 「failed 必须停在明确的不可用表现，并保留不依赖 AI 的路径。」
 *     → `AiTaskRegion` 把 `fallback` 设成**必填** prop，由类型系统强制。
 */

/** 原型契约规定的四态，不得扩充。 */
export type AiTaskState = 'idle' | 'running' | 'done' | 'failed'

/**
 * AI 服务可用性。
 * - `available`：健康检查通过，可以发起任务。
 * - `unavailable`：等价于原型的 `data-state="ai-down"`。
 * - `unknown`：还没探到能力配置。按 `interface-handoff.md` §0② fail-closed —
 *   不得默认服务正常，也不得渲染成「在算」。
 */
export type AiAvailability = 'available' | 'unavailable' | 'unknown'

/** 不能发起 / 不能出结论的原因分类，供调用方选降级文案。 */
export type AiTaskBlockReason =
  | 'ai-unavailable'
  | 'availability-unknown'
  | 'task-failed'
  | 'task-running'
  | null

export interface AiTaskSource {
  /** AI 服务可用性。调用方须给真值（健康检查 / 就绪探测），不得写死 `available`。 */
  availability: AiAvailability
  /**
   * 后端已受理且任务未结束。
   * **只能**来自轮询 / SSE / WebSocket 的真实任务生命周期，
   * 不得由前端计时器、动画帧或乐观更新推出来。
   */
  pending: boolean
  /** 后端返回失败，或调用抛错。重试前调用方必须先把这一位清掉。 */
  failed?: boolean
  /** 结果已经拿到且可以渲染。它是 `done` 的唯一来源。 */
  hasResult?: boolean
}

export interface AiTaskStatus {
  state: AiTaskState
  isIdle: boolean
  isRunning: boolean
  isDone: boolean
  isFailed: boolean
  /** 是否允许发起新任务。`availability` 非 `available` 时恒为 false。 */
  canStart: boolean
  blockReason: AiTaskBlockReason
  /** 展开到容器 DOM 上即可，值就是原型契约里的 `data-aitask`。 */
  containerProps: { 'data-aitask': AiTaskState; 'aria-busy': boolean }
}

/**
 * 纯派生函数，无状态、无副作用、无计时器。
 *
 * 分支次序是刻意的：**任何时候都不得把「没在算」渲染成「在算」**。
 * 所以 `unavailable` 与 `failed` 排在 `pending` 之前 —— 宁可停在诚实的失败态，
 * 也不制造一个空转的进度条。
 */
export function deriveAiTaskState(source: AiTaskSource): AiTaskState {
  // 要求 4：ai-down 硬钳位。pending / hasResult 为真也推不回 running / done。
  if (source.availability === 'unavailable') return 'failed'

  // fail-closed：能力探测没有结论时不得默认正常，也不得声称在算。
  // 停在 idle（而不是 failed），由调用方给「服务状态无法确认」的文案。
  if (source.availability === 'unknown') return source.failed ? 'failed' : 'idle'

  if (source.failed) return 'failed'
  if (source.pending) return 'running'
  if (source.hasResult) return 'done'
  return 'idle'
}

function resolveBlockReason(source: AiTaskSource, state: AiTaskState): AiTaskBlockReason {
  if (source.availability === 'unavailable') return 'ai-unavailable'
  if (source.availability === 'unknown') return 'availability-unknown'
  if (state === 'failed') return 'task-failed'
  if (state === 'running') return 'task-running'
  return null
}

/**
 * 把真实任务生命周期派生成 `data-aitask` 四态。
 *
 * 用法（注意 `pending` 必须来自后端真值）：
 * ```tsx
 * const task = useAiTask({
 *   availability: aiReady ? 'available' : 'unavailable',
 *   pending: job?.status === 'running',
 *   failed: job?.status === 'failed',
 *   hasResult: Boolean(result),
 * })
 * ```
 */
export function useAiTask(source: AiTaskSource): AiTaskStatus {
  const { availability, pending, failed, hasResult } = source

  return useMemo(() => {
    const normalized: AiTaskSource = { availability, pending, failed, hasResult }
    const state = deriveAiTaskState(normalized)

    if (import.meta.env.DEV && availability === 'unavailable' && pending) {
      // 这不是崩溃，只是提醒调用方：AI 不可用时不会有 running 态，
      // 也不要在这一态下继续轮询假装任务还活着。
      console.warn(
        '[useAiTask] availability="unavailable" 时 data-aitask 恒为 failed，本次传入的 pending=true 已被忽略。',
      )
    }

    return {
      state,
      isIdle: state === 'idle',
      isRunning: state === 'running',
      isDone: state === 'done',
      isFailed: state === 'failed',
      canStart: availability === 'available' && state !== 'running',
      blockReason: resolveBlockReason(normalized, state),
      containerProps: { 'data-aitask': state, 'aria-busy': state === 'running' },
    }
  }, [availability, pending, failed, hasResult])
}
