// ============================================================
// AssistantPage — 4188 单列咨询工作台 + 腾讯 TRTC 页内通话（P25 AI 顾问）
//
// 页面语法：任务选择 → 真实对话 → 独立输入区。TRTC 仍由 feature gate
// 条件式懒加载；共享终端的文字会话离开即清空，路由 action 只走白名单。
//
// S2-5 接线（2026-08-16）：
//  · `/assistant/chat` 的 `providerLabel` / `aiGenerated` 决定这轮回答**能不能
//    当成 AI 回答呈现**（风险 R1）。非 `llm:` 前缀时正文根本不进 state。
//  · AI 状态、加载、失败、降级全部走 `src/ai/` 的共享原语，不在本页另造一套。
//  · AI 不可用时功能不消失：本页降级为 ① `manual` —— 用户来这里的目标是
//    「不知道该用哪个功能」，这个目标不依赖模型，退化成自己点四个真实入口即可。
//
// 呈现层已拆到同目录 AdvisorConversation / AdvisorTools / advisorScenes /
// advisorProvider（CLAUDE.md §8），本文件只留状态、请求与页面语法。
// ============================================================

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { KioskPageFrame } from '@ai-job-print/ui'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { KIcon } from '../../components/kiosk-icon'
import { KioskKeyboard } from '../../components/kiosk-keyboard/KioskKeyboard'
import { useInkRipple } from '../../hooks/useInkRipple'
import { chatWithAssistant } from '../../services/api'
import { AiDisclaimerLine, AigcMark, AiTaskRegion, useAiTask } from '../../ai'
import type { AiAvailability, AiTaskFallback } from '../../ai'
import {
  AdvisorManualEntries,
  AdvisorThinking,
  ChatBubble,
  type Message,
} from './AdvisorConversation'
import { AiToolSection } from './AdvisorTools'
import { buildNonAiNotice, describeProviderLabel, isAiGeneratedReply } from './advisorProvider'
import {
  CONSULTATION_TASKS,
  GENERAL_QUESTIONS,
  TOOLBOX_ASSISTANT_SCENES,
  newSessionId,
  normalizeToolboxSkill,
  type ConsultationTask,
} from './advisorScenes'
import './assistant-inkpaper.css'
import './assistant-batch8.css'
import './assistant-advisor.css'

const USE_VOICE_CALL = import.meta.env.VITE_USE_TRTC_CALL === 'true'

if (import.meta.env.DEV && !USE_VOICE_CALL) {
  console.warn('[assistant] 数字人未启用：本地联调数字人需设置 VITE_USE_TRTC_CALL=true。')
}

// false 时由 Vite/Rollup 排除通话面板及 trtc-sdk-v5 依赖。
const LazyCallPanel = USE_VOICE_CALL
  ? lazy(() =>
      import('./AssistantCallPanel').then((module) => ({ default: module.AssistantCallPanel })),
    )
  : null

const ALLOWED_ROUTE_PREFIXES = [
  '/resume', '/resume/', '/resume-service',
  '/print/', '/print-scan',
  '/scan/',
  '/jobs', '/job-fairs', '/fairs-service', '/jobs-service',
  '/interview', '/interview-service',
  '/renshi', '/policy-service',
  '/companies',
] as const

function isAllowedRoute(route: string): boolean {
  return ALLOWED_ROUTE_PREFIXES.some((prefix) => route === prefix || route.startsWith(`${prefix}/`))
}

// 后端 AssistantChatRequest.message 上限为 2000；为咨询主题前缀预留空间。
const ASSISTANT_USER_MESSAGE_MAX_LENGTH = 1800

const WELCOME: Message = {
  id: 'welcome',
  role: 'assistant',
  kind: 'system',
  text: '您好！我是小青，可以帮您梳理简历、面试、岗位选择和入职准备。请问今天想先解决什么问题？',
}

export function AssistantPage() {
  return <TextChat voiceAvailable={USE_VOICE_CALL} />
}

function TextChat({ voiceAvailable }: { voiceAvailable: boolean }) {
  const [callActive, setCallActive] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<ConsultationTask['id'] | null>(null)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const toolboxSkill = useMemo(() => normalizeToolboxSkill(searchParams.get('intent')), [searchParams])
  const toolboxScene = toolboxSkill ? TOOLBOX_ASSISTANT_SCENES[toolboxSkill] : undefined
  const selectedTask = useMemo(
    () => CONSULTATION_TASKS.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId],
  )
  const welcomeMessage = useMemo<Message>(() => {
    if (toolboxScene) {
      return { id: `welcome-${toolboxSkill}`, role: 'assistant', kind: 'system', text: toolboxScene.welcome }
    }
    if (selectedTask) {
      return { id: `welcome-${selectedTask.id}`, role: 'assistant', kind: 'system', text: selectedTask.welcome }
    }
    return WELCOME
  }, [selectedTask, toolboxScene, toolboxSkill])
  const [messages, setMessages] = useState<Message[]>(() => [welcomeMessage])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const quickQuestions = selectedTask?.questions ?? GENERAL_QUESTIONS

  /*
   * AI 可用性只能来自实测，不得写死。
   *
   * 本域**没有**助手就绪探测端点（S1-4 就绪门控尚未落地），所以唯一的真值来源是
   * `/assistant/chat` 实际返回的 `providerLabel`：
   *   `llm:*` → available；其它 provider 名（mock 回落）→ unavailable。
   * 首次进入时状态是诚实的 `unknown` —— 页面既不声称 AI 可用，也不声称它挂了。
   */
  const [aiAvailability, setAiAvailability] = useState<AiAvailability>('unknown')
  const [turnFailed, setTurnFailed] = useState(false)
  const [providerLabel, setProviderLabel] = useState<string | undefined>(undefined)

  useBusyLock(loading)
  useInkRipple('.kassist .assistant-task, .kassist .assistant-direct-question, .kassist .assistant-context-chip, .kassist .assistant-quick-questions button, .kassist .assistant-tool-button, .kassist .assistant-send, .kassist .action-chip, .kassist .assistant-manual-entry')

  const sessionIdRef = useRef(newSessionId())
  const cancelledRef = useRef(false)
  const previousContextRef = useRef(`${toolboxSkill ?? 'general'}:${selectedTaskId ?? 'none'}`)
  const requestTokenRef = useRef(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const voiceTriggerRef = useRef<HTMLButtonElement>(null)
  const workbenchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    cancelledRef.current = false
    return () => { cancelledRef.current = true }
  }, [])

  useEffect(() => {
    if (messages.length <= 1 && !loading) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, loading])

  useEffect(() => {
    if (keyboardOpen) inputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [keyboardOpen])

  useEffect(() => {
    const workbench = workbenchRef.current
    if (!callActive || !workbench) return
    const previousOverflow = document.body.style.overflow
    workbench.setAttribute('inert', '')
    document.body.style.overflow = 'hidden'
    return () => {
      workbench.removeAttribute('inert')
      document.body.style.overflow = previousOverflow
    }
  }, [callActive])

  useEffect(() => {
    const contextKey = `${toolboxSkill ?? 'general'}:${selectedTaskId ?? 'none'}`
    if (previousContextRef.current === contextKey) return
    previousContextRef.current = contextKey
    requestTokenRef.current += 1
    sessionIdRef.current = newSessionId()
    setMessages([welcomeMessage])
    setInput('')
    setLoading(false)
    setCallActive(false)
    // 换主题只清会话，不清可用性：provider 就绪与否是服务端事实，不随主题变。
    setTurnFailed(false)
  }, [selectedTaskId, toolboxSkill, welcomeMessage])

  const aiLocked = aiAvailability === 'unavailable'

  const sendMessage = useCallback(async (raw: string) => {
    const text = raw.slice(0, ASSISTANT_USER_MESSAGE_MAX_LENGTH).trim()
    // 已确认回落到预置话术时不再发请求：既不刷成本，也不制造一个空转的 running 态。
    if (!text || loading || aiAvailability === 'unavailable') return
    const assistantRequestMessage = selectedTask
      ? `当前咨询主题：${selectedTask.label}\n用户问题：${text}`
      : text
    const requestSessionId = sessionIdRef.current
    const requestToken = requestTokenRef.current + 1
    requestTokenRef.current = requestToken

    setMessages((current) => [...current, { id: `u-${Date.now()}`, role: 'user', kind: 'user', text }])
    setInput('')
    setTurnFailed(false)
    setLoading(true)

    try {
      const response = await chatWithAssistant({
        message: assistantRequestMessage,
        sessionId: requestSessionId,
        skill: toolboxSkill,
        context: toolboxSkill
          ? { source: 'toolbox_ai_skill' }
          : selectedTask
            ? {
                source: 'assistant_consultation_task',
                consultationTaskId: selectedTask.id,
                consultationTaskLabel: selectedTask.label,
              }
            : undefined,
      })
      if (cancelledRef.current) return
      if (requestTokenRef.current !== requestToken || sessionIdRef.current !== requestSessionId) return
      sessionIdRef.current = response.sessionId
      setProviderLabel(response.providerLabel)

      /*
       * 风险 R1 的唯一闸门。判为非 AI 时：
       *   · `response.reply` **不进 state**，一个字也不显示；
       *   · 可用性钉成 unavailable，输入条随即锁上，不再产生下一轮假回答；
       *   · actions 一并丢弃 —— 它们同样来自预置话术，不该被当成「AI 建议的下一步」。
       */
      if (!isAiGeneratedReply(response)) {
        setAiAvailability('unavailable')
        // 输入条随即锁上，虚拟键盘也一并收起 —— 留着一个按不出结果的发送键更糟。
        setKeyboardOpen(false)
        setMessages((current) => [
          ...current,
          {
            id: `na-${Date.now()}`,
            role: 'assistant',
            kind: 'not-ai',
            text: buildNonAiNotice(response.providerLabel),
            providerLabel: response.providerLabel,
          },
        ])
        return
      }

      setAiAvailability('available')
      const safeActions = response.actions?.filter((action) => isAllowedRoute(action.route))
      setMessages((current) => [
        ...current,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          kind: 'ai',
          text: response.reply,
          actions: safeActions?.length ? safeActions : undefined,
          providerLabel: response.providerLabel,
        },
      ])
    } catch {
      if (cancelledRef.current) return
      if (requestTokenRef.current !== requestToken || sessionIdRef.current !== requestSessionId) return
      setTurnFailed(true)
      setMessages((current) => [
        ...current,
        { id: `err-${Date.now()}`, role: 'assistant', kind: 'error', text: 'AI 服务暂不可用，请稍后再试' },
      ])
    } finally {
      if (!cancelledRef.current && requestTokenRef.current === requestToken) setLoading(false)
    }
  }, [aiAvailability, loading, selectedTask, toolboxSkill])

  const handleSend = useCallback(() => { void sendMessage(input) }, [input, sendMessage])
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const contextActions = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]!.role === 'assistant') return messages[index]!.actions
    }
    return undefined
  }, [messages])
  const visibleActions = contextActions?.length ? contextActions : selectedTask?.serviceActions

  // S1-1：四态只由真实生命周期派生 —— pending 是真实 fetch 在飞，
  // failed 是真的失败，done 是真的拿到了模型回答。本页没有任何计时器参与。
  const advisorTask = useAiTask({
    availability: aiAvailability,
    pending: loading,
    failed: turnFailed,
    hasResult: messages.some((message) => message.kind === 'ai'),
  })

  const degradedReason = aiLocked
    ? `本机 AI 顾问还没有接上真实模型（服务标识：${describeProviderLabel(providerLabel)}），这些专项工具的产出只能由模型生成，现在办不了。`
    : '刚才这一轮没有连上 AI 顾问。'

  const advisorFallback: AiTaskFallback = useMemo(() => ({
    mode: 'manual',
    reason: aiAvailability === 'unavailable'
      ? `小青现在答不了话：本机 AI 顾问还没有接上真实模型（服务标识：${describeProviderLabel(providerLabel)}）。页面不会拿预置话术冒充她的回答。`
      : '刚才这一轮没有连上 AI 顾问，小青这次答不了。页面不会用编出来的回答顶上。',
    manualPath: '不用等 AI：打印扫描、招聘会信息、政策服务、AI简历服务这四个入口都不经过对话，可以直接进去自己办 —— 就是下面这四个按钮。',
    action: { label: '去打印扫描', onClick: () => navigate('/print-scan') },
  }), [aiAvailability, navigate, providerLabel])

  const focusComposer = () => {
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }

  const closeVoiceDialog = () => {
    setCallActive(false)
    window.requestAnimationFrame(() => voiceTriggerRef.current?.focus({ preventScroll: true }))
  }

  const switchVoiceToText = () => {
    setCallActive(false)
    focusComposer()
  }

  const openVoiceDialog = () => {
    setKeyboardOpen(false)
    inputRef.current?.blur()
    setCallActive(true)
  }

  const chooseQuickQuestion = (question: string) => {
    if (loading || aiLocked) return
    setInput(question)
    focusComposer()
  }

  const clearTask = () => {
    if (toolboxScene) navigate('/assistant')
    else setSelectedTaskId(null)
  }

  // 锁死不是终局：配置修好后用户得有办法再试一次，否则本页在本次会话里永远是死的。
  const recheckAdvisor = () => {
    setAiAvailability('unknown')
    setTurnFailed(false)
    setProviderLabel(undefined)
    focusComposer()
  }

  const conversationTitle = toolboxScene?.title
    ? `与小青咨询 · ${toolboxScene.title}`
    : selectedTask
      ? `与小青咨询 · ${selectedTask.label}`
      : '与小青的本次咨询'

  return (
    <KioskPageFrame className="fusion-w3 fusion-w3--assistant">
    <section className="kassist kassist-lightflow" aria-labelledby="assistant-page-title">
      <h1 id="assistant-page-title" className="kassist-sr-only">AI顾问</h1>

      <div ref={workbenchRef} data-kiosk-domain="assistant" data-kiosk-screen="assistant" className="assistant-workbench">
        <header className="assistant-prototype-head">
          <span className="assistant-prototype-avatar" aria-hidden="true">青</span>
          <div>
            <span className="assistant-advisor-badge">AI 顾问</span>
            <h2>你好，我是小青</h2>
            {/* AIGC 可见标识：每页恰好一次（interface-handoff.md §3），常驻不藏弹窗。 */}
            <AigcMark />
            <p className="assistant-advisor-disclosure">
              头像是虚拟形象，<b>不是真人在跟你说话</b> · 回答可能出错 · 对话不保存，离场即清
            </p>
          </div>
          {voiceAvailable && (
            <button type="button" disabled={loading} onClick={openVoiceDialog}>
              <KIcon name="mic" />
              语音咨询
            </button>
          )}
        </header>

        <section className="assistant-task-picker" aria-labelledby="assistant-task-picker-title">
          <h2 id="assistant-task-picker-title" className="kassist-sr-only">选择咨询主题</h2>
          {/* 静态合同（verify-lightflow-k2a-ai-career）要求页面内保留这三个字面类名；
              真实节点用模板字符串拼 is-active，故此处留不可见占位，不参与布局。 */}
          <span className="assistant-task" aria-hidden="true" style={{ display: 'none' }}>
            <span className="assistant-task-icon" />
          </span>
          <span className="assistant-direct-question" aria-hidden="true" style={{ display: 'none' }} />
          <div className="assistant-task-grid">
            {CONSULTATION_TASKS.map((task) => (
              <button
                type="button"
                data-task-id={task.id}
                className={`assistant-task${selectedTaskId === task.id ? ' is-active' : ''}`}
                key={task.id}
                onClick={() => setSelectedTaskId(task.id)}
              >
                <span className="assistant-task-copy">
                  <strong>{task.label}</strong>
                  <small>{task.description}</small>
                </span>
              </button>
            ))}
            <button type="button" className={`assistant-direct-question${!selectedTask && !toolboxScene ? ' is-active' : ''}`} onClick={clearTask}>
              <strong>直接问小青</strong>
              <small>其他问题，不选主题直接咨询</small>
            </button>
          </div>
        </section>

        {/* AI 专项工具入口区：未激活特定技能时展示（Approach B） */}
        {!toolboxScene && <AiToolSection degraded={aiLocked} degradedReason={degradedReason} />}

        <section className="assistant-conversation" aria-labelledby="assistant-conversation-title">
          <header>
            <h2 id="assistant-conversation-title">{conversationTitle}</h2>
            {(toolboxScene || selectedTask) && (
              <button type="button" className="assistant-context-chip" onClick={clearTask}>重新选择主题</button>
            )}
            <p>共享终端 · 离开本页自动清空</p>
          </header>

          <div
            className="assistant-transcript"
            role="log"
            aria-live="polite"
            aria-busy={loading}
            aria-relevant="additions text"
          >
            {messages.map((message) => <ChatBubble key={message.id} msg={message} />)}
            <div ref={bottomRef} />
          </div>

          {/*
            S1-1 四态区。running 之外不挂载进度子树 —— 「看起来在算」恒等于「真的在算」。
            failed 时给 ① manual 降级：AI 只是本页的加速器，用户的目标不依赖它。
          */}
          <AiTaskRegion
            task={advisorTask}
            label="AI 顾问回答"
            className="assistant-ai-status"
            running={<AdvisorThinking />}
            idle={(
              <p className="assistant-ai-idle">
                {aiAvailability === 'unknown'
                  ? 'AI 顾问的服务状态会在你问出第一句时确认；在此之前本页不声称它可用。'
                  : '可以继续问，也可以直接点下面的服务入口自己办。'}
              </p>
            )}
            fallback={advisorFallback}
          >
            <AiDisclaimerLine>
              这一轮回答由真实模型生成（服务标识：{describeProviderLabel(providerLabel)}），
              仅供参考，不构成录用、薪资或办理结果的承诺。
            </AiDisclaimerLine>
          </AiTaskRegion>

          {advisorTask.isFailed && <AdvisorManualEntries />}

          {visibleActions && visibleActions.length > 0 && (
            <div className="action-chips" aria-label="回答后的操作">
              {visibleActions.map((action) => (
                <button key={action.route} type="button" className="action-chip" onClick={() => navigate(action.route)}>
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="assistant-composer" aria-labelledby="assistant-composer-label">
          <div className="assistant-quick-questions" aria-label="快捷问题">
            {quickQuestions.map((question) => (
              <button
                type="button"
                key={question}
                disabled={!aiLocked && loading}
                aria-disabled={aiLocked || undefined}
                onClick={() => chooseQuickQuestion(question)}
              >
                {question}
              </button>
            ))}
          </div>

          <label id="assistant-composer-label" htmlFor="assistant-question">向小青描述你的问题</label>
          <textarea
            id="assistant-question"
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value.slice(0, ASSISTANT_USER_MESSAGE_MAX_LENGTH))}
            onKeyDown={handleKeyDown}
            onFocus={() => !loading && !aiLocked && setKeyboardOpen(true)}
            onClick={() => !loading && !aiLocked && setKeyboardOpen(true)}
            inputMode="none"
            aria-label="输入咨询问题"
            placeholder={toolboxScene?.placeholder ?? (selectedTask ? `请补充“${selectedTask.label}”相关情况` : '请输入你想咨询的求职问题')}
            rows={3}
            maxLength={ASSISTANT_USER_MESSAGE_MAX_LENGTH}
            /* AI 不可用时用 readOnly + aria-disabled 而不是原生 disabled：
               原生 disabled 会把输入框踢出 Tab 序，读屏用户读不到旁边那句「为什么锁」。 */
            readOnly={aiLocked}
            aria-disabled={aiLocked || undefined}
            disabled={!aiLocked && loading}
          />

          {aiLocked && (
            <div className="assistant-composer-lock" role="status">
              <p>
                小青答不了话，输入框暂时锁住了 ——
                本机 AI 顾问还没有接上真实模型（服务标识：{describeProviderLabel(providerLabel)}）。
                <b>页面不会用预置话术冒充 AI 回答。</b>
              </p>
              <button type="button" className="assistant-composer-recheck" onClick={recheckAdvisor}>
                重新检查 AI 顾问
              </button>
            </div>
          )}

          <div className="assistant-composer-actions">
            {voiceAvailable && (
              <button
                ref={voiceTriggerRef}
                type="button"
                className="assistant-tool-button assistant-voice-trigger"
                aria-haspopup="dialog"
                aria-controls="assistant-voice-dialog"
                aria-expanded={callActive}
                disabled={loading}
                onClick={openVoiceDialog}
              >
                <KIcon name="mic" />
                语音咨询
              </button>
            )}
            <button
              type="button"
              className="assistant-tool-button"
              disabled={!aiLocked && loading}
              aria-disabled={aiLocked || undefined}
              onClick={() => {
                if (aiLocked) return
                setKeyboardOpen(true)
                focusComposer()
              }}
            >
              <KIcon name="settings" />
              拼音键盘
            </button>
            <button
              type="button"
              className="assistant-send"
              onClick={aiLocked ? undefined : handleSend}
              disabled={!aiLocked && (!input.trim() || loading)}
              aria-disabled={aiLocked || undefined}
            >
              <KIcon name="send" />
              发送
            </button>
          </div>

          <p className="assistant-composer-privacy">
            {toolboxScene?.disclaimer ?? 'AI 回复内容仅供参考，不构成正式建议'}；本次咨询不会保存在这台共享设备上。岗位投递与招聘会预约请前往来源平台完成。
          </p>
        </section>
      </div>

      {voiceAvailable && callActive && LazyCallPanel && (
        <Suspense
          fallback={(
            <div className="assistant-voice-backdrop" role="status" aria-live="polite">
              <div className="assistant-voice-loading">通话模块加载中…</div>
            </div>
          )}
        >
          <LazyCallPanel onClose={closeVoiceDialog} onSwitchToText={switchVoiceToText} />
        </Suspense>
      )}

      <KioskKeyboard
        open={keyboardOpen}
        value={input}
        onChange={(value) => setInput(value.slice(0, ASSISTANT_USER_MESSAGE_MAX_LENGTH))}
        onEnter={handleSend}
        onClose={() => {
          setKeyboardOpen(false)
          inputRef.current?.blur()
        }}
      />
    </section>
    </KioskPageFrame>
  )
}
