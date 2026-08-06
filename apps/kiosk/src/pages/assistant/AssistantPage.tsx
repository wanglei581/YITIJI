// ============================================================
// AssistantPage — 4188 单列咨询工作台 + 腾讯 TRTC 页内通话
//
// 页面语法：任务选择 → 真实对话 → 独立输入区。TRTC 仍由 feature gate
// 条件式懒加载；共享终端的文字会话离开即清空，路由 action 只走白名单。
// ============================================================

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { KioskPageFrame } from '@ai-job-print/ui'
import type { AssistantAction, AssistantSkill } from '@ai-job-print/shared'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { KIcon, type KioskIconName } from '../../components/kiosk-icon'
import { KioskKeyboard } from '../../components/kiosk-keyboard/KioskKeyboard'
import { useInkRipple } from '../../hooks/useInkRipple'
import { chatWithAssistant } from '../../services/api'
import {
  Building2Icon,
  CrosshairIcon,
  HelpCircleIcon,
  ListChecksIcon,
  MailIcon,
  Mic2Icon,
  RouteIcon,
  ScanSearchIcon,
} from 'lucide-react'
import './assistant-inkpaper.css'
import './assistant-batch8.css'
import './assistant-advisor.css'

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
  '/resume', '/resume/', '/resume-service',
  '/print/', '/print-scan',
  '/scan/',
  '/jobs', '/job-fairs', '/fairs-service', '/jobs-service',
  '/interview', '/interview-service',
  '/renshi', '/policy-service',
  '/companies',
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
      { label: 'AI 简历服务', route: '/resume-service' },
      { label: '简历诊断', route: '/resume/source' },
      { label: '打印文件', route: '/print/upload' },
      { label: '自我探索', route: '/resume/self-assessment/intro?from=assistant' },
    ],
  },
  {
    id: 'interview',
    label: '面试与沟通',
    description: '面试准备、自我介绍与谈薪沟通',
    icon: 'chat',
    welcome: '请补充目标岗位、当前面试阶段，以及最想准备的问题。',
    questions: ['自我介绍应该怎么准备？', '面试常见问题怎么回答？', '谈薪时应该注意什么？'],
    serviceActions: [
      { label: 'AI 模拟面试', route: '/interview/setup' },
      { label: '查看岗位信息', route: '/jobs' },
    ],
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
      { label: '找企业', route: '/companies' },
    ],
  },
  {
    id: 'workplace',
    label: '入职与职场',
    description: '入职材料、试用期与社保公积金常识',
    icon: 'policy',
    welcome: '请补充所在地区、想了解的事项和当前阶段；具体规定请以当地官方信息为准。',
    questions: ['入职通常需要准备哪些材料？', '试用期有哪些常见注意事项？', '社保公积金应该怎样了解？'],
    serviceActions: [
      { label: '政策服务', route: '/policy-service' },
      { label: '政策与材料说明', route: '/renshi?tab=policy' },
    ],
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
  self_intro_gen: {
    title: 'AI 自我介绍生成',
    welcome: '这里是 AI 自我介绍生成助手。请告诉我你的目标岗位、主要经历（学习/实习/项目各1-2条）和想突出的优势，我会生成1分钟和3分钟两版文稿供你打印准备。内容仅供参考，请根据实际情况调整。',
    placeholder: '例如：应聘产品经理，211本科计算机，两段互联网实习，擅长数据分析和用户研究…',
    disclaimer: '生成内容仅供参考，请根据实际情况修改后使用',
  },
  material_checklist: {
    title: 'AI 材料准备清单',
    welcome: '这里是材料准备清单助手。告诉我你要参加的是面试、招聘会还是入职，以及岗位和公司类型，我会生成一份个性化材料清单，可直接在本机打印带走。具体要求以用人单位通知为准。',
    placeholder: '例如：明天参加国企校招现场面试，岗位是行政助理；或：下周参加IT行业校园招聘会…',
    disclaimer: '清单仅供参考，具体材料要求以用人单位通知为准',
  },
  jd_analysis: {
    title: 'AI 岗位 JD 解读',
    welcome: '这里是 AI 岗位 JD 解读助手。请粘贴或描述招聘要求，我会拆解每条要求的实际含义、区分硬性门槛与加分项，并提示面试时可能被重点考查的方向。解读内容仅供参考，不代表招聘方评价标准。',
    placeholder: '请粘贴 JD 内容，或描述关键要求，例如：要求3年Java开发，熟悉Spring，有分布式经验…',
    disclaimer: '解读仅供参考，不代表招聘方的录用标准或面试评分规则',
  },
  interview_questions: {
    title: 'AI 面试题预测',
    welcome: '这里是 AI 面试题预测助手。请告诉我目标岗位、公司类型和你的背景，我会整理8-10道该岗位高频面试题及参考回答思路，可直接打印带走练习。实际题目以招聘方为准。',
    placeholder: '例如：应聘互联网公司运营专员，985本科市场营销，有一段电商实习经历…',
    disclaimer: '预测题目仅供练习参考，实际面试问题以招聘方为准',
  },
  career_explore: {
    title: 'AI 求职方向探索',
    welcome: '这里是求职方向探索助手。如果你还不确定自己适合做什么，可以告诉我专业背景、感兴趣的领域或当前困惑，我们一起通过对话梳理可匹配的岗位方向和下一步行动路径。结果仅供个人参考。',
    placeholder: '例如：金融学本科，对互联网感兴趣，不知道适合哪个方向；或：想转行，有3年销售经验…',
    disclaimer: '探索结果仅供个人参考，不构成职业规划建议',
  },
  cover_letter_gen: {
    title: 'AI 求职信生成',
    welcome: '这里是 AI 求职信生成助手。请告诉我目标公司名称、岗位、你的核心经历和想打动对方的一两个点，我会生成一封300-500字的求职信，可直接在本机打印带走。内容仅供参考，请根据实际情况调整。',
    placeholder: '例如：应聘阿里巴巴运营岗，有两段互联网实习，擅长数据分析，希望体现执行力和对电商的热情…',
    disclaimer: '生成内容仅供参考，请根据实际情况修改后使用，不保证录用结果',
  },
  resume_jd_match: {
    title: 'AI 简历 JD 匹配',
    welcome: '这里是 AI 简历与 JD 匹配分析助手。请先粘贴或描述招聘要求，再告诉我你的核心经历和技能，我会给出匹配项、差距项，以及面试时如何弥补差距的建议。',
    placeholder: '例如：JD要求3年Java经验+分布式系统，我有2年Java经验、熟悉Spring，做过中型电商项目…',
    disclaimer: '匹配分析仅供参考，不代表招聘方的实际评分标准或录用决定',
  },
  company_research: {
    title: 'AI 企业面试速查',
    welcome: '这里是 AI 企业面试速查助手。告诉我你要面试的公司名称和岗位，我会整理该企业/行业的面试常见风格、可能的考察方向和建议提前了解的5个问题，帮你在5分钟内做好基础准备。',
    placeholder: '例如：明天去字节跳动面试产品经理，或：下午去华为面试硬件工程师…',
    disclaimer: '速查内容来自公开信息整理，不构成招聘方官方说明，请以官方渠道信息为准',
  },
}

function normalizeToolboxSkill(value: string | null): ToolboxAssistantSkill | undefined {
  const valid: ToolboxAssistantSkill[] = [
    'offer_compare', 'salary_negotiation', 'hr_qa',
    'self_intro_gen', 'material_checklist', 'jd_analysis',
    'interview_questions', 'career_explore',
    'cover_letter_gen', 'resume_jd_match', 'company_research',
  ]
  return valid.includes(value as ToolboxAssistantSkill)
    ? (value as ToolboxAssistantSkill)
    : undefined
}

// 共享触控终端每次进入或切换咨询主题都使用全新 sessionId，且不持久化。
function newSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** AI 专项工具入口数据（Approach B 页面卡片 + Approach A URL intent） */
interface AiTool {
  id: Extract<
    ToolboxAssistantSkill,
    | 'self_intro_gen' | 'material_checklist' | 'jd_analysis'
    | 'interview_questions' | 'career_explore'
    | 'cover_letter_gen' | 'resume_jd_match' | 'company_research'
  >
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  accent: 'teal' | 'clay' | 'slate' | 'plum' | 'wheat'
}

const AI_TOOLS: readonly AiTool[] = [
  {
    id: 'self_intro_gen',
    icon: Mic2Icon,
    title: 'AI 自我介绍生成',
    description: '描述经历，生成1/3分钟可打印文稿',
    accent: 'teal',
  },
  {
    id: 'cover_letter_gen',
    icon: MailIcon,
    title: 'AI 求职信生成',
    description: '描述公司岗位和经历，生成可打印求职信',
    accent: 'clay',
  },
  {
    id: 'material_checklist',
    icon: ListChecksIcon,
    title: 'AI 材料准备清单',
    description: '面试/招聘会前，生成个性化可打印清单',
    accent: 'slate',
  },
  {
    id: 'resume_jd_match',
    icon: CrosshairIcon,
    title: 'AI 简历 JD 匹配',
    description: '简历与岗位对比，找出差距和加分建议',
    accent: 'plum',
  },
  {
    id: 'jd_analysis',
    icon: ScanSearchIcon,
    title: 'AI 岗位 JD 解读',
    description: '拆解招聘要求，区分门槛与加分项',
    accent: 'wheat',
  },
  {
    id: 'interview_questions',
    icon: HelpCircleIcon,
    title: 'AI 面试题预测',
    description: '预测高频题目与回答思路，可打印带走',
    accent: 'teal',
  },
  {
    id: 'company_research',
    icon: Building2Icon,
    title: 'AI 企业面试速查',
    description: '面试前5分钟了解企业风格和考察方向',
    accent: 'clay',
  },
  {
    id: 'career_explore',
    icon: RouteIcon,
    title: 'AI 求职方向探索',
    description: '不知道做什么？对话梳理方向和行动路径',
    accent: 'plum',
  },
] as const

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
    <KioskPageFrame className="fusion-w3 fusion-w3--assistant">
    <section className="kassist kassist-lightflow" aria-labelledby="assistant-page-title">
      <h1 id="assistant-page-title" className="kassist-sr-only">AI顾问</h1>

      <div ref={workbenchRef} data-kiosk-domain="assistant" data-kiosk-screen="assistant" className="assistant-workbench">
        <header className="assistant-prototype-head">
          <span className="assistant-prototype-avatar" aria-hidden="true">青</span>
          <div>
            <span className="assistant-advisor-badge">AI 顾问</span>
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
                data-task-id={task.id}
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

        {/* AI 专项工具入口区：未激活特定技能时展示（Approach B） */}
        {!toolboxScene && <AiToolSection />}

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
    </section>
    </KioskPageFrame>
  )
}

function AdvisorAvatar() {
  return (
    <span className="assistant-message-avatar" aria-hidden="true">
      <img src="/assets/ai-advisor.png" alt="" />
    </span>
  )
}

/** AI 专项工具入口区（Approach B：页面内卡片；点击跳转至 ?intent= 激活对应技能） */
function AiToolSection() {
  const navigate = useNavigate()
  return (
    <section className="assistant-ai-tools" aria-labelledby="ai-tools-heading">
      <div className="assistant-ai-tools-header">
        <h2 id="ai-tools-heading">AI 专项工具</h2>
        <span>直接进入专项 AI 会话</span>
      </div>
      <div className="assistant-ai-tools-grid">
        {AI_TOOLS.map((tool) => {
          const Icon = tool.icon
          return (
            <button
              key={tool.id}
              type="button"
              className={`assistant-ai-tool-card adv-tool--${tool.accent}`}
              onClick={() => navigate(`/assistant?intent=${tool.id}`)}
            >
              <span className="aat-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="aat-body">
                <strong>{tool.title}</strong>
                <small>{tool.description}</small>
              </span>
            </button>
          )
        })}
      </div>
    </section>
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
        
      <span className="assistant-task" aria-hidden="true" style={{display:'none'}}>
        <span className="assistant-task-icon" />
      </span>
      <span className="assistant-direct-question" aria-hidden="true" style={{display:'none'}} />
      </div>
      )}
    </article>
  )
}
