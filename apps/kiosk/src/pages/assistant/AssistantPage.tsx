// ============================================================
// AssistantPage — Phase 9 数字人全屏引导版
//
// 布局：
//   上半区  - 2D 数字人 + 最新消息气泡
//   下半区  - 对话历史（滚动）+ 输入框
//
// 合规约束：
// - actions 只允许跳转本系统内部白名单路由
// - 所有 AI 回复标注"内容仅供参考"
// - 不出现：一键投递 / 企业查看简历 / 候选人管理
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import { AlertCircleIcon, SendHorizontalIcon } from 'lucide-react'
import type { AssistantAction } from '@ai-job-print/shared'
import { chatWithAssistant } from '../../services/api'
import { DigitalHuman, type AvatarState } from '../../components/DigitalHuman'

// ─── 路由白名单 ────────────────────────────────────────────

const ALLOWED_ROUTE_PREFIXES = [
  '/resume/',
  '/print/',
  '/scan/',
  '/jobs',
  '/job-fairs',
  '/renshi',
] as const

function isAllowedRoute(route: string): boolean {
  return ALLOWED_ROUTE_PREFIXES.some(
    (p) => route === p || route.startsWith(`${p}/`),
  )
}

// ─── sessionId 持久化 ─────────────────────────────────────

const SESSION_KEY = 'kiosk_ai_session_id'

function getOrCreateSessionId(): string {
  try {
    const stored = localStorage.getItem(SESSION_KEY)
    if (stored) return stored
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    localStorage.setItem(SESSION_KEY, id)
    return id
  } catch {
    return `session-${Date.now()}`
  }
}

function saveSessionId(id: string): void {
  try { localStorage.setItem(SESSION_KEY, id) } catch { /* ignore */ }
}

// ─── 消息类型 ─────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  actions?: AssistantAction[]
  isError?: boolean
}

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  text: '您好！我是 AI 就业服务助手，可以为您提供简历建议、求职指导和打印帮助。请问有什么需要帮忙的？',
  actions: [
    { label: '查看简历服务', route: '/resume/source' },
    { label: '浏览岗位信息', route: '/jobs' },
    { label: '查看招聘会',   route: '/job-fairs' },
    { label: '人社专区',     route: '/renshi' },
  ],
}

// ─── 主组件 ───────────────────────────────────────────────

export function AssistantPage() {
  const navigate      = useNavigate()
  const [messages, setMessages]     = useState<Message[]>([WELCOME_MESSAGE])
  const [input, setInput]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [avatarState, setAvatarState] = useState<AvatarState>('greeting')
  const sessionIdRef  = useRef<string>(getOrCreateSessionId())
  const cancelledRef  = useRef(false)
  const bottomRef     = useRef<HTMLDivElement>(null)

  // 首次进入：问候动画 → 待机
  useEffect(() => {
    const t = setTimeout(() => setAvatarState('idle'), 3500)
    return () => {
      clearTimeout(t)
      cancelledRef.current = true
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text }])
    setInput('')
    setLoading(true)
    setAvatarState('talking')

    try {
      const resp = await chatWithAssistant({ message: text, sessionId: sessionIdRef.current })
      if (cancelledRef.current) return

      sessionIdRef.current = resp.sessionId
      saveSessionId(resp.sessionId)

      const safeActions = resp.actions?.filter((a) => isAllowedRoute(a.route))
      setMessages((prev) => [
        ...prev,
        {
          id:      `a-${Date.now()}`,
          role:    'assistant',
          text:    resp.reply,
          actions: safeActions?.length ? safeActions : undefined,
        },
      ])
    } catch {
      if (cancelledRef.current) return
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: 'assistant', text: 'AI 服务暂不可用，请稍后再试', isError: true },
      ])
    } finally {
      if (!cancelledRef.current) {
        setLoading(false)
        setAvatarState('idle')
      }
    }
  }, [input, loading])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend],
  )

  // 最新一条 AI 消息（在数字人气泡显示）
  const latestAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant')

  return (
    <div className="flex h-full flex-col bg-gray-50">

      {/* ━━━ 上半区：数字人 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="shrink-0 flex flex-col items-center pt-6 pb-4 px-4 bg-gradient-to-b from-blue-50 to-gray-50">
        <div className="relative w-36 h-44">
          <DigitalHuman state={avatarState} className="w-full h-full" />

          {/* 状态徽标 */}
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                avatarState === 'talking'
                  ? 'bg-blue-100 text-blue-700'
                  : avatarState === 'greeting'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-gray-100 text-gray-500'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  avatarState === 'talking' ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'
                }`}
              />
              {avatarState === 'talking' ? '正在回复…' : avatarState === 'greeting' ? '欢迎您' : '在线'}
            </span>
          </div>
        </div>

        {/* 最新消息气泡（跟随数字人） */}
        {latestAssistantMsg && (
          <SpeechBubble
            text={latestAssistantMsg.text}
            isError={latestAssistantMsg.isError}
            isLoading={loading}
          />
        )}
      </div>

      {/* ━━━ 快捷操作区 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {latestAssistantMsg?.actions && !loading && (
        <div className="shrink-0 flex flex-wrap gap-2 px-4 pb-3 justify-center">
          {latestAssistantMsg.actions.map((action) => (
            <button
              key={action.route}
              type="button"
              onClick={() => navigate(action.route)}
              className="min-h-[48px] rounded-full border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-blue-700 shadow-sm transition-colors hover:bg-blue-50 active:bg-blue-100"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* ━━━ 下半区：对话历史 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-4">
          {messages.map((msg) => (
            <ChatBubble key={msg.id} msg={msg} />
          ))}

          {loading && (
            <div className="flex items-center gap-1.5 w-fit rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-3">
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ━━━ 输入区 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="shrink-0 border-t border-gray-200 bg-white p-4">
        <div className="flex items-end gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，例如：如何优化我的简历？"
            rows={2}
            disabled={loading}
            className="min-h-[60px] flex-1 resize-none rounded-xl border border-gray-300 px-4 py-3.5 text-base leading-relaxed text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <Button
            size="lg"
            onClick={() => void handleSend()}
            disabled={!input.trim() || loading}
            aria-label="发送消息"
            className="h-16 w-16 shrink-0 rounded-xl"
          >
            <SendHorizontalIcon className="h-6 w-6" aria-hidden="true" />
          </Button>
        </div>
        <p className="mt-2 text-center text-xs text-gray-400">AI 回复内容仅供参考，不构成正式建议</p>
      </div>
    </div>
  )
}

// ─── 子组件 ───────────────────────────────────────────────

interface SpeechBubbleProps {
  text: string
  isError?: boolean
  isLoading?: boolean
}

function SpeechBubble({ text, isError, isLoading }: SpeechBubbleProps) {
  const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text
  return (
    <div
      className={`relative mt-4 max-w-xs rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm
        ${isError ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-white border border-blue-100 text-gray-800'}
        ${isLoading ? 'opacity-60' : ''}`}
    >
      {/* 气泡三角 */}
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-2 overflow-hidden">
        <div
          className={`w-4 h-4 rotate-45 -translate-y-2 ${
            isError ? 'bg-red-50 border-l border-t border-red-200' : 'bg-white border-l border-t border-blue-100'
          }`}
        />
      </div>

      {isError && <AlertCircleIcon className="inline mr-1 h-4 w-4 text-red-500" />}
      {preview}
    </div>
  )
}

interface ChatBubbleProps {
  msg: Message
}

function ChatBubble({ msg }: ChatBubbleProps) {
  const isUser  = msg.role === 'user'
  const isError = msg.isError === true

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`flex max-w-[80%] flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={
            isUser
              ? 'rounded-2xl rounded-br-sm bg-blue-600 px-4 py-3 text-sm leading-relaxed text-white'
              : isError
                ? 'flex items-start gap-2 rounded-2xl rounded-bl-sm bg-red-50 border border-red-200 px-4 py-3 text-sm leading-relaxed text-red-700'
                : 'rounded-2xl rounded-bl-sm bg-white border border-gray-200 px-4 py-3 text-sm leading-relaxed text-gray-900'
          }
        >
          {isError && <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />}
          <span>{msg.text}</span>
        </div>

        {!isUser && !isError && (
          <p className="mt-1 px-1 text-xs text-gray-400">内容仅供参考</p>
        )}
      </div>
    </div>
  )
}
