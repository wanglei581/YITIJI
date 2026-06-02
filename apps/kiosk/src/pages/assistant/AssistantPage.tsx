// ============================================================
// AssistantPage — Phase 9.5 腾讯 TRTC 实时语音通话版
//
// 两种模式：
//   call  - 腾讯 TRTC 对话式 AI（照片背景 + 实时语音）
//           进入页面自动通话，切换/离开自动挂断（组件卸载即清理）
//   text  - 文字对话（降级 / 用户主动切换）
//
// 合规约束：
//   - 跳转只允许白名单路由，不出现一键投递
//   - AI 回复标注"内容仅供参考"
// ============================================================

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MicIcon,
  AlertCircleIcon,
  SendHorizontalIcon,
  ZapIcon,
  ArrowLeftIcon,
  FileTextIcon,
  PrinterIcon,
  BriefcaseIcon,
  CalendarDaysIcon,
  LandmarkIcon,
} from 'lucide-react'
import { Button } from '@ai-job-print/ui'
import type { AssistantAction } from '@ai-job-print/shared'
import { chatWithAssistant } from '../../services/api'

// 是否启用 TRTC 语音通话（需后端配置凭证 + 安装 trtc-sdk-v5）
const USE_VOICE_CALL = import.meta.env['VITE_USE_TRTC_CALL'] === 'true'

// 条件式懒加载：VITE_USE_TRTC_CALL=false 时 Vite 完全排除 AiAdvisorCall 及其 trtc-sdk-v5 依赖
// Vite 在构建时将 import.meta.env.VITE_USE_TRTC_CALL 替换为字面字符串，Rollup 再做死代码消除
const LazyAiAdvisorCall = USE_VOICE_CALL
  ? lazy(() =>
      import('../../components/AiAdvisorCall').then((m) => ({ default: m.AiAdvisorCall })),
    )
  : null

// ─── 路由白名单 ────────────────────────────────────────────

const ALLOWED_ROUTE_PREFIXES = [
  '/resume', '/resume/', '/print/', '/scan/', '/jobs', '/job-fairs', '/renshi', '/qingdao',
] as const

function isAllowedRoute(route: string): boolean {
  return ALLOWED_ROUTE_PREFIXES.some((p) => route === p || route.startsWith(`${p}/`))
}

// ─── 快捷操作 ─────────────────────────────────────────────

const SHORTCUTS: AssistantAction[] = [
  { label: '简历服务',  route: '/resume'        },
  { label: '打印文件',  route: '/print/upload'  },
  { label: '查看岗位',  route: '/jobs'          },
  { label: '查看招聘会', route: '/job-fairs'    },
  { label: '人社专区',  route: '/renshi'        },
]

const SHORTCUT_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  '/resume':        FileTextIcon,
  '/print/upload':  PrinterIcon,
  '/jobs':          BriefcaseIcon,
  '/job-fairs':     CalendarDaysIcon,
  '/renshi':        LandmarkIcon,
}

const KEYWORD_ROUTES: Array<{ kw: readonly string[]; route: string }> = [
  { kw: ['简历', '诊断', '优化', 'resume'],          route: '/resume'        },
  { kw: ['打印', '文件', '印刷'],                    route: '/print/upload'  },
  { kw: ['岗位', '工作', '职位', '招聘', '找工作'],  route: '/jobs'          },
  { kw: ['招聘会', '双选会', '人才市场'],             route: '/job-fairs'     },
  { kw: ['人社', '社保', '政策', '补贴'],             route: '/renshi'        },
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

// 共享触控终端：每次进入助手页面都生成全新 sessionId，
// 防止上一位用户的对话上下文泄露给下一位用户。
// 不持久化到 localStorage — 刷新/离开即隔离。
function newSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ─── 消息类型 ─────────────────────────────────────────────

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
  text: '您好！我是 AI 就业服务助手，可以帮您简历诊断、打印文件或查看岗位信息。请问有什么需要帮忙的？',
}

// ─── 主组件 ───────────────────────────────────────────────

export function AssistantPage() {
  const navigate = useNavigate()

  const [mode, setMode] = useState<'call' | 'text'>(USE_VOICE_CALL ? 'call' : 'text')

  // ── 通话模式：渲染 TRTC 组件（懒加载，flag 关闭时 trtc chunk 不进构建）──
  if (mode === 'call' && LazyAiAdvisorCall) {
    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center bg-gray-900">
            <p className="text-sm text-gray-400">通话模块加载中…</p>
          </div>
        }
      >
        <LazyAiAdvisorCall
          onSwitchToText={() => setMode('text')}
          onExit={() => navigate(-1)}
        />
      </Suspense>
    )
  }

  // ── 文字模式 ──────────────────────────────────────────────
  return <TextChat onSwitchToCall={USE_VOICE_CALL ? () => setMode('call') : undefined} />
}

// ─── 文字对话子组件 ────────────────────────────────────────

function TextChat({ onSwitchToCall }: { onSwitchToCall?: () => void }) {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)

  const sessionIdRef = useRef(newSessionId())
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

    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text }])
    setInput('')
    setLoading(true)

    try {
      const resp = await chatWithAssistant({ message: text, sessionId: sessionIdRef.current })
      if (cancelledRef.current) return
      sessionIdRef.current = resp.sessionId

      const safeActions = resp.actions?.filter((a) => isAllowedRoute(a.route))
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: 'assistant', text: resp.reply, actions: safeActions?.length ? safeActions : undefined },
      ])
    } catch {
      if (cancelledRef.current) return
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: 'assistant', text: 'AI 服务暂不可用，请稍后再试', isError: true },
      ])
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [input, loading])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() }
    },
    [handleSend],
  )

  const contextActions = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === 'assistant') return messages[i]!.actions
    }
    return undefined
  }, [messages])
  const matchedRoutes = useMemo(() => getMatchedRoutes(input), [input])

  return (
    <div className="flex h-full flex-col bg-gray-50">

      {/* 顶栏 */}
      <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-gray-500 hover:text-gray-900 text-sm"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          返回
        </button>
        <p className="text-sm font-medium text-gray-700">AI 就业服务助手</p>
        {onSwitchToCall ? (
          <button
            type="button"
            onClick={onSwitchToCall}
            className="flex min-h-[48px] items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 active:bg-blue-200 transition-colors"
          >
            <MicIcon className="h-4 w-4" />
            语音通话
          </button>
        ) : <span className="w-12" />}
      </div>

      {/* 对话历史 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-4">
          {messages.map((msg) => <ChatBubble key={msg.id} msg={msg} />)}
          {loading && (
            <div className="flex items-center gap-1.5 w-fit rounded-2xl bg-gray-100 px-4 py-3">
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 快捷操作 */}
      <div className="shrink-0 border-t border-gray-100 bg-white px-4 pt-2 pb-1">
        {contextActions && contextActions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {contextActions.map((a) => (
              <button
                key={a.route}
                type="button"
                onClick={() => navigate(a.route)}
                className="min-h-[48px] rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 pb-2">
          <div className="mr-1 flex shrink-0 items-center gap-1">
            <ZapIcon className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-medium text-neutral-500">快捷入口</span>
          </div>
          {SHORTCUTS.map((s) => {
            const Icon = SHORTCUT_ICON_MAP[s.route]
            return (
              <button
                key={s.route}
                type="button"
                onClick={() => navigate(s.route)}
                className={`flex min-h-[48px] items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors border
                  ${matchedRoutes.has(s.route)
                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                    : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-gray-200 bg-white p-4">
        <div className="flex items-end gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，例如：如何优化我的简历？"
            rows={2}
            disabled={loading}
            className="min-h-[60px] flex-1 resize-none rounded-xl border border-gray-300 px-4 py-3.5 text-base leading-relaxed text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 disabled:bg-gray-50"
          />
          <Button
            size="lg"
            onClick={() => void handleSend()}
            disabled={!input.trim() || loading}
            aria-label="发送消息"
            className="h-16 w-16 shrink-0 rounded-xl"
          >
            <SendHorizontalIcon className="h-6 w-6" />
          </Button>
        </div>
        <p className="mt-2 text-center text-xs text-gray-400">AI 回复内容仅供参考，不构成正式建议</p>
      </div>
    </div>
  )
}

// ─── 气泡组件 ─────────────────────────────────────────────

function ChatBubble({ msg }: { msg: Message }) {
  const isUser  = msg.role === 'user'
  const isError = msg.isError === true
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`flex max-w-[80%] flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={
          isUser  ? 'rounded-2xl rounded-br-sm bg-blue-600 px-4 py-3 text-sm text-white'
          : isError ? 'flex items-start gap-2 rounded-2xl rounded-bl-sm bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700'
          : 'rounded-2xl rounded-bl-sm bg-white border border-gray-200 px-4 py-3 text-sm text-gray-900'
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
