// 招聘内容托管开关（next-tasks 3.13，一体机侧）。
//
// 只有终端配置明确下发 `recruitmentHosting.enabled === true` 才算打开；旧服务端没有这个
// 字段时退回 `jobBoard.enabled`，同样必须是 true。配置还没读到、读取失败、字段畸形、
// 本机没有终端身份，一律按关闭处理：与我们云上的默认（托管 a）一致，也不会出现
// 「入口先闪出来再消失」。打开时（客户私有化部署 b）页面行为与今天相同。
//
// 读的是 getCachedKioskTerminalConfig（30 秒内存缓存 + 在途请求合并），同一页里几处
// 同时调用只发一次请求；五分钟内读过的配置同步回填初值，站内跳转不会先闪「关闭」态。
// 判定与加载器在 recruitmentHostingModel.ts（纯逻辑，用例直接驱动）。

import { useEffect, useState } from 'react'
import {
  getCachedKioskTerminalConfig,
  getTerminalId,
  peekCachedKioskTerminalConfig,
} from '../services/api/terminalConfig'
import {
  createRecruitmentHostingLoader,
  RECRUITMENT_HOSTING_LOADING,
  recruitmentHostingOpen,
  type RecruitmentHostingState,
} from './recruitmentHostingModel'

export { isRecruitmentRoute, recruitmentHostingOpen } from './recruitmentHostingModel'
export type { RecruitmentHostingState } from './recruitmentHostingModel'

const REFRESH_MS = 5 * 60 * 1000

function initialState(): RecruitmentHostingState {
  const terminalId = getTerminalId()
  const cached = terminalId ? peekCachedKioskTerminalConfig(terminalId, REFRESH_MS) : null
  return cached ? { status: 'ready', enabled: recruitmentHostingOpen(cached) } : RECRUITMENT_HOSTING_LOADING
}

export function useRecruitmentHosting(): RecruitmentHostingState {
  const [state, setState] = useState<RecruitmentHostingState>(initialState)

  useEffect(() => {
    const loader = createRecruitmentHostingLoader({
      getTerminalId,
      fetchConfig: (terminalId) => getCachedKioskTerminalConfig(terminalId),
      onSettle: (next) => {
        setState((prev) => (prev.status === next.status && prev.enabled === next.enabled ? prev : next))
      },
    })
    void loader.load()
    const timer = window.setInterval(() => void loader.load(), REFRESH_MS)
    return () => {
      loader.dispose()
      window.clearInterval(timer)
    }
  }, [])

  return state
}
