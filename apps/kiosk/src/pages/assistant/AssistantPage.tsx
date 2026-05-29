// ============================================================
// AssistantPage — Phase 7.7
//
// 合规约束：
// - actions 只允许跳转本系统内部白名单路由
// - 所有 AI 回复标注"内容仅供参考"
// - 不出现：一键投递 / 企业查看简历 / 候选人管理 /
//           简历筛选 / 面试邀约 / Offer 管理
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import { AlertCircleIcon, BotIcon, SendHorizontalIcon } from 'lucide-react'
import type { AssistantAction } from '@ai-job-print/shared'
import { chatWithAssistant } from '../../services/api'

// ─── 路由白名单（actions 只能跳转这些路径）──────────────────

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

// ─── sessionId 持久化 ─────────────────────────────────────────

const SESSION_KEY = 'kiosk_ai_session_id'

function getOrCreateSessionId(): string {
  try {
    const stored = localStorage.getItem(SESSION_KEY)
    if (stored) return stored
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    localStorage.setItem(SESSION_KEY, id)
    return id
  } catch {
    // localStorage unavailable (e.g., kiosk restricted mode)
    return `session-${Date.now()}`
  }
}

function saveSessionId(id: string): void {
  try { localStorage.setItem(SESSION_KEY, id) } catch { /* ignore */ }
}

// ─── 消息类型 ─────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  actions?: AssistantAction[]
  isError?: boolean
}

// 欢迎消息 — 本地常量，不调用 API，页面首次渲染即显示
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

// ─── 组件 ────────────────────────────────────────────────────

export function AssistantPage() {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const sessionIdRef = useRef<string>(getOrCreateSessionId())
  const cancelledRef = useRef(false)
  const bottomRef    = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return () => { cancelledRef.current = true }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', text },
    ])
    setInput('')
    setLoading(true)

    try {
      const resp = await chatWithAssistant({
        message:   text,
        sessionId: sessionIdRef.current,
      })
      if (cancelledRef.current) return

      sessionIdRef.current = resp.sessionId
      saveSessionId(resp.sessionId)

      // Filter: only white-listed internal routes survive
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
        {
          id:      `err-${Date.now()}`,
          role:    'assistant',
          text:    'AI 服务暂不可用，请稍后再试',
          isError: true,
        },
      ])
    } finally {
      if (!cancelledRef.current) setLoading(false)
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

  return (
    <div className="flex h-full flex-col">

      {/* ── 页头 ───────────────────────────────────────── */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-6 pb-3 pt-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100">
            <BotIcon className="h-5 w-5 text-primary-600" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">AI 就业服务助手</h1>
            <p className="text-xs text-gray-500">智能问答 · 求职指导 · 内容仅供参考</p>
          </div>
        </div>
      </div>

      {/* ── 消息列表 ────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-5">
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onAction={(route) => navigate(route)}
            />
          ))}

          {/* Loading 动画 */}
          {loading && (
            <div className="flex items-start gap-2">
              <BotAvatar />
              <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-3.5">
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── 输入区域 ─────────────────────────────────────── */}
      <div className="shrink-0 border-t border-gray-200 bg-white p-4">
        <div className="flex items-end gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，例如：如何优化我的简历？"
            rows={2}
            disabled={loading}
            className="min-h-[56px] flex-1 resize-none rounded-xl border border-gray-300 px-4 py-3 text-sm leading-relaxed text-gray-900 placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <Button
            size="lg"
            onClick={() => void handleSend()}
            disabled={!input.trim() || loading}
            aria-label="发送消息"
            className="shrink-0"
          >
            <SendHorizontalIcon className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>
        <p className="mt-2 text-center text-xs text-gray-400">
          AI 回复内容仅供参考，不构成正式建议
        </p>
      </div>
    </div>
  )
}

// ─── 子组件 ───────────────────────────────────────────────────

function BotAvatar() {
  return (
    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100">
      <BotIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
    </div>
  )
}

interface MessageBubbleProps {
  msg: Message
  onAction: (route: string) => void
}

function MessageBubble({ msg, onAction }: MessageBubbleProps) {
  const isUser      = msg.role === 'user'
  const isError     = msg.isError === true
  const isAssistant = !isUser

  return (
    <div className={`flex items-start gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      {isAssistant && <BotAvatar />}

      <div className={`flex max-w-[78%] flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        {/* 气泡 */}
        <div
          className={
            isUser
              ? 'rounded-2xl rounded-br-sm bg-primary-600 px-4 py-3 text-sm leading-relaxed text-white'
              : isError
                ? 'flex items-start gap-2 rounded-2xl rounded-bl-sm bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700'
                : 'rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-3 text-sm leading-relaxed text-gray-900'
          }
        >
          {isError && (
            <AlertCircleIcon
              className="mt-0.5 h-4 w-4 shrink-0 text-red-500"
              aria-hidden="true"
            />
          )}
          <span>{msg.text}</span>
        </div>

        {/* 仅供参考 label（AI 正常回复时显示） */}
        {isAssistant && !isError && (
          <p className="mt-1 px-1 text-xs text-gray-400">内容仅供参考</p>
        )}

        {/* 快捷操作按钮（仅白名单路由，48px 触控高度） */}
        {msg.actions && msg.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {msg.actions.map((action) => (
              <button
                key={action.route}
                type="button"
                onClick={() => onAction(action.route)}
                className="min-h-[48px] rounded-full border border-primary-200 bg-white px-4 py-2 text-sm font-medium text-primary-700 transition-colors hover:bg-primary-50 active:bg-primary-100"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
