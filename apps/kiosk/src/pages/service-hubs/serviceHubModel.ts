/**
 * 五个服务台的文案与能力卡数据，**逐字取自稿 16-service-hubs.html 的 `const H`**。
 *
 * 为什么集中成一张表而不是五个页面各写各的：稿本身就是一份 HTML 带 `?hub=` 参数
 * 渲染五种，五个 hub 的骨架、状态分支和诚实性声明的位置完全相同。拆成五份等于
 * 给「某一份漏抄一句诚实性声明」留五次机会——那正是这批迁移反复出问题的形态。
 *
 * `kind` 决定不可用态怎么说：稿把 AI 类和设备类**分开**，不可用时不是笼统灰掉，
 * 而是把「进入 →」换成具体原因（「AI能力当前不可用」/「本机设备当前不可用」）。
 * 这是 CLAUDE.md §9「不伪造能力」的直接落地：说不清为什么不能用，就不该只是变灰。
 */
export type ServiceHubKey = 'resume' | 'jobs' | 'fairs' | 'interview' | 'policy'

/** 能力的依赖类别，决定它在哪种降级下不可用、以及不可用时对用户怎么说。 */
export type CapabilityKind = 'ai' | 'device' | 'info'

export interface HubCapability {
  title: string
  description: string
  /** 卡片右下角的来源/性质标注，例如「AI · 需核实」「确定性内容」「本人记录」。 */
  badge: string
  route: string
  kind: CapabilityKind
}

export interface HubGoal {
  label: string
  route: string
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

/** 不可用原因照稿：按 kind 分别说，不用统一话术。 */
export function unavailableReason(kind: CapabilityKind, aiDown: boolean, deviceOff: boolean): string | null {
  if (kind === 'ai' && aiDown) return 'AI能力当前不可用'
  if (kind === 'device' && deviceOff) return '本机设备当前不可用'
  return null
}
