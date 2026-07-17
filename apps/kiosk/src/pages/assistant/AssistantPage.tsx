// ============================================================
// AssistantPage — 4188 单列咨询工作台 + 腾讯 TRTC 页内通话
//
// 页面语法：任务选择 → 真实对话 → 独立输入区。TRTC 仍由 feature gate
// 条件式懒加载；共享终端的文字会话离开即清空，路由 action 只走白名单。
// ============================================================

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { AssistantAction, AssistantSkill } from '@ai-job-print/shared'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { KIcon, type KioskIconName } from '../../components/kiosk-icon'
import { KioskKeyboard } from '../../components/kiosk-keyboard/KioskKeyboard'
import { useInkRipple } from '../../hooks/useInkRipple'
import { chatWithAssistant } from '../../services/api'
import './assistant-inkpaper.css'
import './assistant-batch8.css'

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
  '/resume', '/resume/', '/print/', '/scan/', '/jobs', '/job-fairs', '/interview', '/renshi',
] as const

function isAllowedRoute(route: string): boolean {
  return ALLOWED_ROUTE_PREFIXES.some((prefix) => route === prefix || route.startsWith(`${prefix}/`))
}

interface ConsultationTask {
  id: 'resume' | 'interview' | 'jobs' | 'workplace'
  label: string
  description: string
  icon: KioskIconName
  welcome: string
  questions: readonly string[]
  serviceActions: readonly AssistantAction[]
}

const CONSULTATION_TASKS: readonly ConsultationTask[] = [
  {
    id: 'resume',
    label: '简历与求职材料',
    description: '项目经历、简历格式与求职材料准备',
    icon: 'resume',
    welcome: '请告诉我你的目标岗位、目前的简历进度，以及最想解决的材料问题。',
    questions: ['项目经历应该怎么写？', '简历打印用 PDF 还是 Word？', '没有实习经历怎么办？'],
    serviceActions: [
      { label: '去做简历诊断', route: '/resume/source' },
      { label: '去打印文件', route: '/print/upload' },
    ],
  },
  {
    id: 'interview',
    label: '面试与沟通',
    description: '面试准备、自我介绍与谈薪沟通',
    icon: 'chat',
    welcome: '请补充目标岗位、当前面试阶段，以及最想准备的问题。',
    questions: ['自我介绍应该怎么准备？', '面试常见问题怎么回答？', '谈薪时应该注意什么？'],
    serviceActions: [{ label: '去做模拟面试', route: '/interview/setup' }],
  },
  {
    id: 'jobs',
    label: '岗位与选择',
    description: '岗位理解、Offer 对比与求职方向',
    icon: 'briefcase',
    welcome: '请补充岗位名称、你关注的条件，或需要比较的 Offer 信息。',
    questions: ['这个岗位是否适合我？', '两个 Offer 应该怎样比较？', '阅读 JD 时应该关注哪些重点？'],
    serviceActions: [
      { label: '查看岗位信息', route: '/jobs' },
      { label: '查看招聘会', route: '/job-fairs' },
    ],
  },
  {
    id: 'workplace',
    label: '入职与职场',
    description: '入职材料、试用期与社保公积金常识',
    icon: 'policy',
    welcome: '请补充所在地区、想了解的事项和当前阶段；具体规定请以当地官方信息为准。',
    questions: ['入职通常需要准备哪些材料？', '试用期有哪些常见注意事项？', '社保公积金应该怎样了解？'],
    serviceActions: [{ label: '查看政策与材料说明', route: '/renshi?tab=policy' }],
  },
]

const GENERAL_QUESTIONS = [
  '应届生没什么经验，简历怎么写工作经历？',
  '简历打印用什么纸、什么格式比较合适？',
  '灵活就业社保补贴怎么申请？需要什么材料？',
] as const

// 后端 AssistantChatRequest.message 上限为 2000；为咨询主题前缀预留空间。
const ASSISTANT_USER_MESSAGE_MAX_LENGTH = 1800

type ToolboxAssistantSkill = AssistantSkill

interface ToolboxAssistantScene {
  title: string
  welcome: string
  placeholder: string
  disclaimer: string
}

const TOOLBOX_ASSISTANT_SCENES: Record<ToolboxAssistantSkill, ToolboxAssistantScene> = {
  offer_compare: {
    title: 'Offer 对比',
    welcome: '这里是 Offer 对比助手。您可以把 2-3 个 Offer 的薪资结构、试用期、地点、福利、工作强度和发展机会发给我；请先打码姓名、手机号、公司敏感编号等隐私信息。对比结果仅供个人参考，不构成录用、入职或法律意见。',
    placeholder: '输入 Offer 信息，例如：A 公司年包、地点、福利；B 公司年包、试用期、通勤…',
    disclaimer: '对比结果仅供个人参考，不构成录用、入职或法律意见',
  },
  salary_negotiation: {
    title: '薪资谈判话术',
    welcome: '这里是薪资谈判话术助手。您可以告诉我岗位、当前薪资范围、目标薪资、已有优势和顾虑，我会帮您整理温和版、直接版和补充材料版话术；内容仅供沟通准备参考，不承诺涨薪或录用结果。',
    placeholder: '输入谈薪场景，例如：HR 给 12k，我希望 14k，有两段实习经历…',
    disclaimer: '话术仅供沟通准备参考，不构成涨薪或录用承诺',
  },
  hr_qa: {
    title: 'HR 知识问答',
    welcome: '这里是 HR 知识问答助手。您可以咨询入职、试用期、社保、公积金、离职、请假等常见流程问题；涉及劳动争议、赔偿、仲裁或合同解除时，请以官方人社窗口、法律援助或专业律师意见为准。',
    placeholder: '输入 HR 问题，例如：试用期社保怎么缴？离职证明什么时候开？',
    disclaimer: '回答仅供常识参考，不构成正式法律意见或官方政策承诺',
  },
}

function normalizeToolboxSkill(value: string | null): ToolboxAssistantSkill | undefined {
  return value === 'offer_compare' || value === 'salary_negotiation' || value === 'hr_qa'
    ? value
    : undefined
}

// 共享触控终端每次进入或切换咨询主题都使用全新 sessionId，且不持久化。
function newSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  actions?: AssistantAction[]
  isError?: boolean
}

const WELCOME: Message = {
  id: 'welcome',
  role: 'assistant',
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
      return { id: `welcome-${toolboxSkill}`, role: 'assistant', text: toolboxScene.welcome }
    }
    if (selectedTask) {
      return { id: `welcome-${selectedTask.id}`, role: 'assistant', text: selectedTask.welcome }
    }
    return WELCOME
  }, [selectedTask, toolboxScene, toolboxSkill])
  const [messages, setMessages] = useState<Message[]>(() => [welcomeMessage])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const quickQuestions = selectedTask?.questions ?? GENERAL_QUESTIONS

  useBusyLock(loading)
  useInkRipple('.kassist .assistant-task, .kassist .assistant-direct-question, .kassist .assistant-context-chip, .kassist .assistant-quick-questions button, .kassist .assistant-tool-button, .kassist .assistant-send, .kassist .action-chip')

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
  }, [selectedTaskId, toolboxSkill, welcomeMessage])

  const sendMessage = useCallback(async (raw: string) => {
    const text = raw.slice(0, ASSISTANT_USER_MESSAGE_MAX_LENGTH).trim()
    if (!text || loading) return
    const assistantRequestMessage = selectedTask
      ? `当前咨询主题：${selectedTask.label}\n用户问题：${text}`
      : text
    const requestSessionId = sessionIdRef.current
    const requestToken = requestTokenRef.current + 1
    requestTokenRef.current = requestToken

    setMessages((current) => [...current, { id: `u-${Date.now()}`, role: 'user', text }])
    setInput('')
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

      const safeActions = response.actions?.filter((action) => isAllowedRoute(action.route))
      setMessages((current) => [
        ...current,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: response.reply,
          actions: safeActions?.length ? safeActions : undefined,
        },
      ])
    } catch {
      if (cancelledRef.current) return
      if (requestTokenRef.current !== requestToken || sessionIdRef.current !== requestSessionId) return
      setMessages((current) => [
        ...current,
        { id: `err-${Date.now()}`, role: 'assistant', text: 'AI 服务暂不可用，请稍后再试', isError: true },
      ])
    } finally {
      if (!cancelledRef.current && requestTokenRef.current === requestToken) setLoading(false)
    }
  }, [loading, selectedTask, toolboxSkill])

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
    if (loading) return
    setInput(question)
    focusComposer()
  }

  const clearTask = () => {
    if (toolboxScene) navigate('/assistant')
    else setSelectedTaskId(null)
  }

  const conversationTitle = toolboxScene?.title
    ? `与小青咨询 · ${toolboxScene.title}`
    : selectedTask
      ? `与小青咨询 · ${selectedTask.label}`
      : '与小青的本次咨询'

  return (
    <main className="kassist kassist-lightflow" aria-labelledby="assistant-page-title">
      <h1 id="assistant-page-title" className="kassist-sr-only">AI助手</h1>

      <div ref={workbenchRef} className="assistant-workbench">
        <header className="assistant-prototype-head">
          <span className="assistant-prototype-avatar" aria-hidden="true">青</span>
          <div>
            <h2>你好，我是小青</h2>
            <p>AI 生成内容，仅供参考 · 不构成正式建议</p>
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
          <div className="assistant-task-grid">
            {CONSULTATION_TASKS.map((task) => (
              <button
                type="button"
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
            {loading && (
              <div className="assistant-thinking" role="status">
                <AdvisorAvatar />
                <span>小青正在整理建议…</span>
                <span className="assistant-thinking-dots" aria-hidden="true"><i /><i /><i /></span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

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
                disabled={loading}
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
            onFocus={() => !loading && setKeyboardOpen(true)}
            onClick={() => !loading && setKeyboardOpen(true)}
            inputMode="none"
            aria-label="输入咨询问题"
            placeholder={toolboxScene?.placeholder ?? (selectedTask ? `请补充“${selectedTask.label}”相关情况` : '请输入你想咨询的求职问题')}
            rows={3}
            maxLength={ASSISTANT_USER_MESSAGE_MAX_LENGTH}
            disabled={loading}
          />

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
              disabled={loading}
              onClick={() => {
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
              onClick={handleSend}
              disabled={!input.trim() || loading}
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
    </main>
  )
}

function AdvisorAvatar() {
  return (
    <span className="assistant-message-avatar" aria-hidden="true">
      <img src="/assets/ai-advisor.png" alt="" />
    </span>
  )
}

function ChatBubble({ msg }: { msg: Message }) {
  const isAssistant = msg.role === 'assistant'
  return (
    <article
      className={`assistant-message assistant-message--${isAssistant ? 'assistant' : 'user'}`}
      data-message-role={msg.role}
    >
      {isAssistant && <AdvisorAvatar />}
      {msg.isError ? (
        <div className="assistant-message-bubble assistant-message-bubble--error" role="alert">
          <strong>暂时无法连接</strong>
          <p>{msg.text}</p>
        </div>
      ) : (
        <div className="assistant-message-bubble">
          <p>{msg.text}</p>
          {isAssistant && <span className="assistant-message-reference">内容仅供参考</span>}
        </div>
      )}
    </article>
  )
}
