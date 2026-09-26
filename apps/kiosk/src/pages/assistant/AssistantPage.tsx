// ============================================================
// AssistantPage — 稿 05-ai-cockpit（AI 驾驶舱）+ 腾讯 TRTC 页内通话（P25 AI 顾问）
//
// 页面语法（2026-09-25 按稿 05 重排）：深色舱面（标题 · 读数 · 能力仪表带）→
// 编号分区主体（任务选择 → 真实对话 → 可去的地方 → 不经过 AI 也能办）→ 输入坞 → 边界说明。
// 稿里的 12 态在这里**只由真实信号推出**（deriveCockpitState），不接受 URL 指定。
// TRTC 仍由 feature gate 条件式懒加载；共享终端的文字会话离开即清空，路由 action 只走白名单。
//
// S2-5 接线（2026-08-16）：
//  · `/assistant/chat` 的 `providerLabel` / `aiGenerated` 决定这轮回答**能不能
//    当成 AI 回答呈现**（风险 R1）。非 `llm:` 前缀时正文根本不进 state。
//  · AI 状态、加载、失败、降级全部走 `src/ai/` 的共享原语，不在本页另造一套。
//  · AI 不可用时功能不消失：本页降级为 ① `manual` —— 用户来这里的目标是
//    「不知道该用哪个功能」，这个目标不依赖模型，退化成自己点四个真实入口即可。
//
// 呈现层已拆到同目录 AdvisorCockpit / AdvisorConversation / AdvisorTools / advisorScenes /
// advisorProvider（CLAUDE.md §8），本文件只留状态、请求与页面语法。
// ============================================================

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { HomeIcon, KeyboardIcon, SparklesIcon, UserIcon } from 'lucide-react'
import { AI_LABEL_COPY } from '@ai-job-print/shared'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { KIcon } from '../../components/kiosk-icon'
import { KioskKeyboard } from '../../components/kiosk-keyboard/KioskKeyboard'
import { useInkRipple } from '../../hooks/useInkRipple'
import { chatWithAssistant } from '../../services/api'
import { useAuth } from '../../auth/useAuth'
import { AiDisclaimerLine, AiTaskRegion, useAiTask } from '../../ai'
import { AssistantHoldToTalk } from './AssistantHoldToTalk'
import { AssistantSessionSummaryBar } from './AssistantSessionSummaryBar'
import type { AiAvailability, AiTaskFallback } from '../../ai'
import { AdvisorCockpit } from './AdvisorCockpit'
import {
  AdvisorManualEntries,
  AdvisorSectionLabel,
  AdvisorThinking,
  ChatBubble,
  type Message,
} from './AdvisorConversation'
import { AiToolSection } from './AdvisorTools'
import { buildNonAiNotice, describeProviderLabel, isAiGeneratedReply } from './advisorProvider'
import {
  COCKPIT_COPY,
  CONSULTATION_TASKS,
  GENERAL_QUESTIONS,
  TOOLBOX_ASSISTANT_SCENES,
  deriveCockpitState,
  newSessionId,
  normalizeToolboxSkill,
  type CockpitVoiceState,
  type ConsultationTask,
} from './advisorScenes'
import { isRecruitmentRoute, useRecruitmentHosting } from '../../hooks/useRecruitmentHosting'
import './assistant-inkpaper.css'
import './assistant-batch8.css'
import './assistant-advisor.css'
import './assistant-cockpit.css'
import './assistant-cockpit-body.css'

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
  '/resume', '/resume-service',
  '/print', '/print-scan',
  '/scan',
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
  const [voiceState, setVoiceState] = useState<CockpitVoiceState | null>(null)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [selectedTaskId, setSelectedTaskId] = useState<ConsultationTask['id'] | null>(null)
  const [sendVoiceDirect, setSendVoiceDirect] = useState(false)
  const { isLoggedIn, getToken } = useAuth()
  const hostingOpen = useRecruitmentHosting().enabled // 3.13 托管关闭时不渲染岗位 / 招聘会 / 企业类入口
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
  useInkRipple('.kassist .assistant-task, .kassist .assistant-direct-question, .kassist .assistant-context-chip, .kassist .assistant-quick-questions button, .kassist .assistant-tool-button, .kassist .assistant-send, .kassist .action-chip, .kassist .assistant-manual-entry, .kassist .assistant-hold-talk-btn, .kassist .assistant-summary-save, .kassist .assistant-turn-action')

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

  // 软键盘避让：虚拟键盘固定在舞台底部、会盖住输入坞。量它的真实高度（offsetHeight 不受舞台缩放影响），
  // 由 CSS 把整屏内容压到键盘上沿以上。收起即恢复，舱面与分区一项不删。
  useEffect(() => {
    if (!keyboardOpen) {
      setKeyboardHeight(0)
      return
    }
    // 键盘与工作台同在 .kassist 之下（工作台在语音态会被 inert，键盘不能放进去）。
    const keyboard = workbenchRef.current?.parentElement?.querySelector<HTMLElement>('.kkb')
    if (!keyboard) return
    const measure = () => setKeyboardHeight(keyboard.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(keyboard)
    return () => observer.disconnect()
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
    setVoiceState(null)
    // 换主题只清会话，不清可用性：provider 就绪与否是服务端事实，不随主题变。
    setTurnFailed(false)
  }, [selectedTaskId, toolboxSkill, welcomeMessage])

  const aiLocked = aiAvailability === 'unavailable'

  const sendMessage = useCallback(async (raw: string, options?: { resend?: boolean }) => {
    const text = raw.slice(0, ASSISTANT_USER_MESSAGE_MAX_LENGTH).trim()
    // 已确认回落到预置话术时不再发请求：既不刷成本，也不制造一个空转的 running 态。
    if (!text || loading || aiAvailability === 'unavailable') return
    const assistantRequestMessage = selectedTask
      ? `当前咨询主题：${selectedTask.label}\n用户问题：${text}`
      : text
    const requestSessionId = sessionIdRef.current
    const requestToken = requestTokenRef.current + 1
    requestTokenRef.current = requestToken

    // 重试同一轮：不重复写一条「你的问题」，只把上一轮的失败说明撤下，再真实地发一次。
    setMessages((current) => (options?.resend
      ? current.filter((message, index) => !(index === current.length - 1 && message.kind === 'error'))
      : [...current, { id: `u-${Date.now()}`, role: 'user', kind: 'user', text }]))
    if (!options?.resend) setInput('')
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
      }, getToken())
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
          droppedActions: (response.actions?.length ?? 0) - (safeActions?.length ?? 0),
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
  }, [aiAvailability, getToken, loading, selectedTask, toolboxSkill])

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
  const goActions = hostingOpen ? visibleActions : visibleActions?.filter((action) => !isRecruitmentRoute(action.route))

  // S1-1：四态只由真实生命周期派生 —— pending 是真实 fetch 在飞，
  // failed 是真的失败，done 是真的拿到了模型回答。本页没有任何计时器参与。
  const advisorTask = useAiTask({
    availability: aiAvailability,
    pending: loading,
    failed: turnFailed,
    hasResult: messages.some((message) => message.kind === 'ai'),
  })

  const lastMessage = messages[messages.length - 1]
  const lastTurn = lastMessage?.role === 'assistant'
    && (lastMessage.kind === 'ai' || lastMessage.kind === 'not-ai' || lastMessage.kind === 'error')
    ? lastMessage.kind
    : null
  const lastUserText = [...messages].reverse().find((message) => message.role === 'user')?.text
  const hasUserTurn = lastUserText !== undefined
  const cockpitState = deriveCockpitState({
    voice: callActive ? voiceState ?? 'voice-gate' : null,
    loading,
    lastTurn,
    availability: aiAvailability,
    hasDraft: input.trim().length > 0,
  })
  const cockpitCopy = COCKPIT_COPY[cockpitState]
  const lastDropped = lastMessage?.kind === 'ai' ? lastMessage.droppedActions ?? 0 : 0

  const degradedReason = aiLocked
    ? `模型未接入（服务标识：${describeProviderLabel(providerLabel)}）：这些专项的产出只能由模型生成，暂停使用。`
    : '刚才这一轮没有连上 AI 顾问。'

  const advisorFallback: AiTaskFallback = useMemo(() => ({
    mode: 'manual',
    reason: aiAvailability === 'unavailable'
      ? `本机 AI 顾问还没有接上真实模型（服务标识：${describeProviderLabel(providerLabel)}），这一轮和之后的提问都不会有 AI 回答。`
      : '刚才这一轮没有连上 AI 顾问，这次没有回答。页面不会用编出来的回答顶上。',
    manualPath: `不用等 AI：打印扫描、${hostingOpen ? '招聘会信息' : '帮助中心'}、政策服务、AI简历服务这四个入口都不经过对话，可以直接进去自己办 —— 就是下面这四个按钮。`,
    action: { label: '去打印扫描', onClick: () => navigate('/print-scan') },
  }), [aiAvailability, hostingOpen, navigate, providerLabel])

  const focusComposer = () => {
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }

  const focusSection = () => {
    window.requestAnimationFrame(() => {
      const heading = workbenchRef.current?.querySelector<HTMLElement>('.assistant-cockpit-body h2')
      heading?.scrollIntoView({ block: 'start' })
      heading?.focus({ preventScroll: true })
    })
  }

  const closeVoiceDialog = () => {
    setCallActive(false)
    setVoiceState(null)
    window.requestAnimationFrame(() => voiceTriggerRef.current?.focus({ preventScroll: true }))
  }

  const switchVoiceToText = () => {
    setCallActive(false)
    setVoiceState(null)
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

  // 换个问题 / 回到提问：丢掉本机这段对话，换一个全新会话号（共享终端不留给下一句）。
  const resetConversation = () => {
    requestTokenRef.current += 1
    sessionIdRef.current = newSessionId()
    setMessages([welcomeMessage])
    setLoading(false)
    setTurnFailed(false)
    focusSection()
  }

  const retryLastTurn = () => {
    if (lastUserText) void sendMessage(lastUserText, { resend: true })
  }

  // 锁死不是终局：配置修好后用户得有办法再试一次，否则本页在本次会话里永远是死的。
  const recheckAdvisor = () => {
    setAiAvailability('unknown')
    setTurnFailed(false)
    setProviderLabel(undefined)
    resetConversation()
    focusComposer()
  }

  const contextLabel = toolboxScene?.title ?? selectedTask?.label
  // 主体分区按实际渲染依次编号（稿 05 的 01 / 02 / 03）。
  let sectionNo = 0
  const nextNo = () => { sectionNo += 1; return sectionNo }
  const showPicker = !hasUserTurn && cockpitState !== 'ai-unavailable'
  const showConversation = hasUserTurn || Boolean(toolboxScene || selectedTask) || advisorTask.isFailed
  const draftLength = input.trim().length

  return (
    /* 稿 05-ai-cockpit：青序顶栏 + 底部主导航，页面名与导航项为「AI 顾问」（稿内「问小青」称呼已下线，小青只留在对话里）；状态胶囊只报真实信号推出的 12 态之一，未问过即「待本轮返回确认」。 */
    <QxPageFrame
      back={{ label: '返回首页', onBack: () => navigate('/') }}
      title="AI 顾问"
      subtitle="求职咨询 · 简历建议 · 打印帮助 · 政策问答"
      terminalLabel="就业服务大厅"
      status={cockpitCopy.pill}
      navbar={
        <>
          <button type="button" className="qx-nav-item" onClick={() => navigate('/')}><HomeIcon size={32} aria-hidden />首页</button>
          <button type="button" className="qx-nav-item" aria-current="page"><SparklesIcon size={32} aria-hidden />AI 顾问</button>
          <button type="button" className="qx-nav-item" onClick={() => navigate('/profile')}><UserIcon size={32} aria-hidden />我的</button>
        </>
      }
    >
    {/* 页面唯一 h1 由 QxPageFrame 的「AI 顾问」承担（稿 05 页面名）；这里只给区域一个可访问名称。 */}
    <section className="kassist kassist-lightflow" aria-label="AI 顾问咨询工作台">
      <div
        ref={workbenchRef}
        data-kiosk-domain="assistant"
        data-kiosk-screen="assistant"
        className="assistant-workbench"
        data-cockpit-state={cockpitState}
        data-kb-open={keyboardHeight > 0 || undefined}
        style={keyboardHeight > 0 ? ({ '--kassist-kb-h': `${keyboardHeight}px` } as CSSProperties) : undefined}
      >
        <AdvisorCockpit state={cockpitState} contextLabel={contextLabel} readingSignals={{
          loading, lastTurn, providerLabel, aiLocked, voiceAvailable, cockpitState,
        }}>
          <AiToolSection
            degraded={aiLocked}
            degradedReason={degradedReason}
            availability={aiAvailability}
            activeSkill={toolboxSkill}
          />
        </AdvisorCockpit>

        <div
          className="assistant-cockpit-body"
          data-screen="ai-cockpit"
          data-state={cockpitState}
          data-testid={`ai-cockpit-state-${cockpitState}`}
        >
          {showPicker && (
            <section className="assistant-task-picker" aria-labelledby="assistant-task-picker-title">
              <AdvisorSectionLabel
                no={nextNo()}
                id="assistant-task-picker-title"
                title={cockpitCopy.section[0]}
                hint={toolboxScene ? `专项 · ${toolboxScene.title}` : cockpitCopy.section[1]}
              />
              <div className="assistant-task-grid" role="group" aria-label="咨询主题">
                {CONSULTATION_TASKS.map((task) => (
                  <button
                    type="button"
                    data-task-id={task.id}
                    className="assistant-task"
                    aria-pressed={selectedTaskId === task.id}
                    key={task.id}
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <span className="assistant-task-icon" aria-hidden="true"><KIcon name={task.icon} /></span>
                    <span className="assistant-task-copy">
                      <strong>{task.label}</strong>
                      <small>{task.description}</small>
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className="assistant-direct-question"
                  aria-pressed={!selectedTask && !toolboxScene}
                  onClick={clearTask}
                >
                  <strong>直接提问</strong>
                  <small>不选主题</small>
                </button>
              </div>

              {cockpitState === 'composer' ? (
                <div className="assistant-draft-card" data-testid="cockpit-draft">
                  <p className="assistant-draft-head"><KIcon name="chat" />将要发送的内容 · {draftLength} / {ASSISTANT_USER_MESSAGE_MAX_LENGTH} 字</p>
                  <p className="assistant-draft-text">{input.trim()}</p>
                  <p className="assistant-draft-note">草稿只留在本页，离开即清；地址栏不会带上你输入的内容。点下面的问题会替换它。</p>
                </div>
              ) : null}

              <div className="assistant-quick-questions" aria-label="快捷问题">
                {quickQuestions.map((question) => (
                  <button
                    type="button"
                    key={question}
                    disabled={!aiLocked && loading}
                    aria-disabled={aiLocked || undefined}
                    onClick={() => chooseQuickQuestion(question)}
                  >
                    <span className="assistant-quick-icon" aria-hidden="true"><KIcon name="help" /></span>
                    <span className="assistant-quick-text">{question}</span>
                    <span className="assistant-quick-go" aria-hidden="true">{cockpitState === 'composer' ? '替换输入框' : '填入输入框'}<KIcon name="arrow" /></span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {showConversation && (
            <section className="assistant-conversation" aria-labelledby="assistant-conversation-title">
              <AdvisorSectionLabel
                no={nextNo()}
                id="assistant-conversation-title"
                title={hasUserTurn || cockpitState === 'ai-unavailable' ? cockpitCopy.section[0] : '开场说明'}
                hint={hasUserTurn || cockpitState === 'ai-unavailable' ? cockpitCopy.section[1] : '共享终端 · 离开本页自动清空'}
              />
              {(toolboxScene || selectedTask) && (
                <div className="assistant-context-row">
                  <span className="assistant-context-tag">{toolboxScene ? `专项 · ${toolboxScene.title}` : `主题 · ${selectedTask?.label}`}</span>
                  <button type="button" className="assistant-context-chip" onClick={clearTask}>重新选择主题</button>
                </div>
              )}

              <div
                className="assistant-transcript"
                role="log"
                aria-live="polite"
                aria-busy={loading}
                aria-relevant="additions text"
              >
                {messages.map((message) => <ChatBubble key={message.id} msg={message} />)}
              </div>

              {(cockpitState === 'reply-error' || cockpitState === 'reply-not-ai' || cockpitState === 'ai-unavailable') && (
                <div className="assistant-turn-actions" role="group" aria-label="这一轮之后可以做什么">
                  {cockpitState === 'reply-error' && lastUserText && (
                    <button type="button" className="assistant-turn-action" data-primary="true" onClick={retryLastTurn}>
                      <KIcon name="swap" />重试这一轮
                    </button>
                  )}
                  {cockpitState !== 'reply-error' && (
                    <button type="button" className="assistant-turn-action" data-primary="true" onClick={recheckAdvisor}>
                      <KIcon name="swap" />重新检查 AI 顾问
                    </button>
                  )}
                  {voiceAvailable && cockpitState !== 'reply-not-ai' && (
                    <button type="button" className="assistant-turn-action" onClick={openVoiceDialog}>
                      <KIcon name="mic" />{cockpitState === 'reply-error' ? '改用语音' : '看看语音入口'}
                    </button>
                  )}
                  {hasUserTurn && (
                    <button type="button" className="assistant-turn-action" onClick={resetConversation}>
                      {cockpitState === 'reply-not-ai' ? '回到提问' : '换个问题'}
                    </button>
                  )}
                </div>
              )}

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
                  {AI_LABEL_COPY.BASE}。这一轮回答来自真实模型（服务标识：{describeProviderLabel(providerLabel)}），
                  不构成录用、薪资或办理结果的承诺。
                </AiDisclaimerLine>
                <p className="assistant-nodo"><b>这一轮不决定</b><span>身份 · 支付 · 设备状态 · 打印扫描成败 · 岗位来源真伪 · 政策资格 · 录用结果</span></p>
              </AiTaskRegion>

              {/* 自动滚动的落点放在「这一轮之后可以做什么」之后：失败时重试键必须进视野，不能停在气泡末尾。 */}
              <div ref={bottomRef} />

              {advisorTask.isFailed && <AdvisorManualEntries />}

              {hasUserTurn && (
                <AssistantSessionSummaryBar
                  sessionId={sessionIdRef.current}
                  canSave={messages.some((message) => message.kind === 'ai') && !loading && !aiLocked}
                  loggedIn={isLoggedIn}
                  token={getToken()}
                />
              )}
            </section>
          )}

          {goActions && goActions.length > 0 && (hasUserTurn || selectedTask) && !advisorTask.isFailed && (
            <section className="assistant-go-section" aria-labelledby="assistant-go-title">
              <AdvisorSectionLabel no={nextNo()} id="assistant-go-title" title="可以直接去的地方" hint="只列路由白名单内的入口" />
              <div className="action-chips" aria-label="回答后的操作">
                {goActions.map((action) => (
                  <button key={action.route} type="button" className="action-chip" onClick={() => navigate(action.route)}>
                    {action.label}
                    <small aria-hidden="true">{action.route}</small>
                    <KIcon name="arrow" />
                  </button>
                ))}
              </div>
              {lastDropped > 0 && (
                <p className="assistant-drop-note">这一轮另有 {lastDropped} 条白名单外的动作已直接丢弃、不渲染。岗位与招聘会只到来源入口为止，本机不做站内投递。</p>
              )}
            </section>
          )}

          {!advisorTask.isFailed && cockpitState !== 'composer' && (
            <section className="assistant-manual-section" aria-labelledby="assistant-manual-title">
              <AdvisorSectionLabel no={nextNo()} id="assistant-manual-title" title="不经过 AI 也能办" hint="AI 出问题时这四项照常" />
              <AdvisorManualEntries variant="rail" />
            </section>
          )}
        </div>

        <section className="assistant-composer" aria-labelledby="assistant-composer-label">
          <label id="assistant-composer-label" htmlFor="assistant-question">向 AI 顾问描述你的问题</label>
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
            placeholder={aiLocked
              ? 'AI 顾问未接真实模型，暂时不能发送'
              : toolboxScene?.placeholder ?? (selectedTask ? `请补充“${selectedTask.label}”相关情况` : '说说你想解决什么，例如：我想把简历压到一页')}
            rows={3}
            maxLength={ASSISTANT_USER_MESSAGE_MAX_LENGTH}
            /* AI 不可用时用 readOnly + aria-disabled 而不是原生 disabled：
               原生 disabled 会把输入框踢出 Tab 序，读屏用户读不到旁边那句「为什么锁」。 */
            readOnly={aiLocked}
            aria-disabled={aiLocked || undefined}
            disabled={!aiLocked && loading}
          />

          <div className="assistant-dock-row">
            <AssistantHoldToTalk
              unavailable={aiLocked || loading}
              unavailableReason={aiLocked
                ? `AI 顾问答不了话，按住说话也暂停了（服务标识：${describeProviderLabel(providerLabel)}）。`
                : loading ? '正在等这一轮返回，请稍候再录音。' : undefined}
              sendDirect={sendVoiceDirect}
              onSendDirectChange={setSendVoiceDirect}
              onTranscript={(text, direct) => {
                if (direct) {
                  void sendMessage(text)
                  return
                }
                setInput(text.slice(0, ASSISTANT_USER_MESSAGE_MAX_LENGTH))
                focusComposer()
              }}
            />
            <span className="assistant-dock-spacer" />
            {draftLength > 0 && !aiLocked && (
              <button type="button" className="assistant-dock-clear" disabled={loading} onClick={() => { setInput(''); focusComposer() }}>
                清空草稿
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
              <KeyboardIcon aria-hidden />
              拼音键盘
            </button>
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
              className="assistant-send"
              onClick={aiLocked ? undefined : handleSend}
              disabled={!aiLocked && (!input.trim() || loading)}
              aria-disabled={aiLocked || undefined}
            >
              <KIcon name="send" />
              {loading ? '等待返回' : '发送'}
            </button>
          </div>

          {aiLocked ? (
            <div className="assistant-composer-lock" role="status">
              <p>
                <b>已锁</b>
                本机 AI 顾问还没有接上真实模型（服务标识：{describeProviderLabel(providerLabel)}），
                页面不会用预置话术冒充 AI 回答。可在上方「重新检查 AI 顾问」再试。
              </p>
            </div>
          ) : (
            <p className="assistant-dock-note">
              <b>{loading ? '等待中' : draftLength > 0 ? '草稿' : '提示'}</b>
              <span>
                {loading
                  ? '这一轮还没返回，发送键先停用；下面四个非 AI 入口照常可点。'
                  : `${draftLength} / ${ASSISTANT_USER_MESSAGE_MAX_LENGTH} 字 · 草稿只留在本页，离开即清${draftLength > 0 ? '' : ' · 不想打字就点上面的问题'}`}
              </span>
            </p>
          )}
        </section>

        <footer className="assistant-truth" data-disclaimer="true">
          <p><b>回答来源</b>只有服务标识以 llm: 开头且标记为模型生成时，正文才会显示；否则如实说明、不展示正文。</p>
          <p><b>AI 不做的判定</b>{toolboxScene?.disclaimer ?? `${AI_LABEL_COPY.BASE}，不构成正式建议`}；身份、支付、设备、打印扫描成败、岗位来源真伪、政策资格、录用结果一律不由 AI 决定。</p>
          <p><b>隐私与边界</b>本机草稿离场即清；对话、文件与订单按服务端各自留存期限管理。岗位投递与招聘会预约请前往来源平台完成，本机不代收简历。</p>
        </footer>
      </div>

      {voiceAvailable && callActive && LazyCallPanel && (
        <Suspense
          fallback={(
            <div className="assistant-voice-backdrop" role="status" aria-live="polite">
              <div className="assistant-voice-loading">通话模块加载中…</div>
            </div>
          )}
        >
          <LazyCallPanel onClose={closeVoiceDialog} onSwitchToText={switchVoiceToText} onStateChange={setVoiceState} />
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
    </QxPageFrame>
  )
}
