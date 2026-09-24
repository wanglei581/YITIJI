// ============================================================
// AdvisorConversation — P25 对话流的呈现层
//
// 从 AssistantPage.tsx 拆出（CLAUDE.md §8）。这里只负责**怎么显示一条消息**，
// 不持有会话状态、不发请求 —— 请求组装、会话重置、旧响应拦截仍在 AssistantPage.tsx。
//
// 本模块承担 S2-5 最要命的那条规则：
//   **只有 `kind === 'ai'` 的气泡才带 E3「AI 判断 · 仅供参考」并显示模型正文。**
// mock 回落的预置话术不会走到这里 —— 它在 AssistantPage 就被拦下，
// 连 state 都不进（见 advisorProvider.ts）。这里渲染的是那一轮的**诚实说明**。
// ============================================================

import type { AssistantAction } from '@ai-job-print/shared'
import { useNavigate } from 'react-router-dom'
import { EvidenceBadge } from '../../ai'
import { KIcon } from '../../components/kiosk-icon'
import { ADVISOR_MANUAL_DETAILS, ADVISOR_MANUAL_ENTRIES } from './advisorScenes'
import { describeProviderLabel } from './advisorProvider'

/**
 * 一条消息的性质。混在一起会出人命的是 `ai` 与 `not-ai`：
 * 前者是模型真的答了，后者是**模型没答**、页面如实说明。
 */
export type AdvisorMessageKind =
  /** 用户自己说的话 */
  | 'user'
  /** 本机写死的欢迎语 / 场景说明 —— 是产品文案，不是模型产出，故不挂 E3 */
  | 'system'
  /** 真实大模型回答（providerLabel 带 `llm:` 前缀），唯一允许标 E3 的一类 */
  | 'ai'
  /** 后端回落到 mock provider：这一轮没有 AI 回答，正文不予展示 */
  | 'not-ai'
  /** 请求失败 */
  | 'error'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  kind: AdvisorMessageKind
  text: string
  actions?: AssistantAction[]
  /** 仅 `ai` / `not-ai` 携带，用于如实展示这轮回答的来源标识。 */
  providerLabel?: string
  /** 仅 `ai` 携带：这一轮返回里被路由白名单丢弃的动作条数（不展示它们的文案）。 */
  droppedActions?: number
}

/** 稿 05 的分区标题：编号 · 标题 · 右侧提示。编号由页面按实际渲染的分区依次给。 */
export function AdvisorSectionLabel({ no, title, hint, id }: { no: number; title: string; hint?: string; id?: string }) {
  return (
    <div className="assistant-sec-label">
      <span className="assistant-sec-no" aria-hidden="true">{String(no).padStart(2, '0')}</span>
      <h2 id={id} tabIndex={-1}>{title}</h2>
      {hint ? <span className="assistant-sec-hint">{hint}</span> : null}
    </div>
  )
}

export function AdvisorAvatar() {
  return (
    <span className="assistant-message-avatar" aria-hidden="true">
      <img src="/assets/ai-advisor.png" alt="" />
    </span>
  )
}

/**
 * 「请求在飞」指示器（稿 05 submitting 态的等待卡）。只在 AiTaskRegion 的 running 槽里挂载 ——
 * 没在算就不存在。只表达「在等」：无百分比、无阶段点、无预计时间（MOTION-SPEC M2）。
 */
export function AdvisorThinking() {
  return (
    <div className="assistant-thinking" role="status">
      <p className="assistant-thinking-bar">
        <span className="assistant-thinking-dots" data-ai-progress="true" aria-hidden="true"><i /><i /><i /></span>
        <span>正在等待服务返回 · 没有百分比、阶段和预计时间可显示</span>
      </p>
      <p className="assistant-thinking-slot">回答会出现在这一区。返回之前保持空白，不预演内容、不逐字打字。</p>
      <dl className="assistant-provenance">
        <div><dt>providerLabel</dt><dd>未取得</dd></div>
        <div><dt>aiGenerated</dt><dd>未取得</dd></div>
      </dl>
      <p className="assistant-gate-note">
        返回后先过双门禁：服务标识以 <code>llm:</code> 开头<b>且</b>标记为模型生成，才显示正文；否则如实说明、不展示。
      </p>
    </div>
  )
}

export function ChatBubble({ msg }: { msg: Message }) {
  const isAssistant = msg.role === 'assistant'

  return (
    <article
      className={`assistant-message assistant-message--${isAssistant ? 'assistant' : 'user'}`}
      data-message-role={msg.role}
      data-message-kind={msg.kind}
    >
      {isAssistant && <AdvisorAvatar />}

      {msg.kind === 'error' ? (
        <div className="assistant-message-bubble assistant-message-bubble--error" role="alert">
          <strong>请求失败，没有回答</strong>
          <p>{msg.text}</p>
        </div>
      ) : msg.kind === 'not-ai' ? (
        /*
         * 风险 R1 的落点。这里**没有**渲染 response.reply ——
         * 后端回落时那段预置话术根本不进 UI。用户看到的是「这轮没有 AI 回答」，
         * 不是一段读起来像 AI 的假回答加一行小字免责。
         */
        <div className="assistant-message-bubble assistant-message-bubble--not-ai" role="status">
          <strong>这一轮没有 AI 回答</strong>
          <p>{msg.text}</p>
          <dl className="assistant-provenance">
            <div><dt>providerLabel</dt><dd className="assistant-message-provider">服务标识：{describeProviderLabel(msg.providerLabel)}</dd></div>
            <div><dt>aiGenerated</dt><dd>否</dd></div>
          </dl>
          <span className="assistant-gate-note">同一轮返回里的建议动作也一并丢弃，不当作「AI 建议的下一步」。</span>
        </div>
      ) : (
        <div className="assistant-message-bubble">
          {msg.role === 'user' && <span className="assistant-message-who">你的问题</span>}
          {/* E3 只挂在真实模型回答上。产品文案（system）与用户消息都不挂。 */}
          {msg.kind === 'ai' && (
            <span className="assistant-message-evrow">
              <EvidenceBadge level="E3" />
            </span>
          )}
          <p>{msg.text}</p>
          {msg.kind === 'ai' && (
            <span className="assistant-message-provider">
              由真实模型生成 · 服务标识：{describeProviderLabel(msg.providerLabel)}
            </span>
          )}
        </div>
      )}
    </article>
  )
}

/**
 * AI 顾问答不了时仍然走得通的真实入口。
 *
 * 与 `AiTaskRegion` 的 `manual` 降级配套：原语只收一个 action，
 * 而本页的手动替代天然是四条并列的路，少列任何一条都会让用户以为
 * 「AI 挂了这台机器就没别的能办了」。所以四条全给，且都是真实注册路由。
 *
 * 稿 05 两种密度：`rail` 是平时的一排四格；`full` 是 AI 答不了时占主视野的 2×2，
 * 每格多列出目的页首屏确有的去处（ADVISOR_MANUAL_DETAILS），不编造能力。
 */
export function AdvisorManualEntries({ variant = 'full' }: { variant?: 'rail' | 'full' }) {
  const navigate = useNavigate()

  return (
    <nav className="assistant-manual-entries" data-variant={variant} aria-label="不依赖 AI 的功能入口">
      {ADVISOR_MANUAL_ENTRIES.map((entry) => {
        const details = variant === 'full' ? ADVISOR_MANUAL_DETAILS[entry.route] : []
        return (
          <button
            key={entry.route}
            type="button"
            className="assistant-manual-entry"
            onClick={() => navigate(entry.route)}
          >
            <span className="assistant-manual-top">
              <span className="assistant-manual-icon" aria-hidden="true"><KIcon name={entry.icon} /></span>
              <strong>{entry.label}</strong>
              <KIcon name="arrow" />
            </span>
            <small>{entry.hint}</small>
            {details.length > 0 && (
              <span className="assistant-manual-details">
                {details.map((detail) => <span key={detail}>{detail}</span>)}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
