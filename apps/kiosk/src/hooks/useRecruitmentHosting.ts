// 招聘内容托管开关（next-tasks 3.13，一体机侧）。
//
// 只有终端配置明确下发 `recruitmentHosting.enabled === true` 才算打开；旧服务端没有这个
// 字段时退回 `jobBoard.enabled`，同样必须是 true。配置还没读到、读取失败、字段畸形、
// 本机没有终端身份，一律按关闭处理：与我们云上的默认（托管 a）一致，也不会出现
// 「入口先闪出来再消失」。打开时（客户私有化部署 b）页面行为与今天相同。
//
// 读的是 getCachedKioskTerminalConfig（30 秒内存缓存 + 在途请求合并），同一页里几处
// 同时调用只发一次请求；五分钟内读过的配置同步回填初值，站内跳转不会先闪「关闭」态。

import { useEffect, useState } from 'react'
import {
  getCachedKioskTerminalConfig,
  getTerminalId,
  peekCachedKioskTerminalConfig,
} from '../services/api/terminalConfig'

export interface RecruitmentHostingState {
  /** loading = 还没读到本机配置。渲染上按关闭处理，路由闸门据此显示「正在确认」。 */
  status: 'loading' | 'ready'
  enabled: boolean
}

const LOADING: RecruitmentHostingState = { status: 'loading', enabled: false }
const REFRESH_MS = 5 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 纯判定：这份终端配置有没有打开招聘内容托管。 */
export function recruitmentHostingOpen(config: unknown): boolean {
  if (!isRecord(config)) return false
  if ('recruitmentHosting' in config) {
    const hosting = config['recruitmentHosting']
    return isRecord(hosting) && hosting['enabled'] === true
  }
  const jobBoard = config['jobBoard']
  return isRecord(jobBoard) && jobBoard['enabled'] === true
}

/**
 * 招聘类路由：岗位、招聘会、企业、校园招聘、线下机构，以及两个服务台。
 * `/smart-campus` 不在其中（它是智慧校园，不是校招）。
 */
const RECRUITMENT_ROUTE_PREFIXES = [
  '/jobs',
  '/jobs-service',
  '/job-fairs',
  '/fairs-service',
  '/companies',
  '/offline-agencies',
  '/campus',
] as const

export function isRecruitmentRoute(route: string): boolean {
  const path = route.split(/[?#]/)[0] ?? ''
  return RECRUITMENT_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

function initialState(): RecruitmentHostingState {
  const terminalId = getTerminalId()
  const cached = terminalId ? peekCachedKioskTerminalConfig(terminalId, REFRESH_MS) : null
  return cached ? { status: 'ready', enabled: recruitmentHostingOpen(cached) } : LOADING
}

export function useRecruitmentHosting(): RecruitmentHostingState {
  const [state, setState] = useState<RecruitmentHostingState>(initialState)

  useEffect(() => {
    let active = true
    let generation = 0

    const load = async () => {
      generation += 1
      const run = generation
      const terminalId = getTerminalId()
      const settle = (next: RecruitmentHostingState) => {
        if (!active || run !== generation || getTerminalId() !== terminalId) return
        setState((prev) => (prev.status === next.status && prev.enabled === next.enabled ? prev : next))
      }
      if (!terminalId) {
        settle({ status: 'ready', enabled: false })
        return
      }
      try {
        const config = await getCachedKioskTerminalConfig(terminalId)
        settle({ status: 'ready', enabled: recruitmentHostingOpen(config) })
      } catch {
        settle({ status: 'ready', enabled: false })
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => {
      active = false
      generation += 1
      window.clearInterval(timer)
    }
  }, [])

  return state
}
