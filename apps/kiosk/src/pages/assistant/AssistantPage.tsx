// 稿 05 青序流光 2.0；状态只由真实请求、草稿与语音相位派生。
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
import { AiTaskRegion, isAiOutage, useAiTask } from '../../ai'
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
import { buildNonAiNotice, isAiGeneratedReply } from './advisorProvider'
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
import { useAssistantDraftHandoff } from '../../services/assistantDraft'
import { AssistantTaskPicker } from './AssistantTaskPicker'
import { advisorErrorMessage, advisorUserReason } from './advisorUserCopy'
import { AI_CONTENT_COMPLAINT_ROUTE } from '../profile/me/feedback/aiComplaint'
import './assistant-qingxu.css'

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
  useAssistantDraftHandoff(setInput, ASSISTANT_USER_MESSAGE_MAX_LENGTH)
  const [loading, setLoading] = useState(false)
  const quickQuestions = selectedTask?.questions ?? GENERAL_QUESTIONS
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
    } catch (error) {
      if (cancelledRef.current) return
      if (requestTokenRef.current !== requestToken || sessionIdRef.current !== requestSessionId) return
      // AI 能力级停用（暂停 / 当日额度已到 / 未配置）：重试这一轮不会变好。与「非 AI 回复」同样
      // 锁住输入、转到不经过 AI 的四个入口；恢复后用户可点「重新检查 AI 顾问」再试。
      if (isAiOutage(error)) {
        setAiAvailability('unavailable')
        setKeyboardOpen(false)
        setMessages((current) => [
          ...current,
          { id: `err-${Date.now()}`, role: 'assistant', kind: 'error', text: advisorErrorMessage(error, 'AI 顾问现在停用，下面几项不经过 AI，照常能办。') },
        ])
        return
      }
      setTurnFailed(true)
      setMessages((current) => [
        ...current,
        { id: `err-${Date.now()}`, role: 'assistant', kind: 'error', text: advisorErrorMessage(error, 'AI 服务暂不可用，请稍后再试') },
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

  const degradedReason = aiLocked ? '这些专项需要 AI 作答，恢复后可重新选择。' : '刚才这一轮没有连上 AI 顾问。'
  const advisorFallback: AiTaskFallback = useMemo(() => ({
    mode: 'manual',
    reason: aiAvailability === 'unavailable'
      ? '先选一项继续办理，也可以重新检查后再提问。'
      : '重试会再次发送刚才的问题，不用重新输入。',
    manualPath: '打印扫描、政策说明和已有简历都可以自己办理。',
    action: { label: '去打印扫描', onClick: () => navigate('/print-scan') },
  }), [aiAvailability, navigate])

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
  const showPicker = (!hasUserTurn || cockpitState === 'composer') && !aiLocked
  const showConversation = hasUserTurn || Boolean(toolboxScene || selectedTask) || advisorTask.isFailed
  const draftLength = input.trim().length

  return (
    <QxPageFrame
      back={{ label: '返回首页', onBack: () => navigate('/') }}
      title="AI 顾问"
      status={cockpitCopy.pill}
      navbar={
        <>
          <button type="button" className="qx-nav-item" onClick={() => navigate('/')}><HomeIcon size={32} aria-hidden />首页</button>
          <button type="button" className="qx-nav-item" aria-current="page"><SparklesIcon size={32} aria-hidden />AI 顾问</button>
          <button type="button" className="qx-nav-item" onClick={() => navigate('/profile')}><UserIcon size={32} aria-hidden />我的</button>
        </>
      }
    >
    <section className="kassist kassist-qingxu" aria-label="AI 顾问咨询工作台">
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
            <AssistantTaskPicker no={nextNo()} composing={cockpitState === 'composer'} input={input}
              selectedTask={selectedTask} contextLabel={contextLabel} questions={quickQuestions}
              loading={loading} aiLocked={aiLocked} onSelect={setSelectedTaskId}
              onClear={clearTask} onQuestion={chooseQuickQuestion} />
          )}

          {showConversation && (
            <section className="assistant-conversation" aria-labelledby="assistant-conversation-title">
              <AdvisorSectionLabel
                no={nextNo()}
                id="assistant-conversation-title"
                title={hasUserTurn || cockpitState === 'ai-unavailable' ? cockpitCopy.section[0] : '开场说明'}
                hint={hasUserTurn || cockpitState === 'ai-unavailable' ? cockpitCopy.section[1] : '补充具体情况，再发送问题'}
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
                {messages.filter((message) => !hasUserTurn || message.kind !== 'system').map((message) => <ChatBubble key={message.id} msg={message} />)}
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
              <AiTaskRegion
                task={advisorTask}
                label="AI 顾问回答"
                className="assistant-ai-status"
                running={<AdvisorThinking />}
                idle={(
                  <p className="assistant-ai-idle">
                    {aiAvailability === 'unknown'
                      ? '写下你的具体情况，小青会帮你梳理下一步。'
                      : '可以继续问，也可以直接点下面的服务入口自己办。'}
                  </p>
                )}
                fallback={advisorFallback}
              />
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
              <AdvisorSectionLabel no={nextNo()} id="assistant-go-title" title="可以直接去的地方" hint="能办的下一步" />
              <div className="action-chips" aria-label="回答后的操作">
                {goActions.map((action) => (
                  <button key={action.route} type="button" className="action-chip" onClick={() => navigate(action.route)}>
                    {advisorUserReason(action.label, '去办理')}
                    <small aria-hidden="true">去办理</small>
                    <KIcon name="arrow" />
                  </button>
                ))}
              </div>

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
              ? 'AI 顾问暂不可用，请先选择办事入口'
              : toolboxScene?.placeholder ?? (selectedTask ? `请补充“${selectedTask.label}”相关情况` : '说说你想解决什么，例如：我想把简历压到一页')}
            rows={3}
            maxLength={ASSISTANT_USER_MESSAGE_MAX_LENGTH}
            readOnly={aiLocked}
            aria-disabled={aiLocked || undefined}
            disabled={!aiLocked && loading}
          />

          <div className="assistant-dock-row">
            <AssistantHoldToTalk
              unavailable={aiLocked || loading}
              unavailableReason={aiLocked
                ? '按住说话暂时停用，可选择上方的办事入口。'
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
              <p><b>暂不能发送</b>恢复后可点「重新检查 AI 顾问」再试。</p>
            </div>
          ) : (
            <p className="assistant-dock-note">
              <b>{loading ? '等待中' : draftLength > 0 ? '草稿' : '提示'}</b>
              <span>
                {loading
                  ? '这一轮还在等待，办事入口照常可用。'
                  : `${draftLength} / ${ASSISTANT_USER_MESSAGE_MAX_LENGTH} 字 · 草稿只留在本页，离开即清${draftLength > 0 ? '' : ' · 不想打字就点上面的问题'}`}
              </span>
            </p>
          )}
        </section>

        <footer className="assistant-truth" data-disclaimer="true">
          <p>{toolboxScene?.disclaimer ?? `${AI_LABEL_COPY.BASE}，身份、付款、打印、政策资格和录用结果都不由 AI 决定。`}</p>
          {/* AI 内容投诉入口（C3，走查 W-01）：稿 05/52 没画，只放一个低调文字入口。 */}
          <button type="button" className="assistant-complaint-link" data-route={AI_CONTENT_COMPLAINT_ROUTE} onClick={() => navigate(AI_CONTENT_COMPLAINT_ROUTE)}>
            对回答有异议？投诉 AI 内容
          </button>
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
