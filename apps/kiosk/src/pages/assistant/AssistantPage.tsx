// ============================================================
// AssistantPage — Phase 9.3 快捷操作增强版
//
// 布局：
//   上半区  - 2D 数字人 + 最新消息气泡
//   对话区  - 对话历史（滚动）
//   操作区  - AI 上下文建议（动态）+ 常驻快捷入口（关键词高亮）
//   输入区  - 文本框 + 发送按钮
//
// 合规约束：
// - actions 只允许跳转本系统内部白名单路由
// - 不做招聘闭环、不出现一键投递
// - 所有 AI 回复标注"内容仅供参考"
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import { AlertCircleIcon, SendHorizontalIcon, ZapIcon } from 'lucide-react'
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
  '/qingdao',
] as const

function isAllowedRoute(route: string): boolean {
  return ALLOWED_ROUTE_PREFIXES.some(
    (p) => route === p || route.startsWith(`${p}/`),
  )
}

// ─── 常驻快捷操作 ─────────────────────────────────────────

const SHORTCUTS: AssistantAction[] = [
  { label: '简历诊断',  route: '/resume/report'  },
  { label: '打印文件',  route: '/print/upload'   },
  { label: '扫描材料',  route: '/scan/start'     },
  { label: '查看岗位',  route: '/jobs'           },
  { label: '查看招聘会', route: '/job-fairs'     },
  { label: 'AI 在青岛', route: '/qingdao'        },
  { label: '人社专区',  route: '/renshi'         },
]

// 关键词 → 路由映射（用于输入实时高亮）
const KEYWORD_ROUTES: Array<{ kw: readonly string[]; route: string }> = [
  { kw: ['简历', '诊断', '优化', 'cv', 'resume', '简历服务'],       route: '/resume/report'  },
  { kw: ['打印', '文件', '打文件', '印刷'],                         route: '/print/upload'   },
  { kw: ['扫描', '扫', '原件', '材料'],                             route: '/scan/start'     },
  { kw: ['岗位', '工作', '职位', '招聘', '就业', '找工作'],         route: '/jobs'           },
  { kw: ['招聘会', '双选会', '人才市场', '现场招聘', '招聘活动'],   route: '/job-fairs'      },
  { kw: ['青岛', '人工智能', 'ai在青岛', '数字经济'],               route: '/qingdao'        },
  { kw: ['人社', '社保', '政策', '补贴', '就业服务', '人力资源'],   route: '/renshi'         },
]

function getMatchedRoutes(input: string): Set<string> {
  const lower = input.toLowerCase().trim()
  if (!lower) return new Set()
  const matched = new Set<string>()
  for (const { kw, route } of KEYWORD_ROUTES) {
    if (kw.some((k) => lower.includes(k))) matched.add(route)
  }
  return matched
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
  text: '您好！我是 AI 就业服务助手，可以帮您进行简历诊断、打印文件，或查看岗位和招聘会信息。请问有什么需要帮忙的？',
}

// ─── 主组件 ───────────────────────────────────────────────

export function AssistantPage() {
  const navigate        = useNavigate()
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [svgState, setSvgState] = useState<AvatarState>('greeting')

  const sessionIdRef = useRef<string>(getOrCreateSessionId())
  const cancelledRef = useRef(false)
  const bottomRef    = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setSvgState('idle'), 3500)
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
    setSvgState('talking')

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
        setSvgState('idle')
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

  // 最新 AI 消息（用于气泡和上下文操作）
  const latestAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant')
  const contextActions = latestAssistantMsg?.actions

  // 根据当前输入词实时高亮快捷按钮
  const matchedRoutes = useMemo(() => getMatchedRoutes(input), [input])

  return (
    <div className="flex h-full flex-col bg-gray-50">

      {/* ━━━ 上半区：2D 数字人 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="shrink-0 flex flex-col items-center pt-5 pb-3 px-4 bg-gradient-to-b from-blue-50 to-gray-50">
        <div className="relative">
          <div className="w-32 h-40">
            <DigitalHuman state={svgState} className="w-full h-full" />
          </div>
          <div className="mt-1 flex justify-center">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium
              ${svgState === 'talking'  ? 'bg-blue-100 text-blue-700'
              : svgState === 'greeting' ? 'bg-emerald-100 text-emerald-700'
              : 'bg-gray-100 text-gray-500'}`}>
              <span className={`h-1.5 w-1.5 rounded-full
                ${svgState === 'talking' ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'}`} />
              {svgState === 'talking' ? '正在回复…' : svgState === 'greeting' ? '欢迎您' : '在线'}
            </span>
          </div>
        </div>

        {latestAssistantMsg && (
          <SpeechBubble
            text={latestAssistantMsg.text}
            isError={latestAssistantMsg.isError}
            isLoading={loading}
          />
        )}
      </div>

      {/* ━━━ 对话历史 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
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

      {/* ━━━ 操作区：AI 上下文建议 + 常驻快捷入口 ━━━━━━━━━━ */}
      <div className="shrink-0 border-t border-gray-100 bg-white px-4 pt-3 pb-2 space-y-2">

        {/* AI 上下文建议（仅在 AI 返回时显示） */}
        {contextActions && !loading && (
          <div className="flex items-start gap-2">
            <span className="mt-1.5 shrink-0 flex items-center gap-1 text-xs text-blue-500 font-medium">
              <ZapIcon className="h-3.5 w-3.5" />
              AI 建议
            </span>
            <div className="flex flex-wrap gap-1.5">
              {contextActions.map((action) => (
                <button
                  key={action.route}
                  type="button"
                  onClick={() => navigate(action.route)}
                  className="min-h-[40px] rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 active:bg-blue-800"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 常驻快捷入口（始终可见，关键词高亮） */}
        <div>
          <p className="mb-1.5 text-xs text-gray-400">快捷入口</p>
          <div className="flex flex-wrap gap-2">
            {SHORTCUTS.map((s) => {
              const isHighlighted = matchedRoutes.has(s.route)
              return (
                <button
                  key={s.route}
                  type="button"
                  onClick={() => navigate(s.route)}
                  disabled={loading}
                  className={`min-h-[40px] rounded-full border px-4 py-1.5 text-sm font-medium transition-all
                    ${isHighlighted
                      ? 'border-blue-400 bg-blue-50 text-blue-700 shadow-sm scale-[1.03]'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }
                    disabled:pointer-events-none disabled:opacity-40`}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
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

function SpeechBubble({ text, isError, isLoading }: { text: string; isError?: boolean; isLoading?: boolean }) {
  const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text
  return (
    <div className={`relative mt-3 max-w-xs rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm
      ${isError ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-white border border-blue-100 text-gray-800'}
      ${isLoading ? 'opacity-60' : ''}`}>
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-2 overflow-hidden">
        <div className={`w-4 h-4 rotate-45 -translate-y-2
          ${isError ? 'bg-red-50 border-l border-t border-red-200' : 'bg-white border-l border-t border-blue-100'}`} />
      </div>
      {isError && <AlertCircleIcon className="inline mr-1 h-4 w-4 text-red-500" />}
      {preview}
    </div>
  )
}

function ChatBubble({ msg }: { msg: Message }) {
  const isUser  = msg.role === 'user'
  const isError = msg.isError === true
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`flex max-w-[80%] flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={
          isUser  ? 'rounded-2xl rounded-br-sm bg-blue-600 px-4 py-3 text-sm leading-relaxed text-white'
          : isError ? 'flex items-start gap-2 rounded-2xl rounded-bl-sm bg-red-50 border border-red-200 px-4 py-3 text-sm leading-relaxed text-red-700'
          : 'rounded-2xl rounded-bl-sm bg-white border border-gray-200 px-4 py-3 text-sm leading-relaxed text-gray-900'
        }>
          {isError && <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}
          <span>{msg.text}</span>
        </div>
        {!isUser && !isError && (
          <p className="mt-1 px-1 text-xs text-gray-400">内容仅供参考</p>
        )}
      </div>
    </div>
  )
}
