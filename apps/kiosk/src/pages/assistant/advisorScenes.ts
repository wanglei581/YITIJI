// ============================================================
// advisorScenes — AI顾问专项技能场景文案 + 会话工具
//
// 从 AssistantPage.tsx 拆出（CLAUDE.md §8：单文件 500 行以上新增功能前必须评估
// 拆分）。这里只有**静态文案与纯函数**，不含状态、不含请求、不含 JSX。
// 页面语法（任务选择 → 真实对话 → 独立输入区）与请求组装仍在 AssistantPage.tsx。
// ============================================================

import type { AssistantAction, AssistantSkill } from '@ai-job-print/shared'
import type { KioskIconName } from '../../components/kiosk-icon'

export interface ConsultationTask {
  id: 'resume' | 'interview' | 'jobs' | 'workplace'
  label: string
  description: string
  icon: KioskIconName
  welcome: string
  questions: readonly string[]
  serviceActions: readonly AssistantAction[]
}

/**
 * 四个咨询主题。`serviceActions` 是**不依赖模型**的真实直达入口 ——
 * 后端没返回 action 时它们照常出现，AI 挂掉时它们也照常可点。
 */
export const CONSULTATION_TASKS: readonly ConsultationTask[] = [
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
      { label: '自我探索', route: '/resume/self-assessment/intro' },
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

export type ToolboxAssistantSkill = AssistantSkill

export interface ToolboxAssistantScene {
  title: string
  welcome: string
  placeholder: string
  disclaimer: string
}

export const TOOLBOX_ASSISTANT_SCENES: Record<ToolboxAssistantSkill, ToolboxAssistantScene> = {
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

export function normalizeToolboxSkill(value: string | null): ToolboxAssistantSkill | undefined {
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

export const GENERAL_QUESTIONS = [
  '应届生没什么经验，简历怎么写工作经历？',
  '简历打印用什么纸、什么格式比较合适？',
  '灵活就业社保补贴怎么申请？需要什么材料？',
] as const

// 共享触控终端每次进入或切换咨询主题都使用全新 sessionId，且不持久化。
export function newSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * AI 顾问不可用时仍然走得通的四条真实路径（S1 原语 `manual` 降级的 `manualPath`）。
 *
 * 「AI 是加速器不是前置条件」：用户来 P25 的目标是「不知道该用哪个功能」，
 * 这个目标不依赖模型也能达成 —— 直接进对应功能页即可。所以本页的降级是
 * `manual` 而不是 `blocked`：功能不消失，只是退化成用户自己点。
 *
 * 路由均来自 `routes/index.tsx` 的真实注册路径，不是占位。
 */
export const ADVISOR_MANUAL_ENTRIES = [
  { label: '打印扫描', route: '/print-scan', hint: '上传、扫描、复印，全程不经过 AI', icon: 'printer' },
  { label: '查看招聘会', route: '/job-fairs', hint: '场次、展位与来源平台预约入口', icon: 'fair' },
  { label: '政策服务', route: '/policy-service', hint: '人社政策与办事材料说明', icon: 'policy' },
  { label: 'AI简历服务', route: '/resume-service', hint: '简历上传与打印等不依赖模型的步骤照常', icon: 'resume' },
] as const satisfies readonly { label: string; route: string; hint: string; icon: KioskIconName }[]

// ============================================================
// 稿 05-ai-cockpit 的 12 态（2026-09-25 迁入运行时）
//
// 稿里 12 态靠 ?state= 切换；运行时**不接受** URL 指定状态 —— 每一态都只能由
// 真实信号推出来：请求是否在飞、上一轮返回的 kind、实测可用性、草稿、语音相位。
// 所以这里只有一个纯函数 + 文案表，不含任何计时器或假进度。
// ============================================================

export type CockpitVoiceState = 'voice-gate' | 'voice-connecting' | 'voice-live' | 'mic-denied' | 'voice-error'

export type CockpitState =
  | 'default' | 'composer' | 'submitting'
  | 'reply-real' | 'reply-not-ai' | 'reply-error' | 'ai-unavailable'
  | CockpitVoiceState

export interface CockpitSignals {
  /** 语音面板打开时的真实相位（由 useAiAdvisorCallSession 上报），未打开为 null。 */
  voice: CockpitVoiceState | null
  /** `/assistant/chat` 请求是否真的在飞。 */
  loading: boolean
  /** 本次会话最后一轮的结果 kind；还没问过为 null。 */
  lastTurn: 'ai' | 'not-ai' | 'error' | null
  /** 只来自 `/assistant/chat` 的实测 providerLabel，未问过为 unknown。 */
  availability: 'available' | 'unavailable' | 'unknown'
  /** 输入框里有没有还没发出的字。 */
  hasDraft: boolean
}

/**
 * 真实信号 → 稿 05 的状态名。优先级即判定顺序：
 * 语音面板 > 请求在飞 > 本轮非 AI > 已确认不可用 > 在写下一条 > 本轮失败 > 本轮真实回答 > 初始。
 * 「在写下一条」排在失败之前：失败后用户重新打字，页面该跟着人走，而不是一直停在失败说明上。
 */
export function deriveCockpitState(signals: CockpitSignals): CockpitState {
  if (signals.voice) return signals.voice
  if (signals.loading) return 'submitting'
  if (signals.lastTurn === 'not-ai') return 'reply-not-ai'
  if (signals.availability === 'unavailable') return 'ai-unavailable'
  if (signals.hasDraft) return 'composer'
  if (signals.lastTurn === 'error') return 'reply-error'
  if (signals.lastTurn === 'ai') return 'reply-real'
  return 'default'
}

export interface CockpitCopy {
  /** 舱面标题：lead + 强调 + tail。强调段用翡翠色，其余白字。 */
  title: readonly [lead: string, em: string, tail: string]
  lede: string
  /** 顶栏状态胶囊。只复述本页已测到的事实。 */
  pill: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  /** 主体第一区的标题与右侧提示。 */
  section: readonly [title: string, hint: string]
}

export const COCKPIT_COPY: Record<CockpitState, CockpitCopy> = {
  default: {
    title: ['你想解决什么？', '', ''],
    lede: '选一件事，或直接点常见问题；不打字也能用。',
    pill: { tone: 'unknown', label: 'AI 状态待本轮返回确认' },
    section: ['点一下就能问', '点完落进输入框，可以改'],
  },
  composer: {
    title: ['这条问题', '还没有发出', '。'],
    lede: '可以接着改，也可以换一条再发。',
    pill: { tone: 'unknown', label: '尚未发送' },
    section: ['这条还没发出', '改完按右下角发送'],
  },
  submitting: {
    title: ['已发出，', '等服务返回', '。'],
    lede: '不显示百分比和阶段，只等真实结果。',
    pill: { tone: 'unknown', label: '等待本轮返回' },
    section: ['已发出，等真实结果', '请求在飞，没有阶段可报'],
  },
  'reply-real': {
    title: ['这一轮', '由真实模型回答', '。'],
    lede: '仅供参考；身份、资格与录用结果不由 AI 决定。',
    pill: { tone: 'ok', label: '真实模型已应答' },
    section: ['本次咨询', '回答带服务标识，仅供参考'],
  },
  'reply-not-ai': {
    title: ['这一轮', '不是 AI 生成', '。'],
    lede: '服务标识不带 llm: 前缀，正文不展示。',
    pill: { tone: 'warn', label: '非 AI 回复 · 正文不展示' },
    section: ['这一轮不是 AI 生成', '正文不予展示'],
  },
  'reply-error': {
    title: ['这一轮', '没连上', '。'],
    lede: '可以重试，也可以直接走下面四个入口。',
    pill: { tone: 'bad', label: '本轮失败 · 可重试' },
    section: ['这一轮没连上', '不猜原因，也不编回答'],
  },
  'ai-unavailable': {
    title: ['AI 顾问', '暂不可用', '。'],
    lede: '四个入口不经过 AI，照常能办。',
    pill: { tone: 'bad', label: '模型未接入' },
    section: ['AI 顾问暂不可用', '下面四项不经过 AI'],
  },
  'voice-gate': {
    title: ['语音', '默认关闭', '。'],
    lede: '按下开启之前，本页不申请麦克风。',
    pill: { tone: 'unknown', label: '语音默认关闭' },
    section: ['语音咨询默认关闭', '按下才可能请求麦克风'],
  },
  'voice-connecting': {
    title: ['正在', '尝试建立', '语音通道。'],
    lede: '能不能用，由真实服务返回确认。',
    pill: { tone: 'unknown', label: '语音尝试建立中' },
    section: ['正在尝试建立语音通道', '尚未接通'],
  },
  'voice-live': {
    title: ['语音通道', '已接通', '。'],
    lede: '字幕来自服务端，仅供参考；挂断即结束会话。',
    pill: { tone: 'ok', label: '语音已接通' },
    section: ['语音会话控制区', '挂断、切换文字都会结束会话'],
  },
  'mic-denied': {
    title: ['没拿到', '麦克风权限', '。'],
    lede: '现在只能听、不能说；文字咨询照常。',
    pill: { tone: 'warn', label: '麦克风权限被拒' },
    section: ['没拿到麦克风权限', '当前为只听模式'],
  },
  'voice-error': {
    title: ['语音通道', '没建立', '。'],
    lede: '不推测原因，改文字或重试都行。',
    pill: { tone: 'bad', label: '语音通道未建立' },
    section: ['语音通道没建立', '可改用文字'],
  },
}

/**
 * 「不经过 AI 也能办」展开态的子项。逐条取自目的页首屏已有的卡片文案，
 * 不编造能力；改目的页时要同步回来。取证（2026-09-25）：
 *   打印扫描 PrintScanHomePage 文档打印 / 手机扫码上传 / 材料扫描卡（扫描按设备回传格式保存，不写「生成 PDF」）；
 *   招聘会 JobFairsPage 卡片的时间·地点·来源 与底栏「查看入场入口」「看校园招聘」；
 *   政策服务 serviceHubSpecs policy 前三卡；简历服务只列不调模型的「简历打印」与需登录的「我的简历」。
 */
export const ADVISOR_MANUAL_DETAILS: Record<(typeof ADVISOR_MANUAL_ENTRIES)[number]['route'], readonly string[]> = {
  '/print-scan': ['文档打印：PDF / 图片上传后打印', '手机扫码上传：不用登录', '材料扫描：在打印机面板上扫描纸质材料'],
  '/job-fairs': ['招聘会列表：时间、地点与来源', '扫码预约：去来源平台完成', '查看入场入口 · 看校园招聘'],
  '/policy-service': ['就业、创业与灵活就业政策', '社保参保流程与材料说明', '档案托管、登记和证明材料'],
  '/resume-service': ['简历打印：选择文件、核价后在本机打印', '我的简历：登录后查看已保存版本'],
}
