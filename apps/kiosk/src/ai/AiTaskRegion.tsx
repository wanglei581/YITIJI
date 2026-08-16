import { useId } from 'react'
import type { ReactNode } from 'react'
import { AiCapabilityChip } from './AiEvidence'
import type { AiTaskStatus } from './useAiTask'

/**
 * `data-aitask` 四态的包装组件（S1-1）。
 *
 * 它做三件在每页重复出现、且很容易做错的事：
 *
 * 1. **把四态铺到 DOM 上**：容器带 `data-aitask`，CSS 只在 `running` 放进度动效。
 * 2. **结构性杜绝空转**：`running` 之外根本不挂载进度子树 —— 进度条没有机会在
 *    「其实没在算」的时候转。这是原型第 2 / 3 条接线要求的落点。
 * 3. **强制 AI 不可用时功能不消失**：`fallback` 是**必填** prop。
 *
 * 产品口径（2026-08-16 拍板）：
 *   AI 可用   → 用户一句话 / 一键，AI 直接办成
 *   AI 不可用 → 功能不消失，按能力性质三选一处置
 *   禁止      → AI 挂了整个入口消失 / 整页瘫痪 / 按钮变死 / 假装成功
 *
 * 三种处置按能力性质区分，不能一刀切（见 `AiTaskFallback`）：
 *   ① `manual`             AI 只是加速器，有手动替代 → 退化成用户自己一步步做
 *   ② `blocked`            AI 是唯一产出源、有入口按钮 → 按钮置灰 + 写清原因
 *   ③ `result-unavailable` AI 是唯一产出源、无按钮直接出结果 → 结果区诚实说办不到
 *
 * 只按 ① 实现会逼着 AI-only 能力编一条假的手动路径 —— 那才是伪造能力。
 */

/** ① AI 只是加速器：功能退化成用户自己做，结果一样能拿到。 */
export interface AiTaskFallbackManual {
  mode: 'manual'
  /** 为什么没有 AI。必填，禁止只写「AI 暂不可用」。 */
  reason: string
  /** 用户自己一步步怎么做。必填，必须是具体路径而不是安慰话。 */
  manualPath: string
  /** 至少一个仍可用的前进动作（返回与全局导航不算）。 */
  action: { label: string; onClick: () => void }
}

/** ② AI 是唯一产出源且有入口按钮：按钮置灰 + 写清原因，用户只能看原件。 */
export interface AiTaskFallbackBlocked {
  mode: 'blocked'
  /** 为什么灰。必填，且必须常驻可见（不能只放 tooltip）。 */
  reason: string
  /** 被置灰的入口按钮文案。 */
  blockedActionLabel: string
  /** AI 挂了但仍然拿得到的东西，例如「你的简历原文照常可看」。 */
  stillAvailable: string
  /** 可选的仍可用动作，例如「看我的简历原文」。 */
  action?: { label: string; onClick: () => void }
}

/** ③ AI 是唯一产出源且无按钮直接出结果：结果区直接说办不到。 */
export interface AiTaskFallbackResultUnavailable {
  mode: 'result-unavailable'
  /** 为什么这份报告 / 结论出不来。必填。 */
  reason: string
  /** 服务恢复后用户该怎么办。必填。 */
  retryHint: string
  /** 可选的仍可用动作，例如「看我上传的原件」。 */
  action?: { label: string; onClick: () => void }
}

export type AiTaskFallback =
  | AiTaskFallbackManual
  | AiTaskFallbackBlocked
  | AiTaskFallbackResultUnavailable

export interface AiTaskRegionProps {
  /** 来自 `useAiTask`。 */
  task: AiTaskStatus
  /** 这块区域在做什么，用于无障碍标注，例如「AI 岗位排序」。 */
  label: string
  /** `running` 时渲染。只有它会被挂载在 running 态，进度动效放这里。 */
  running?: ReactNode
  /** `idle` 时渲染（还没提交任务 / 未登录 / 能力未确认）。 */
  idle?: ReactNode
  /** `failed` 时的降级处置。必填 —— AI 不可用时功能不许消失。 */
  fallback: AiTaskFallback
  /** `done` 时渲染的结果。 */
  children?: ReactNode
  className?: string
}

export function AiTaskRegion({
  task,
  label,
  running,
  idle,
  fallback,
  children,
  className,
}: AiTaskRegionProps) {
  return (
    <section
      className={['kiosk-ai-task', className].filter(Boolean).join(' ')}
      aria-label={label}
      data-ai-fallback-mode={task.isFailed ? fallback.mode : undefined}
      {...task.containerProps}
    >
      {/* running 之外不挂载进度子树：进度条没有机会在没在算的时候转。 */}
      {task.isRunning ? running ?? null : null}
      {task.isIdle ? idle ?? null : null}
      {task.isDone ? children ?? null : null}
      {task.isFailed ? <AiTaskFallbackView label={label} fallback={fallback} /> : null}
    </section>
  )
}

function AiTaskFallbackView({ label, fallback }: { label: string; fallback: AiTaskFallback }) {
  const reasonId = useId()

  return (
    <div className="kiosk-ai-fallback" data-ai-fallback-mode={fallback.mode} aria-live="polite">
      <p className="kiosk-ai-fallback__head">
        <AiCapabilityChip tone="degraded" />
        <span className="kiosk-ai-fallback__title">{label}</span>
      </p>

      {/* 原因常驻可见（不是 tooltip、不是 title 属性），并被 aria-describedby 引用。 */}
      <p className="kiosk-ai-fallback__reason" id={reasonId}>
        {fallback.reason}
      </p>

      {fallback.mode === 'manual' ? (
        <>
          <p className="kiosk-ai-fallback__path">{fallback.manualPath}</p>
          <button
            type="button"
            className="kiosk-ai-fallback__action"
            onClick={fallback.action.onClick}
            data-ai-fallback-action="manual"
          >
            {fallback.action.label}
          </button>
        </>
      ) : null}

      {fallback.mode === 'blocked' ? (
        <>
          <p className="kiosk-ai-fallback__path">{fallback.stillAvailable}</p>
          {/*
            置灰入口：真 <button> + aria-disabled，**不加原生 disabled**。
            原生 disabled 会把按钮踢出 Tab 序列、读屏软件直接跳过，
            用户永远读不到「为什么灰」；CLAUDE.md §9 要求禁用态可解释。
            这里同时不绑 onClick，按下去不会有任何副作用。
          */}
          <button
            type="button"
            className="kiosk-ai-fallback__action kiosk-ai-fallback__action--blocked"
            aria-disabled="true"
            aria-describedby={reasonId}
            data-ai-fallback-action="blocked"
          >
            {fallback.blockedActionLabel}
          </button>
          {fallback.action ? (
            <button
              type="button"
              className="kiosk-ai-fallback__action"
              onClick={fallback.action.onClick}
              data-ai-fallback-action="alternative"
            >
              {fallback.action.label}
            </button>
          ) : null}
        </>
      ) : null}

      {fallback.mode === 'result-unavailable' ? (
        <>
          <p className="kiosk-ai-fallback__path">{fallback.retryHint}</p>
          {fallback.action ? (
            <button
              type="button"
              className="kiosk-ai-fallback__action"
              onClick={fallback.action.onClick}
              data-ai-fallback-action="alternative"
            >
              {fallback.action.label}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
