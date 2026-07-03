// ============================================================
// AssistantPage — 腾讯 TRTC 实时语音通话（页内嵌入面板版）
//
// 2026-07-03 用户确认的最终形态：
//   - 进入页面 = 落地页（小青 hero + 语音/文字双模式入口 + 文字咨询）
//   - 点「语音通话」卡 → 页内展开墨绿通话面板（AssistantCallPanel），
//     不再有独立全屏通话页；挂断/改用文字 → 面板收起，页面上下文不丢失
//   - TRTC 会话逻辑在 hooks/useAiAdvisorCallSession.ts（原 AiAdvisorCall
//     逐行搬移，卸载自动挂断 + 后端 stop 不持续计费）
//
// 合规约束：
//   - 跳转只允许白名单路由，不出现一键投递
//   - AI 回复标注"内容仅供参考"
// ============================================================

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import type { AssistantAction, AssistantSkill } from '@ai-job-print/shared'
import { KIcon, type KioskIconName } from '../../components/kiosk-icon'
import { KioskKeyboard } from '../../components/kiosk-keyboard/KioskKeyboard'
import { useInkRipple } from '../../hooks/useInkRipple'
import { chatWithAssistant } from '../../services/api'
import './assistant-inkpaper.css'

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

// ─── 快捷任务（真实既有路由；原型 quick-grid 语汇） ─────────

interface QuickTask {
  label: string
  desc: string
  route: string
  icon: KioskIconName
  variant: '' | 'v2' | 'v3' | 'v4'
}

const QUICK_TASKS: QuickTask[] = [
  { label: '简历服务', desc: '诊断、优化、打印，一次完成', route: '/resume/source', icon: 'resume', variant: '' },
  { label: '打印文件', desc: '上传文件，本机直接出纸', route: '/print/upload', icon: 'printer', variant: 'v3' },
  { label: '查看岗位', desc: '第三方来源岗位，去来源平台投递', route: '/jobs', icon: 'briefcase', variant: 'v2' },
  { label: '查看招聘会', desc: '查看场次信息，去来源平台预约', route: '/job-fairs', icon: 'fair', variant: 'v4' },
  { label: '政策服务', desc: '补贴、档案、登记材料指引', route: '/renshi', icon: 'policy', variant: 'v3' },
]

const KEYWORD_ROUTES: Array<{ kw: readonly string[]; route: string }> = [
  { kw: ['简历', '诊断', '优化', 'resume'],          route: '/resume/source' },
  { kw: ['打印', '文件', '印刷'],                    route: '/print/upload'  },
  { kw: ['岗位', '工作', '职位', '招聘', '找工作'],  route: '/jobs'          },
  { kw: ['招聘会', '双选会', '人才市场'],             route: '/job-fairs'     },
  { kw: ['人社', '社保', '政策', '补贴'],             route: '/renshi'        },
]

// ─── 大家都在问（点击即向小青提问，走真实对话链路） ─────────

const FAQ_QUESTIONS = [
  '应届生没什么经验，简历怎么写工作经历？',
  '简历打印用什么纸、什么格式比较合适？',
  '灵活就业社保补贴怎么申请？需要什么材料？',
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
  text: '您好！我是小青，可以帮您简历诊断、打印文件或查看岗位信息。请问有什么需要帮忙的？',
}

// ─── 主组件 ───────────────────────────────────────────────

export function AssistantPage() {
  return <TextChat voiceAvailable={USE_VOICE_CALL} />
}

// ─── 落地页 + 对话 + 页内通话面板 ──────────────────────────

function TextChat({ voiceAvailable }: { voiceAvailable: boolean }) {
  // 页内通话面板开关：点「语音通话」卡展开（点击手势满足自动播放策略），
  // 挂断 / 改用文字 / 点「文字对话」卡收起（面板卸载即自动挂断 + 后端 stop）。
  const [callActive, setCallActive] = useState(false)
  // 页内虚拟键盘：公共触控终端无物理键盘，点输入框弹出、点别处收起。
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const navigate = useNavigate()
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
  useInkRipple('.kassist .mode-btn, .kassist .quick, .kassist .faq, .kassist .action-chip, .kassist .send-btn, .kassist .ka-back')

  const sessionIdRef = useRef(newSessionId())
  const cancelledRef = useRef(false)
  const previousSkillRef = useRef<ToolboxAssistantSkill | undefined>(toolboxSkill)
  const requestTokenRef = useRef(0)
  const bottomRef    = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // StrictMode（dev）会 mount→unmount→再 mount：必须在每次 mount 时重置为 false，
    // 否则上一次卸载 cleanup 置的 true 会残留，导致回复被丢弃且 loading 永不复位。
    cancelledRef.current = false
    return () => { cancelledRef.current = true }
  }, [])

  useEffect(() => {
    // block:'nearest'：只滚动对话列表自身，不带动整页跳动
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, loading])

  // 键盘弹出时把输入框滚到视口中上部，避免被底部键盘遮住
  useEffect(() => {
    if (keyboardOpen) inputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [keyboardOpen])

  useEffect(() => {
    if (previousSkillRef.current === toolboxSkill) return
    previousSkillRef.current = toolboxSkill
    requestTokenRef.current += 1
    sessionIdRef.current = newSessionId()
    setMessages([welcomeMessage])
    setInput('')
    setLoading(false)
  }, [toolboxSkill, welcomeMessage])

  const sendMessage = useCallback(async (raw: string) => {
    const text = raw.trim()
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
  }, [loading, toolboxSkill])

  const handleSend = useCallback(() => { void sendMessage(input) }, [input, sendMessage])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
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
    <div className="kassist">
      <div className="ka-inner">

        {/* 返回 */}
        <button type="button" className="ka-back" onClick={() => navigate(-1)}>
          <KIcon name="arrow" />
          返回
        </button>

        {/* ── 小青 hero ── */}
        <section className="a-hero">
          <div className="qing-portrait">
            <span className="live"><i className="dot" aria-hidden="true" />在线</span>
            <img src="/assets/ai-advisor.png" alt="就业服务顾问小青" />
          </div>
          <div className="a-hero-copy">
            <div className="eyebrow">
              <KIcon name="sparkle" />
              就业服务顾问 · 小青
            </div>
            <h1>
              把问题说清楚，
              <br />
              再把结果变成材料。
            </h1>
            <p>小青负责简历问诊、面试追问、打印前检查和政策问答；问答内容仅在本次会话内参考，如需形成简历、面试报告或打印材料，请进入对应功能页生成和保存。</p>
            <div className="a-pills">
              {voiceAvailable && (
                <span className="a-pill">
                  <KIcon name="mic" />
                  语音通话在线
                </span>
              )}
              <span className="a-pill">
                <KIcon name="chat" />
                文字对话
              </span>
              <span className="a-pill">
                <KIcon name="shield" />
                仅本次会话参考
              </span>
            </div>
          </div>
        </section>

        {/* ── 语音 / 文字 双入口 ── */}
        <div className={voiceAvailable ? 'mode-toggle' : 'mode-toggle single'}>
          {voiceAvailable && (
            <button
              type="button"
              className={callActive ? 'mode-btn call on' : 'mode-btn call'}
              aria-pressed={callActive}
              onClick={() => setCallActive(true)}
            >
              <span className="mbi"><KIcon name="mic" /></span>
              <div>
                <strong>语音通话</strong>
                <span>{callActive ? '通话面板已开启' : '像打电话一样问小青'}</span>
              </div>
            </button>
          )}
          <button
            type="button"
            className={callActive ? 'mode-btn text' : 'mode-btn text on'}
            aria-pressed={!callActive}
            onClick={() => (callActive ? setCallActive(false) : inputRef.current?.focus())}
          >
            <span className="mbi"><KIcon name="chat" /></span>
            <div>
              <strong>文字对话</strong>
              <span>打字咨询、离开自动清空</span>
            </div>
          </button>
        </div>

        {/* ── 页内语音通话面板（点「语音通话」展开；挂断/改用文字收起） ── */}
        {voiceAvailable && callActive && LazyCallPanel && (
          <Suspense
            fallback={
              <section className="call-panel">
                <div className="call-meta">通话模块加载中…</div>
              </section>
            }
          >
            <LazyCallPanel onEnd={() => setCallActive(false)} />
          </Suspense>
        )}

        {/* ── 本次咨询 ── */}
        <section className="panel" aria-live="polite">
          <div className="panel-head">
            <h2>{toolboxScene?.title ?? '本次咨询'}</h2>
            <span className="tag">共享终端 · 离开自动清空</span>
          </div>

          <div className="chat-list">
            {messages.map((msg) => <ChatBubble key={msg.id} msg={msg} />)}
            {loading && (
              <div className="typing" aria-label="小青正在回复">
                <i /><i /><i />
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {contextActions && contextActions.length > 0 && (
            <div className="action-chips">
              {contextActions.map((a) => (
                <button key={a.route} type="button" className="action-chip" onClick={() => navigate(a.route)}>
                  {a.label}
                </button>
              ))}
            </div>
          )}

          <div className="input-bar">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => !loading && setKeyboardOpen(true)}
              onClick={() => !loading && setKeyboardOpen(true)}
              // 公共终端用页内虚拟键盘：抑制系统软键盘，但保留光标可编辑
              inputMode="none"
              placeholder={toolboxScene?.placeholder ?? '点这里，用下方键盘输入问题'}
              rows={1}
              disabled={loading}
            />
            <button
              type="button"
              className="send-btn"
              onClick={handleSend}
              disabled={!input.trim() || loading}
              aria-label="发送消息"
            >
              <KIcon name="send" />
            </button>
          </div>
          <p className="disclaimer">{toolboxScene?.disclaimer ?? 'AI 回复内容仅供参考，不构成正式建议'}</p>
        </section>

        {/* ── 快捷任务（真实路由；输入关键词命中时高亮） ── */}
        <div className="sec-head">
          <span className="rail" aria-hidden="true" />
          <div>
            <h2>快捷任务</h2>
            <p>点一下直达对应功能页。</p>
          </div>
        </div>
        <div className="quick-grid">
          {QUICK_TASKS.map((task) => (
            <button
              key={task.route}
              type="button"
              className={['quick', task.variant, matchedRoutes.has(task.route) ? 'hit' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => navigate(task.route)}
            >
              <span className="qi"><KIcon name={task.icon} /></span>
              <div>
                <strong>{task.label}</strong>
                <span>{task.desc}</span>
              </div>
            </button>
          ))}
        </div>

        {/* ── 大家都在问（点击直接发给小青） ── */}
        <div className="sec-head">
          <span className="rail slate" aria-hidden="true" />
          <div>
            <h2>大家都在问</h2>
            <p>点击直接向小青提问。</p>
          </div>
        </div>
        <div className="faq-list">
          {FAQ_QUESTIONS.map((q) => (
            <button key={q} type="button" className="faq" onClick={() => void sendMessage(q)} disabled={loading}>
              <span className="q">Q</span>
              <strong>{q}</strong>
              <KIcon name="arrow" />
            </button>
          ))}
        </div>

        {/* ── 结果去哪儿 ── */}
        <div className="sec-head">
          <span className="rail plum" aria-hidden="true" />
          <div>
            <h2>结果去哪儿</h2>
            <p>助手问答仅本次会话内参考；正式材料请到对应功能页生成和保存。</p>
          </div>
        </div>
        <div className="result-strip">
          <div className="result-card">
            <span className="ri"><KIcon name="doc-check" /></span>
            <strong>去简历服务</strong>
            <span>问答建议仅供参考；简历需到「简历服务」按流程生成和保存。</span>
          </div>
          <div className="result-card v2">
            <span className="ri"><KIcon name="receipt" /></span>
            <strong>去模拟面试</strong>
            <span>面试复盘报告需到「模拟面试」功能生成和保存，助手不直接出报告。</span>
          </div>
          <div className="result-card v3">
            <span className="ri"><KIcon name="printer" /></span>
            <strong>去打印</strong>
            <span>纸质材料需到「打印」功能生成和输出，助手问答不直接出件。</span>
          </div>
        </div>

        <p className="compliance">
          <KIcon name="shield" />
          AI 助手问答仅本次会话内参考，不构成正式建议；如需形成简历、面试报告或打印材料，请进入对应功能页生成和保存；岗位投递与招聘会预约请前往来源平台完成。
        </p>
      </div>

      {/* 页内悬浮虚拟键盘：点输入框弹出、点别处收起 */}
      <KioskKeyboard
        open={keyboardOpen}
        value={input}
        onChange={setInput}
        onEnter={handleSend}
        onClose={() => {
          setKeyboardOpen(false)
          inputRef.current?.blur()
        }}
      />
    </div>
  )
}

// ─── 气泡组件（v5 row/bava/bubble 语汇） ─────────────────────

function ChatBubble({ msg }: { msg: Message }) {
  const isUser  = msg.role === 'user'
  const isError = msg.isError === true

  if (isUser) {
    return (
      <div className="row me">
        <span className="bava me"><KIcon name="user" /></span>
        <div className="bubble me">{msg.text}</div>
      </div>
    )
  }

  return (
    <div className="row">
      <span className="bava bot">
        <img src="/assets/ai-advisor.png" alt="小青" />
      </span>
      {isError ? (
        <div className="bubble err">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5" />
            <path d="M12 16.5h.01" />
          </svg>
          <span>{msg.text}</span>
        </div>
      ) : (
        <div className="bubble bot">
          {msg.text}
          <span className="ref">内容仅供参考</span>
        </div>
      )}
    </div>
  )
}
