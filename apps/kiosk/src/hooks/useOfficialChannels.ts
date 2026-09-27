// 本机构官方渠道（next-tasks 3.14）的读取 hook：首页「岗位与招聘会」磁贴与 /official-channels 页共用。
//
// 读的是 getCachedOfficialChannels（30 秒内存缓存 + 在途请求合并），同一页几处同时调用只发一次请求；
// 五分钟内读过的结果同步回填初值，站内来回不会先闪「读取中」。
//   · 本机没有终端身份：不发请求，直接按「没有渠道」处理——诚实空态，不算错误。
//   · 首次读取失败：error，页面给重试，首页不摆磁贴。
//   · 读到过之后的后台刷新失败：保留上一次读到的结果，首页磁贴不因一次抖动闪出又闪回。
//     读到的新结果（包括「现在没有渠道了」）照常替换。

import { useCallback, useEffect, useState } from 'react'
import {
  getCachedOfficialChannels,
  peekCachedOfficialChannels,
  type OfficialChannelItem,
  type OfficialChannelsResponse,
} from '../services/api/officialChannels'
import { getTerminalId } from '../services/api/terminalConfig'

export type OfficialChannelsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: OfficialChannelItem[]; legacyPlatforms: OfficialChannelItem[] }

const REFRESH_MS = 5 * 60 * 1000
const LOADING: OfficialChannelsState = { status: 'loading' }
const FAILED: OfficialChannelsState = { status: 'error' }
const NO_TERMINAL: OfficialChannelsState = { status: 'ready', items: [], legacyPlatforms: [] }

function readyWith(prev: OfficialChannelsState, next: OfficialChannelsResponse): OfficialChannelsState {
  // 缓存命中时是同一份数组：不换引用，不触发重渲染。
  if (prev.status === 'ready' && prev.items === next.items && prev.legacyPlatforms === next.legacyPlatforms) return prev
  return { status: 'ready', items: next.items, legacyPlatforms: next.legacyPlatforms }
}

function initialState(): OfficialChannelsState {
  const terminalId = getTerminalId()
  if (!terminalId) return NO_TERMINAL
  const cached = peekCachedOfficialChannels(terminalId, REFRESH_MS)
  return cached ? readyWith(LOADING, cached) : LOADING
}

export function useOfficialChannels(): OfficialChannelsState & { retry: () => void } {
  const [state, setState] = useState<OfficialChannelsState>(initialState)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    const load = async () => {
      const terminalId = getTerminalId()
      if (!terminalId) {
        if (active) setState(NO_TERMINAL)
        return
      }
      try {
        const next = await getCachedOfficialChannels(terminalId)
        if (active) setState((prev) => readyWith(prev, next))
      } catch {
        if (active) setState((prev) => (prev.status === 'ready' ? prev : FAILED))
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [attempt])

  const retry = useCallback(() => {
    setState(LOADING)
    setAttempt((value) => value + 1)
  }, [])

  return { ...state, retry }
}
