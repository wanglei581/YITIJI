// 稿 05 青序流光 2.0；状态只由真实请求、草稿与语音相位派生。
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { KeyboardIcon } from 'lucide-react'
import { AI_LABEL_COPY } from '@ai-job-print/shared'
import { QxTouchCallout } from '../../components/qingxu/touch/QxTouchCallout'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { QxTouchOverlay } from '../../components/qingxu/touch/QxTouchOverlay'
import { Hit } from '../public-touch/PublicBlocks'
import { IllusChecklist, IllusResume } from '../public-touch/PublicIllus'
import { PublicTouchFrame } from '../public-touch/PublicTouchFrame'
import { useVisibleHelpLine } from '../public-touch/publicTouchHooks'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { KIcon } from '../../components/kiosk-icon'
import { KioskKeyboard } from '../../components/kiosk-keyboard/KioskKeyboard'
import { useInkRipple } from '../../hooks/useInkRipple'
import { chatWithAssistant } from '../../services/api'
import { API_BASE_URL } from '../../services/api/client'
import { useAuth } from '../../auth/useAuth'
import { AiTaskRegion, isAiOutage, useAiTask } from '../../ai'
import { AiDeclarationNote } from '../../ai/AiDeclarationNote'
import { prepareAiDeclaration } from '../../ai/aiDeclarationGate'
import { AssistantHoldToTalk } from './AssistantHoldToTalk'
import { AssistantSessionSummaryBar } from './AssistantSessionSummaryBar'
import type { AiAvailability, AiTaskFallback } from '../../ai'
import { AdvisorCockpit } from './AdvisorCockpit'
import {
  AdvisorManualEntries,
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
import './assistant-touch.css'

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
      return {
        id: `welcome-${selectedTask.id}`,
        role: 'assistant',
        kind: 'system',
        text: selectedTask.id === 'jobs' && !hostingOpen
          ? `${selectedTask.welcome} 本终端未开放岗位与招聘会信息。问题仍可以问。`
          : selectedTask.welcome,
      }
    }
    return WELCOME
  }, [hostingOpen, selectedTask, toolboxScene, toolboxSkill])
  const [messages, setMessages] = useState<Message[]>(() => [welcomeMessage])
  const [input, setInput] = useState('')
  const [sheet, setSheet] = useState<'tools' | 'manual' | 'acts' | null>(null)
  useAssistantDraftHandoff(setInput, ASSISTANT_USER_MESSAGE_MAX_LENGTH)
  const [loading, setLoading] = useState(false)
  const [declaring, setDeclaring] = useState(false)
  const quickQuestions = selectedTask?.questions ?? GENERAL_QUESTIONS
  const [aiAvailability, setAiAvailability] = useState<AiAvailability>('unknown')
  const [turnFailed, setTurnFailed] = useState(false)

  useBusyLock(loading)
  useInkRipple('.kassist .assistant-task, .kassist .assistant-direct-question, .kassist .assistant-context-chip, .kassist .assistant-quick-questions button, .kassist .assistant-tool-button, .kassist .assistant-send, .kassist .action-chip, .kassist .assistant-manual-entry, .kassist .assistant-hold-talk-btn, .kassist .assistant-summary-save, .kassist .assistant-turn-action')

  const sessionIdRef = useRef(newSessionId())
  const cancelledRef = useRef(false)
  const previousContextRef = useRef(`${toolboxSkill ?? 'general'}:${selectedTaskId ?? 'none'}`)
  const requestTokenRef = useRef(0)
  const declaringRef = useRef(false)
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
    if (!text || loading || declaringRef.current || aiAvailability === 'unavailable') return
    const assistantRequestMessage = selectedTask
      ? `当前咨询主题：${selectedTask.label}\n用户问题：${text}`
      : text
    const requestSessionId = sessionIdRef.current
    const requestToken = requestTokenRef.current + 1
    requestTokenRef.current = requestToken

    // 年满 14 周岁还没点完之前，问题仍留在输入框，页面不写成「已发出」。
    const token = getToken()
    const declarationHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) declarationHeaders.Authorization = `Bearer ${token}`
    declaringRef.current = true
    setDeclaring(true)
    try {
      await prepareAiDeclaration(`${API_BASE_URL}/assistant/chat`, {
        method: 'POST',
        headers: declarationHeaders,
      })
    } catch (error) {
      declaringRef.current = false
      setDeclaring(false)
      if (cancelledRef.current) return
      if (requestTokenRef.current !== requestToken || sessionIdRef.current !== requestSessionId) return
      setMessages((current) => {
        const base = options?.resend
          ? current.filter((message, index) => !(index === current.length - 1 && message.kind === 'error'))
          : [...current, { id: `u-${Date.now()}`, role: 'user' as const, kind: 'user' as const, text }]
        return [...base, {
          id: `err-${Date.now()}`,
          role: 'assistant' as const,
          kind: 'error' as const,
          text: advisorErrorMessage(error, '这次没有发出'),
        }]
      })
      if (!options?.resend) setInput('')
      setTurnFailed(true)
      return
    }
    declaringRef.current = false
    setDeclaring(false)
    if (cancelledRef.current) return
    if (requestTokenRef.current !== requestToken || sessionIdRef.current !== requestSessionId) return

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

  const switchVoiceToText = (expiredSubtitle?: string, reason?: 'limit' | 'silent') => {
    if (reason === 'silent') {
      setMessages(previous => [...previous, {
        id: `voice-silent-${Date.now()}`,
        role: 'assistant',
        kind: 'system',
        text: '这次语音没有接通声音，已为你转成文字对话，可以接着问',
      }])
    } else if (reason === 'limit' || expiredSubtitle !== undefined) {
      setMessages(previous => [...previous,
        ...(expiredSubtitle ? [{ id: `voice-subtitle-${Date.now()}`, role: 'assistant' as const, kind: 'system' as const, text: expiredSubtitle }] : []),
        { id: `voice-limit-${Date.now()}`, role: 'assistant', kind: 'system', text: '语音通话已到本次上限，已为你转成文字对话，可以继续问' },
      ])
    }
    setCallActive(false)
    setVoiceState(null)
    focusComposer()
  }

  const openVoiceDialog = () => {
    setKeyboardOpen(false)
    inputRef.current?.blur()
    setCallActive(true)
  }

  const askAgain = () => {
    setKeyboardOpen(true)
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
    resetConversation()
    focusComposer()
  }

  // 主体按「这一轮到哪了」选一种版式：没问过 / 在等 / 有回答 / 这一轮不是 AI 生成 / 本轮失败 / AI 暂不可用。
  const body: 'picker' | 'submitting' | 'reply' | 'notai' | 'error' | 'locked' = loading
    ? 'submitting'
    : lastTurn === 'not-ai'
      ? 'notai'
      : aiLocked
        ? 'locked'
        : lastTurn === 'error'
          ? 'error'
          : lastTurn === 'ai'
            ? 'reply'
            : 'picker'
  // 在等、没问过、有回答这三种有输入坞；其余三种换成底栏按钮，不再给一个按不出结果的发送键。
  const showComposer = body === 'picker' || body === 'submitting' || body === 'reply'
  const showConversation = body !== 'picker' || messages.some((message) => message.id.startsWith('voice-'))
  const draftLength = input.trim().length
  const toolsLine = aiLocked
    ? 'AI 专项暂停 · 恢复后可重新选择'
    : aiAvailability === 'available' ? '8 项 · 本轮已确认可用' : '8 项 · 首轮提问后确认可用性'
  const phoneLine = useVisibleHelpLine()
  const askQuestion = (question: string) => {
    if (loading || aiLocked) return
    void sendMessage(question)
  }
  const openActs = () => setSheet('acts')
  const complaint = () => navigate(AI_CONTENT_COMPLAINT_ROUTE)

  const sheetClose = () => setSheet(null)
  const sheetActions = <button type="button" className="qxt-btn qxt-btn-sec" onClick={sheetClose}>收起</button>
  const overlay = sheet === 'tools' ? (
    <QxTouchOverlay kind="sheet" title="本机 AI 专项" onClose={sheetClose} dismissOnScrim actions={sheetActions}>
      <AiToolSection degraded={aiLocked} degradedReason={degradedReason} availability={aiAvailability} activeSkill={toolboxSkill} />
    </QxTouchOverlay>
  ) : sheet === 'manual' ? (
    <QxTouchOverlay kind="sheet" title="不经过 AI，直接去办" onClose={sheetClose} dismissOnScrim actions={sheetActions}>
      <AdvisorManualEntries variant="sheet" />
    </QxTouchOverlay>
  ) : sheet === 'acts' ? (
    <QxTouchOverlay kind="sheet" title="这一主题还能去哪" onClose={sheetClose} dismissOnScrim actions={sheetActions}>
      {goActions && goActions.length > 0 ? (
        <div className="action-chips" aria-label="这一主题的办事入口">
          {goActions.map((action) => (
            <Hit key={action.route} title={advisorUserReason(action.label, '去办理')} sub="去办理" onClick={() => navigate(action.route)} />
          ))}
        </div>
      ) : (
        <p className="qxp-note">本终端未开放岗位与招聘会信息。这一主题没有「去办理」入口，问题仍可以问。</p>
      )}
    </QxTouchOverlay>
  ) : undefined

  const lockedDock = (
    <QxTouchDock
      mid={<button type="button" className="qxt-btn qxt-btn-sec qxt-fill" onClick={complaint}>投诉 AI 内容</button>}
      primary={{ label: '重新检查', onClick: recheckAdvisor, noArrow: true }}
    />
  )
  const backOnlyDock = <QxTouchDock />
  const dock = body === 'locked' ? lockedDock : showComposer ? undefined : backOnlyDock

  const turnRow = (
    <div className="assistant-task-actions" data-cols="3" role="group" aria-label="这一轮之后可以做什么">
      {body === 'reply' ? (
        <>
          <AssistantSessionSummaryBar
            sessionId={sessionIdRef.current}
            canSave={messages.some((message) => message.kind === 'ai') && !loading && !aiLocked}
            loggedIn={isLoggedIn}
            token={getToken()}
          />
          <button type="button" className="assistant-direct-question assistant-turn-action" onClick={askAgain}>
            <strong>再问一句</strong>
          </button>
        </>
      ) : (
        <>
          <button type="button" className="assistant-direct-question assistant-turn-action" data-primary="true" onClick={retryLastTurn}>
            <strong>重试这一轮</strong>
          </button>
          <button type="button" className="assistant-direct-question assistant-turn-action" onClick={resetConversation}>
            <strong>换个问题</strong>
          </button>
        </>
      )}
      <button type="button" className="assistant-complaint" onClick={complaint}>
        <strong>投诉 AI 内容</strong>
      </button>
    </div>
  )

  return (
    <PublicTouchFrame
      page="assistant"
      eyebrow="问小青"
      title={cockpitCopy.title.join('')}
      sub={cockpitCopy.lede}
      status={cockpitCopy.pill}
      navCurrent="advisor"
      back={{ label: '返回首页', onBack: () => navigate('/') }}
      dock={dock}
      overlay={overlay}
    >
    <section className="kassist kassist-qingxu" aria-label="AI 顾问咨询工作台">
      <div
        ref={workbenchRef}
        data-kiosk-domain="assistant"
        data-kiosk-screen="assistant"
        className="assistant-workbench"
        data-cockpit-state={cockpitState}
        data-view={body}
        data-kb-open={keyboardHeight > 0 || undefined}
        style={keyboardHeight > 0 ? ({ '--kassist-kb-h': `${keyboardHeight}px` } as CSSProperties) : undefined}
      >
        <div
          className="assistant-cockpit-body"
          data-screen="ai-cockpit"
          data-state={cockpitState}
          data-testid={`ai-cockpit-state-${cockpitState}`}
        >
          {body === 'picker' && (
            <AssistantTaskPicker
              selectedTask={selectedTask} scene={toolboxScene} welcome={welcomeMessage.text} questions={quickQuestions}
              loading={loading} aiLocked={aiLocked} toolsLine={toolsLine}
              onSelect={setSelectedTaskId} onClear={clearTask} onQuestion={askQuestion}
              onOpenTools={() => setSheet('tools')} onOpenManual={() => setSheet('manual')}
              onOpenActs={openActs} onComplaint={complaint}
            />
          )}

          {showConversation && (
            <section className="assistant-conversation" aria-labelledby="assistant-conversation-title" data-turn={body}>
              <h2 id="assistant-conversation-title" className="kassist-sr-only" tabIndex={-1}>{cockpitCopy.section[0]}</h2>
              <div
                className="assistant-transcript"
                role="log"
                aria-live="polite"
                aria-busy={loading}
                aria-relevant="additions text"
              >
                {messages
                  .filter((message) => message.kind !== 'system' || message.id.startsWith('voice-'))
                  .map((message) => <ChatBubble key={message.id} msg={message} keptQuestion={lastUserText} />)}
              </div>

              {body === 'submitting' && (
                <div className="qxp-pair assistant-wait-pair">
                  <div className="qxp-card assistant-wait-card">
                    {/* 请求真的在飞（loading）才画等待说明；任务区的四态照旧挂在下面，只读不画。 */}
                    <AdvisorThinking />
                    <AiTaskRegion
                      task={advisorTask}
                      label="AI 顾问回答"
                      className="assistant-ai-status"
                      idle={null}
                      fallback={advisorFallback}
                    />
                    <div className="qxp-artbox" aria-hidden="true"><IllusResume w={200} annot /></div>
                  </div>
                  <div className="qxp-card assistant-wait-card">
                    <p className="qxp-k">不由 AI 决定</p>
                    <p className="qxp-note">身份、付款、打印、政策资格和录用结果都不由这一轮回答决定。</p>
                    <div className="qxp-artbox" aria-hidden="true"><IllusChecklist w={200} /></div>
                  </div>
                </div>
              )}

              {body !== 'submitting' && (
                <AiTaskRegion
                  task={advisorTask}
                  label="AI 顾问回答"
                  className="assistant-ai-status"
                  idle={null}
                  fallback={advisorFallback}
                />
              )}
              <div ref={bottomRef} />

              {body === 'reply' && (
                <>
                  <div className="qxp-card assistant-bounds">
                    <p className="qxp-k">这一轮不替你决定</p>
                    <ul>
                      <li>身份</li><li>付款</li><li>打印是否出纸</li><li>政策资格</li><li>录用结果</li>
                    </ul>
                  </div>
                  {goActions && goActions.length > 0 && (
                    <div className="action-chips" aria-label="回答后的操作">
                      {goActions.map((action) => (
                        <button key={action.route} type="button" className="assistant-go-hit" onClick={() => navigate(action.route)}>
                          <span className="assistant-go-ic" aria-hidden="true"><QxTouchIcon name="arrowR" size={30} strokeWidth={2.4} /></span>
                          <span className="assistant-go-tx">
                            <b>{advisorUserReason(action.label, '去办理')}</b>
                            <small>这一步的入口，办不办由你定</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {(body === 'notai' || body === 'error' || body === 'locked') && (
                <>
                  {body === 'locked' ? (
                    <button type="button" className="assistant-tools-open qxp-hit" onClick={() => setSheet('tools')}>
                      <span className="qxp-ic" aria-hidden="true"><QxTouchIcon name="sparkle" size={32} /></span>
                      <span className="qxp-tx"><b>本机 AI 专项</b><small>{toolsLine}</small></span>
                      <span className="qxp-go" aria-hidden="true"><QxTouchIcon name="chevR" size={26} strokeWidth={2.2} /></span>
                    </button>
                  ) : null}
                  <p className="assistant-exits-title">这些都不需要 AI · 现在就能做</p>
                  <AdvisorManualEntries />
                  {body === 'notai' ? (
                    <Hit title="重新提问" onClick={resetConversation} />
                  ) : body === 'error' ? turnRow : null}
                  {body === 'locked' && phoneLine ? <QxTouchCallout kind="remind">{phoneLine}</QxTouchCallout> : null}
                </>
              )}

              {body === 'reply' && turnRow}
            </section>
          )}
        </div>

        {showComposer && (
        <section className="assistant-composer" aria-labelledby="assistant-composer-label">
          <label id="assistant-composer-label" htmlFor="assistant-question" className="kassist-sr-only">向 AI 顾问描述你的问题</label>
          <div className="assistant-dock-row">
            <button
              type="button"
              className="assistant-tool-button assistant-type"
              disabled={loading || declaring}
              onClick={() => {
                setKeyboardOpen(true)
                focusComposer()
              }}
            >
              <KeyboardIcon aria-hidden />
              打字
            </button>
            <textarea
              id="assistant-question"
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value.slice(0, ASSISTANT_USER_MESSAGE_MAX_LENGTH))}
              onKeyDown={handleKeyDown}
              onFocus={() => !loading && !declaring && setKeyboardOpen(true)}
              onClick={() => !loading && !declaring && setKeyboardOpen(true)}
              inputMode="none"
              aria-label="输入咨询问题"
              placeholder={toolboxScene?.placeholder ?? (selectedTask ? `请补充“${selectedTask.label}”相关情况` : '还没写问题。点「打字」用屏上键盘，或点上面的一句。')}
              rows={1}
              maxLength={ASSISTANT_USER_MESSAGE_MAX_LENGTH}
              disabled={loading || declaring}
            />
            {draftLength > 0 && (
              <button type="button" className="assistant-dock-clear" disabled={loading || declaring} onClick={() => { setInput(''); focusComposer() }}>
                清空
              </button>
            )}
            <button
              type="button"
              className="assistant-send"
              onClick={handleSend}
              disabled={!input.trim() || loading || declaring}
            >
              {loading ? '等待返回' : '发送'}
              <QxTouchIcon name="arrowR" size={30} strokeWidth={2.4} />
            </button>
          </div>
          <div className="assistant-voice-row">
            <AssistantHoldToTalk
              unavailable={loading || declaring}
              unavailableReason={loading ? '正在等这一轮返回，请稍候再录音。' : undefined}
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
            {voiceAvailable && (
              <button
                ref={voiceTriggerRef}
                type="button"
                className="assistant-tool-button assistant-voice-trigger"
                aria-haspopup="dialog"
                aria-controls="assistant-voice-dialog"
                aria-expanded={callActive}
                disabled={loading || declaring}
                onClick={openVoiceDialog}
              >
                <KIcon name="mic" />
                语音咨询
              </button>
            )}
          </div>
          <div className="assistant-fine">
            <AiDeclarationNote />
            <p className="assistant-dock-note">
              {loading
                ? '这一轮还在等待，办事入口照常可用。'
                : `${draftLength} / ${ASSISTANT_USER_MESSAGE_MAX_LENGTH} 字 · 草稿只留在本页，离开即清`}
            </p>
          </div>
        </section>
        )}

        <footer className="assistant-truth" data-disclaimer="true">
          <AdvisorCockpit state={cockpitState} />
          <p>{toolboxScene?.disclaimer ?? `${AI_LABEL_COPY.BASE}，身份、付款、打印、政策资格和录用结果都不由 AI 决定。`}</p>
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
    </PublicTouchFrame>
  )
}
