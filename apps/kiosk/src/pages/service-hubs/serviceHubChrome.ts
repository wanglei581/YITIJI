import { SERVICE_HUB_SPECS } from './serviceHubSpecs'
import {
  capabilityKindFor,
  unavailableReason,
  type HubAvailability,
  type ServiceHubKey,
} from './serviceHubModel'

/** 能力条：按当前最具体的那一档说，不把 AI 和整站后端说成同一件事。 */
export function capChips(state: HubAvailability): string[] {
  if (state.apiDown) return ['能力配置 · 以办理时确认', '在线服务 · 暂不可用', '不联网内容 · 仍可进入']
  if (state.apiChecking) return ['能力配置 · 以办理时确认', '在线服务 · 正在确认', '其他入口 · 确认后再进']
  if (state.deviceOff) return ['能力配置 · 以办理时确认', '本机设备 · 暂不可用', '信息与 AI · 进入后确认']
  if (state.deviceChecking) return ['能力配置 · 以办理时确认', '本机设备 · 正在确认', '信息与 AI · 进入后确认']
  if (state.aiDown) return ['能力配置 · 以办理时确认', 'AI能力 · 暂不可用', '其他入口 · 进入后确认']
  if (state.aiChecking) return ['能力配置 · 以办理时确认', 'AI能力 · 正在确认', '其他入口 · 进入后确认']
  if (state.aiPartial) return ['能力配置 · 以办理时确认', '部分 AI · 暂不可用', '其他入口 · 进入后确认']
  return ['能力配置 · 以办理时确认', '来源与流程 · 进入后确认', '本页只做分流']
}

/**
 * 顶栏状态胶囊：拿不到结论时必须说「正在确认」，不得默认 ok。
 *
 * apiDown 这条说的是「在线服务」而不是稿里的「AI能力」：`useApiReadiness` 判的是
 * `/health` 不可达（整个后端断开），不只是 AI。说成「AI能力不可用」会让用户以为
 * 岗位浏览、台账这些还能用。同理见 noticeCopy 与 serviceHubModel.needsBackend。
 */
export function statusPill(state: HubAvailability): { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string } {
  // deviceOff / deviceChecking 在「这一页没有设备能力」时恒为 false
  // （见 QxServiceHubPage 的 deviceAware），所以岗位 / 招聘会 / 面试 / 政策
  // 永远走不到下面两条设备分支——它们不该替打印机播报。
  if (state.apiDown) return { tone: 'bad', label: '在线服务不可用' }
  if (state.apiChecking) return { tone: 'unknown', label: '正在确认在线服务' }
  if (state.deviceOff) return { tone: 'warn', label: '本机设备不可用' }
  if (state.deviceChecking) return { tone: 'unknown', label: '正在确认本机设备' }
  if (state.aiDown) return { tone: 'warn', label: 'AI能力不可用，其他服务仍按实际状态办理' }
  if (state.aiChecking) return { tone: 'unknown', label: '正在确认AI能力' }
  if (state.aiPartial) return { tone: 'warn', label: '部分 AI 能力不可用，其他入口仍可进入' }
  return { tone: 'ok', label: '能力与设备状态以办理时确认为准' }
}

/** 整站 AI 还在，但这一个中心里有的 AI 入口对应的键是 off。 */
export function hubAiPartial(
  spec: (typeof SERVICE_HUB_SPECS)[ServiceHubKey],
  state: HubAvailability,
): boolean {
  if (state.apiDown || state.apiChecking || state.aiDown || state.aiChecking) return false
  return spec.capabilities.some((cap) => cap.kind === 'ai' && unavailableReason(cap.kind, cap.route, state) !== null)
    || spec.goals.some((goal) => {
      const kind = capabilityKindFor(spec, goal.route)
      return kind === 'ai' && unavailableReason(kind, goal.route, state) !== null
    })
}
