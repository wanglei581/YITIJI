/**
 * 五个服务台（/resume-service /jobs-service /fairs-service /interview-service
 * /policy-service）的共享数据形状与降级判据。
 *
 * 为什么五页共用一份而不是各写各的：稿 16-service-hubs.html 本身就是一份 HTML 带
 * `?hub=` 渲染五种，五个 hub 的骨架、状态分支和诚实性声明的位置完全相同。拆成五份
 * 等于给「某一份漏抄一句诚实性声明」留五次机会——那正是这批迁移反复出问题的形态。
 *
 * `kind` 决定不可用态怎么说：稿把 AI 类和设备类**分开**，不可用时不是笼统灰掉，
 * 而是把「进入 →」换成具体原因。这是 CLAUDE.md §9「不伪造能力」的直接落地：
 * 说不清为什么不能用，就不该只是变灰。
 */
export type ServiceHubKey = 'resume' | 'jobs' | 'fairs' | 'interview' | 'policy'

/**
 * 能力的依赖类别。它决定**不可用时对用户怎么说**（以及图标配色），
 * 但**不单独决定能不能进**——那还要看下面的 needsBackend()。
 *
 * - `ai`      依赖后端 AI 能力（稿标注）
 * - `device`  依赖本机打印/扫描设备（稿标注）
 * - `info`    浏览/目录/静态内容（稿标注）
 * - `account` 本人在线台账（`/me/*`）。稿没有这一类，是从代码事实补的：旧壳
 *             五页的快捷入口在 `apiStatus !== 'ready'` 时一律 disabled，
 *             因为后端不可达时进去只能是错误页。沿用那条 fail-closed，
 *             但按「不伪造能力」要求把原因说成「在线服务」而不是「AI 能力」。
 */
export type CapabilityKind = 'ai' | 'device' | 'info' | 'account'

/**
 * 稿 16 给每张卡 / 每条常用入口标的图标键（`cards` 与 `quick` 的第 3 位）。
 *
 * 这一族键是**稿里的事实**，由抽取脚本机械带出，页面按 `HUB_ICON` 显式映射到 lucide。
 * 2026-09-20 修复前抽取丢了这个字段，页面改用「按标题正则猜图标」补位——
 * 于是「校园招聘」猜成文档（稿是 building）、「岗位匹配参考」猜成公文包（稿是 chart）。
 * 正则是猜，稿里的键是事实；不要再退回猜。
 */
export type HubIconKey =
  | 'file'
  | 'search'
  | 'edit'
  | 'brief'
  | 'building'
  | 'calendar'
  | 'map'
  | 'mic'
  | 'chart'
  | 'shield'
  | 'bot'
  | 'printer'
  | 'user'
  | 'external'

export interface HubCapability {
  title: string
  description: string
  /** 卡片右下角的来源/性质标注，例如「AI · 需核实」「确定性内容」「本人记录」。 */
  badge: string
  route: string
  kind: CapabilityKind
  /** 稿里标的图标键。不是按标题猜出来的。 */
  icon: HubIconKey
  /** 2.0 稿给部分卡写的「带走什么」（例如「带走：对照报告」）；没写就显示「进入」。 */
  go?: string
}

export interface HubGoal {
  label: string
  route: string
}

/** 稿里的「常用入口」（`quick`）：继续查看与管理，多数通向「我的」台账。 */
export interface HubQuickLink {
  title: string
  description: string
  route: string
  kind: CapabilityKind
  /** 稿里标的图标键。不是按标题猜出来的。 */
  icon: HubIconKey
}

export interface ServiceHubSpec {
  eyebrow: string
  title: string
  subtitle: string
  /** 首屏的目标分段：稿里叫 `first`，用来让用户先选目标再进流程。 */
  goals: HubGoal[]
  sectionTitle: string
  sectionHint: string
  capabilities: HubCapability[]
  quickLinks: HubQuickLink[]
  /** 合规与诚实性声明，稿里是 truthTitle / truth。**逐字保留，不许改写。** */
  truthTitle: string
  truth: string
  /** 次级说明，稿里是 noteTitle / note。 */
  noteTitle: string
  note: string
}

export const SERVICE_HUB_ROUTE: Record<ServiceHubKey, string> = {
  resume: '/resume-service',
  jobs: '/jobs-service',
  fairs: '/fairs-service',
  interview: '/interview-service',
  policy: '/policy-service',
}

/** 这一页当前的降级事实。各布尔量各自有独立来源，不要合并成一个「是否可用」。 */
export interface HubAvailability {
  /** 后端 /health 明确不可达（useApiReadiness === 'unavailable'）。 */
  apiDown: boolean
  /** 后端就绪探测尚未出结果（useApiReadiness === 'checking'）。 */
  apiChecking: boolean
  /** 打印机明确离线或故障。 */
  deviceOff: boolean
  /** 打印机状态首次拉取尚未返回。 */
  deviceChecking: boolean
  /**
   * 后端可达，但生成式 AI 整体不可用（能力清单读失败，或清单里的生成键全是 off）。
   * 只拦 kind === 'ai'。不依赖 AI 的浏览、材料和本机入口保持可点。
   */
  aiDown: boolean
  /** 后端可达，AI 能力清单还没回来。同样只拦 kind === 'ai'。 */
  aiChecking: boolean
  /** 后端可达且 AI 整体还在，但这台服务里有的 AI 入口对应的键是 off。 */
  aiPartial: boolean
  /** GET /kiosk/ai/capabilities 已读到的键。空表表示还没读到或读失败。 */
  features: ReadonlyMap<string, HubAiFeatureStatus>
}

export type HubAiFeatureStatus = 'available' | 'degraded' | 'off'

/**
 * 稿里 AI 卡片对应的能力键（现有 GET /kiosk/ai/capabilities 的 item.key）。
 * 没写在这张表里的 AI 路由（默认关闭的签约风险提示）跟整站生成能力走。
 */
export const HUB_AI_FEATURE_BY_ROUTE: Record<string, string> = {
  '/resume/source?intent=diagnose': 'resume_diagnosis',
  '/resume/source?intent=optimize': 'resume_optimize',
  '/resume/generate': 'resume_generate',
  '/resume/career-plan': 'career_plan',
  '/resume/job-fit': 'job_fit',
  '/interview/setup': 'mock_interview',
  '/resume/self-assessment/intro': 'self_assessment',
  '/assistant': 'assistant_chat',
}

/**
 * 这些键一起表示「生成式 AI 开没开」。
 * 打印参数预填不走模型；数字人和海报还没接入，清单里它们一直是 off，不能拿来判断 AI 挂了。
 */
export const HUB_PLATFORM_AI_KEYS = [
  'assistant_chat',
  'resume_diagnosis',
  'resume_generate',
  'resume_optimize',
  'job_fit',
  'career_plan',
  'fair_visit_plan',
  'self_assessment',
  'job_recommend',
  'job_explain',
  'advisor_work',
  'mock_interview',
] as const

export function kioskAiCapabilityItems(
  status: HubAiFeatureStatus,
): Array<{ key: string; status: HubAiFeatureStatus }> {
  return HUB_PLATFORM_AI_KEYS.map((key) => ({ key, status }))
}

/** 清单读到了、但生成键一个都不是可用：整站 AI 按不可用处理。degraded（开发 mock、缺 OCR）仍算能用。 */
export function platformAiUnavailable(
  items: ReadonlyArray<{ key: string; status: string }>,
): boolean {
  const generative = items.filter((item) =>
    (HUB_PLATFORM_AI_KEYS as readonly string[]).includes(item.key),
  )
  if (generative.length === 0) return true
  return generative.every((item) => item.status === 'off')
}

function aiFeatureVerdict(route: string, state: HubAvailability): 'open' | 'pending' | 'off' {
  if (state.aiChecking && state.features.size === 0) return 'pending'
  const key = HUB_AI_FEATURE_BY_ROUTE[route]
  if (key) {
    const status = state.features.get(key)
    if (status === 'available' || status === 'degraded') return 'open'
    if (status === 'off') return 'off'
    if (state.aiChecking) return 'pending'
    return 'off'
  }
  if (state.aiChecking) return 'pending'
  if (state.aiDown) return 'off'
  return 'open'
}

/**
 * 明确「不联网也能进」的路由白名单。**fail-closed：不在表内的一律按需要后端处理。**
 *
 * 前三条是旧壳五页 `requiresApi: false` 的原样搬迁（历史判据，不是本次新开的口径）：
 *   · `/interview/tips`         静态问答要点（重定向到 `/interview?stage=tips`）
 *   · `/renshi?tab=social`      参保流程与材料，`RenshiPage` 的静态面板
 *   · `/renshi?tab=register`    档案托管 / 登记材料，同上
 * 后六条是本页自身与首页：五个服务台就是这一份组件，它在后端不可达时正在渲染，
 * 把「返回服务目录 / 换一个服务台」也拦掉只会把用户困在原地——那是新缺陷，不是诚实。
 *
 * 原先的第四条 `/jobs/online-platforms` 于 3.14 撤出：那一页的四个平台是写死在前端的常量，
 * 所以不联网也能看；现在它重定向到本机构官方渠道，渠道要向服务端读，后端断开时进去只有
 * 读取失败页，按上面的规则必须 fail-closed。稿 16 的卡片路由仍是旧地址（规格与稿逐字节一致），靠重定向落地。
 *
 * 为什么不能直接照稿的 `kind` 判放行：稿把 `ai-down` 理解成「只有 AI 不可用」，
 * 而 `useApiReadiness === 'unavailable'` 是 **`/health` 不可达**（整个后端断开）。
 * 照 kind 一对一映射，`/jobs`、`/job-fairs`、`/me/*` 这些真要后端的 `info` 卡片
 * 会在后端已经断开时仍写着「进入 →」，点进去只有错误页——旧壳的 `requiresApi`
 * 拦的正是这件事，迁移不能把它丢掉。
 *
 * 后端可达时另读 GET /kiosk/ai/capabilities。那时 `aiDown` 只拦 kind === 'ai'，
 * 不依赖 AI 的卡片保持可点。两条不能并成一个开关。
 */
const OFFLINE_CAPABLE_ROUTES = new Set<string>([
  '/interview/tips',
  '/renshi?tab=social',
  '/renshi?tab=register',
  '/',
  ...Object.values(SERVICE_HUB_ROUTE),
])

/** 该路由是否需要后端才能呈现内容。未登记即视为需要（fail-closed）。 */
export function needsBackend(route: string): boolean {
  return !OFFLINE_CAPABLE_ROUTES.has(route)
}

/**
 * 目标分段没有自己的 kind，按「同一条路由的能力卡 / 常用入口」继承。
 * 找不到就当 info：仍走 needsBackend() 的白名单，未登记不得放行。
 */
export function capabilityKindFor(spec: ServiceHubSpec, route: string): CapabilityKind {
  return (
    spec.capabilities.find((item) => item.route === route)?.kind ??
    spec.quickLinks.find((item) => item.route === route)?.kind ??
    'info'
  )
}

/**
 * 这个服务台里是否真有依赖本机打印 / 扫描设备的入口。
 *
 * 判据取自规格本身（稿标的 `kind: 'device'`），不写死 hub 名字：稿以后给别的服务台
 * 加一张设备卡，这里自动跟上；反之删掉也自动收回。
 *
 * 为什么必须有这一条：`useTerminalDeviceStatus` 的探测结果会被服务台翻译成
 * 「本机设备不可用 / 正在确认本机设备」。岗位、招聘会、面试、政策四个服务台
 * 一张设备卡都没有，却照样把打印机离线播报在顶栏和提示条上——那是在报告一件
 * 与本页无关的事，用户只会以为「这一页坏了」。没有设备能力就不探测、不播报。
 */
export function hubUsesDevice(spec: ServiceHubSpec): boolean {
  return (
    spec.capabilities.some((item) => item.kind === 'device') ||
    spec.quickLinks.some((item) => item.kind === 'device')
  )
}

/**
 * 不可用原因照稿按 kind 分别说，不用统一话术。
 *
 * 「检查中」和「不可用」都返回原因（即都 fail-closed）：探测没出结果就放行，
 * 等于用「还不知道」冒充「可以用」。#1027 在这里栽过一次，修在 09d77972e。
 *
 * 注意 `deviceOff` 只认 offline / error 两种**明确的坏消息**。终端未配置或打印机
 * 状态未识别时 hook 给的是 `kind: 'unknown'`，那是「测不出来」不是「坏了」——
 * 旧壳五页在这种情况下并不拦截设备卡，真正的出纸门禁在打印流程自己那一层。
 * 把 unknown 也拦掉会让未配置终端上的「简历打印」永久消失，那是丢能力不是诚实。
 *
 * 判序：设备自己的坏消息最具体，先说它；其余按「这条路由要不要后端」决定。
 * 整个后端断开时，AI 类用 AI 话术，其他（含 `account` / 要后端的 `info`）用「在线服务」话术。
 * 后端还在、只是 AI 能力不可用时，只有 kind === 'ai' 会拿到原因；函数在这之后就返回，
 * 不会把浏览、材料和本机入口说成在线服务不可用。
 */
export function unavailableReason(
  kind: CapabilityKind,
  route: string,
  state: HubAvailability,
): string | null {
  if (kind === 'device') {
    if (state.deviceOff) return '本机设备当前不可用'
    if (state.deviceChecking) return '正在确认本机设备状态'
  }
  if (!needsBackend(route)) return null
  if (kind === 'ai') {
    if (state.apiDown) return 'AI能力当前不可用'
    if (state.apiChecking) return '正在确认AI能力状态'
    const feature = aiFeatureVerdict(route, state)
    if (feature === 'pending') return '正在确认AI能力状态'
    if (feature === 'off') return 'AI能力当前不可用'
  }
  if (state.apiDown) return '在线服务当前不可用'
  if (state.apiChecking) return '正在确认在线服务'
  return null
}
