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
import { ADVISOR_MANUAL_ENTRIES } from './advisorScenes'
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
}

export function AdvisorAvatar() {
  return (
    <span className="assistant-message-avatar" aria-hidden="true">
      <img src="/assets/ai-advisor.png" alt="" />
    </span>
  )
}

/** 「正在整理建议」指示器。只在 AiTaskRegion 的 running 槽里挂载 —— 没在算就不存在。 */
export function AdvisorThinking() {
  return (
    <div className="assistant-thinking" role="status">
      <AdvisorAvatar />
      <span>小青正在整理建议…</span>
      <span className="assistant-thinking-dots" data-ai-progress="true" aria-hidden="true"><i /><i /><i /></span>
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
          <strong>暂时无法连接</strong>
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
          <span className="assistant-message-provider">
            服务标识：{describeProviderLabel(msg.providerLabel)}
          </span>
        </div>
      ) : (
        <div className="assistant-message-bubble">
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
 */
export function AdvisorManualEntries() {
  const navigate = useNavigate()

  return (
    <nav className="assistant-manual-entries" aria-label="不依赖 AI 的功能入口">
      {ADVISOR_MANUAL_ENTRIES.map((entry) => (
        <button
          key={entry.route}
          type="button"
          className="assistant-manual-entry"
          onClick={() => navigate(entry.route)}
        >
          <strong>{entry.label}</strong>
          <small>{entry.hint}</small>
        </button>
      ))}
    </nav>
  )
}
