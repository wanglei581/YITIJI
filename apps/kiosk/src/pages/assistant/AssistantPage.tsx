// ============================================================
// AssistantPage — 腾讯 TRTC 实时语音通话（页内嵌入面板版）
//
// 2026-07-03 用户确认：取消独立全屏通话页（AiAdvisorCall.tsx 已删除）——
//   - 进入页面 = 文字对话（不再进页自动通话）
//   - 点「语音通话」→ 顶栏下方展开页内通话面板（AssistantCallPanel）；
//     挂断/改用文字 → 面板收起，对话上下文全程保留
//   - TRTC 会话逻辑在 hooks/useAiAdvisorCallSession.ts（原组件逐行搬移，
//     卸载自动挂断 + 后端 stop 不持续计费）
//   - 文字输入接页内拼音虚拟键盘（公共触控终端无物理键盘）
//
// 合规约束：
//   - 跳转只允许白名单路由，不出现一键投递
//   - AI 回复标注"内容仅供参考"
// ============================================================

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useBusyLock } from '../../contexts/KioskBusyContext'
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
import type { AssistantAction, AssistantSkill } from '@ai-job-print/shared'
import { KioskKeyboard } from '../../components/kiosk-keyboard/KioskKeyboard'
import { chatWithAssistant } from '../../services/api'

// 是否启用 TRTC 语音通话（需后端配置凭证 + 安装 trtc-sdk-v5）
const USE_VOICE_CALL = import.meta.env.VITE_USE_TRTC_CALL === 'true'

if (import.meta.env.DEV && !USE_VOICE_CALL) {
  console.warn('[assistant] 数字人未启用：本地联调数字人需设置 VITE_USE_TRTC_CALL=true。')
}

// 条件式懒加载：VITE_USE_TRTC_CALL=false 时 Vite 完全排除通话面板及其 trtc-sdk-v5 依赖
// Vite 在构建时将 import.meta.env.VITE_USE_TRTC_CALL 替换为字面字符串，Rollup 再做死代码消除
const LazyCallPanel = USE_VOICE_CALL
  ? lazy(() =>
      import('./AssistantCallPanel').then((m) => ({ default: m.AssistantCallPanel })),
    )
  : null

// ─── 路由白名单 ────────────────────────────────────────────

const ALLOWED_ROUTE_PREFIXES = [
  '/resume', '/resume/', '/print/', '/scan/', '/jobs', '/job-fairs', '/renshi',
] as const

function isAllowedRoute(route: string): boolean {
  return ALLOWED_ROUTE_PREFIXES.some((p) => route === p || route.startsWith(`${p}/`))
}

// ─── 快捷操作 ─────────────────────────────────────────────

const SHORTCUTS: AssistantAction[] = [
  { label: '简历服务',  route: '/resume/source' },
  { label: '打印文件',  route: '/print/upload'  },
  { label: '查看岗位',  route: '/jobs'          },
  { label: '查看招聘会', route: '/job-fairs'    },
  { label: '政策服务',  route: '/renshi'        },
]

const SHORTCUT_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  '/resume/source': FileTextIcon,
  '/print/upload':  PrinterIcon,
  '/jobs':          BriefcaseIcon,
  '/job-fairs':     CalendarDaysIcon,
  '/renshi':        LandmarkIcon,
}

const KEYWORD_ROUTES: Array<{ kw: readonly string[]; route: string }> = [
  { kw: ['简历', '诊断', '优化', 'resume'],          route: '/resume/source' },
  { kw: ['打印', '文件', '印刷'],                    route: '/print/upload'  },
  { kw: ['岗位', '工作', '职位', '招聘', '找工作'],  route: '/jobs'          },
  { kw: ['招聘会', '双选会', '人才市场'],             route: '/job-fairs'     },
  { kw: ['人社', '社保', '政策', '补贴'],             route: '/renshi'        },
]

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
  return <TextChat voiceAvailable={USE_VOICE_CALL} />
}

// ─── 文字对话子组件（含页内通话面板 + 虚拟键盘） ────────────

function TextChat({ voiceAvailable }: { voiceAvailable: boolean }) {
  const navigate = useNavigate()
  // 页内通话面板开关：点「语音通话」展开（点击手势满足自动播放策略），
  // 挂断/再点一次收起（面板卸载即自动挂断 + 后端 stop）。
  const [callActive, setCallActive] = useState(false)
  // 页内虚拟键盘：点输入框弹出、点别处收起。
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [searchParams] = useSearchParams()
  const toolboxSkill = useMemo(() => normalizeToolboxSkill(searchParams.get('intent')), [searchParams])
  const toolboxScene = toolboxSkill ? TOOLBOX_ASSISTANT_SCENES[toolboxSkill] : undefined
  const welcomeMessage = useMemo<Message>(() => (
    toolboxScene
      ? { id: `welcome-${toolboxSkill}`, role: 'assistant', text: toolboxScene.welcome }
      : WELCOME
  ), [toolboxSkill, toolboxScene])
  const [messages, setMessages] = useState<Message[]>(() => [welcomeMessage])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  // AI 正在回复:禁止进入待机宣传屏(评审 bug #1)
  useBusyLock(loading)

  const sessionIdRef = useRef(newSessionId())
  const cancelledRef = useRef(false)
  const previousSkillRef = useRef<ToolboxAssistantSkill | undefined>(toolboxSkill)
  const requestTokenRef = useRef(0)
  const bottomRef    = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // StrictMode（dev）会 mount→unmount→再 mount：必须在每次 mount 时重置为 false，
    // 否则上一次卸载 cleanup 置的 true 会残留，导致回复被丢弃且 loading 永不复位。
    cancelledRef.current = false
    return () => { cancelledRef.current = true }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (previousSkillRef.current === toolboxSkill) return
    previousSkillRef.current = toolboxSkill
    requestTokenRef.current += 1
    sessionIdRef.current = newSessionId()
    setMessages([welcomeMessage])
    setInput('')
    setLoading(false)
  }, [toolboxSkill, welcomeMessage])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return
    const requestSessionId = sessionIdRef.current
    const requestToken = requestTokenRef.current + 1
    requestTokenRef.current = requestToken

    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text }])
    setInput('')
    setLoading(true)

    try {
      const resp = await chatWithAssistant({
        message: text,
        sessionId: requestSessionId,
        skill: toolboxSkill,
        context: toolboxSkill ? { source: 'toolbox_ai_skill' } : undefined,
      })
      if (cancelledRef.current) return
      if (requestTokenRef.current !== requestToken || sessionIdRef.current !== requestSessionId) return
      sessionIdRef.current = resp.sessionId

      const safeActions = resp.actions?.filter((a) => isAllowedRoute(a.route))
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: 'assistant', text: resp.reply, actions: safeActions?.length ? safeActions : undefined },
      ])
    } catch {
      if (cancelledRef.current) return
      if (requestTokenRef.current !== requestToken || sessionIdRef.current !== requestSessionId) return
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: 'assistant', text: 'AI 服务暂不可用，请稍后再试', isError: true },
      ])
    } finally {
      if (!cancelledRef.current && requestTokenRef.current === requestToken) setLoading(false)
    }
  }, [input, loading, toolboxSkill])

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
    <div className="flex h-full flex-col bg-neutral-50">

      {/* 顶栏 */}
      <div className="shrink-0 flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-neutral-500 hover:text-neutral-900 text-sm"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          返回
        </button>
        <p className="text-sm font-medium text-neutral-700">{toolboxScene?.title ?? 'AI 就业服务助手'}</p>
        {voiceAvailable ? (
          <button
            type="button"
            onClick={() => setCallActive((v) => !v)}
            aria-pressed={callActive}
            className={`flex min-h-[48px] items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              callActive
                ? 'border-primary-600 bg-primary-600 text-white active:bg-primary-700'
                : 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 active:bg-primary-200'
            }`}
          >
            <MicIcon className="h-4 w-4" />
            {callActive ? '通话中' : '语音通话'}
          </button>
        ) : <span className="w-12" />}
      </div>

      {/* 页内语音通话面板：点「语音通话」展开；挂断/改用文字收起 */}
      {voiceAvailable && callActive && LazyCallPanel && (
        <Suspense
          fallback={
            <section className="acp">
              <div className="acp-meta">通话模块加载中…</div>
            </section>
          }
        >
          <LazyCallPanel onEnd={() => setCallActive(false)} />
        </Suspense>
      )}

      {/* 对话历史 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-4">
          {messages.map((msg) => <ChatBubble key={msg.id} msg={msg} />)}
          {loading && (
            <div className="flex items-center gap-1.5 w-fit rounded-2xl bg-neutral-100 px-4 py-3">
              <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-400" />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 快捷操作 */}
      <div className="shrink-0 border-t border-neutral-100 bg-white px-4 pt-2 pb-1">
        {contextActions && contextActions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {contextActions.map((a) => (
              <button
                key={a.route}
                type="button"
                onClick={() => navigate(a.route)}
                className="min-h-[48px] rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100 transition-colors"
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 pb-2">
          <div className="mr-1 flex shrink-0 items-center gap-1">
            <ZapIcon className="h-3.5 w-3.5 text-warning" />
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
                    ? 'border-warning/50 bg-warning-bg text-warning-fg'
                    : 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100'}`}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-neutral-200 bg-white p-4">
        <div className="flex items-end gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => !loading && setKeyboardOpen(true)}
            onClick={() => !loading && setKeyboardOpen(true)}
            // 公共终端用页内虚拟键盘：抑制系统软键盘，但保留光标可编辑
            inputMode="none"
            placeholder={toolboxScene?.placeholder ?? '点这里，用屏幕键盘输入问题'}
            rows={2}
            disabled={loading}
            className="min-h-[60px] flex-1 resize-none rounded-xl border border-neutral-300 px-4 py-3.5 text-base leading-relaxed text-neutral-900 placeholder:text-neutral-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20 disabled:bg-neutral-50"
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
        <p className="mt-2 text-center text-xs text-neutral-400">{toolboxScene?.disclaimer ?? 'AI 回复内容仅供参考，不构成正式建议'}</p>
      </div>

      {/* 页内悬浮虚拟键盘：点输入框弹出、点别处收起（拼音/英文/符号三模式） */}
      <KioskKeyboard
        open={keyboardOpen}
        value={input}
        onChange={setInput}
        onEnter={() => void handleSend()}
        onClose={() => {
          setKeyboardOpen(false)
          inputRef.current?.blur()
        }}
      />
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
          isUser  ? 'rounded-2xl rounded-br-sm bg-primary-600 px-4 py-3 text-sm text-white'
          : isError ? 'flex items-start gap-2 rounded-2xl rounded-bl-sm bg-error-bg border border-error/30 px-4 py-3 text-sm text-error-fg'
          : 'rounded-2xl rounded-bl-sm bg-white border border-neutral-200 px-4 py-3 text-sm text-neutral-900'
        }>
          {isError && <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-error-fg" />}
          <span>{msg.text}</span>
        </div>
        {!isUser && !isError && (
          <p className="mt-1 px-1 text-xs text-neutral-400">内容仅供参考</p>
        )}
      </div>
    </div>
  )
}
