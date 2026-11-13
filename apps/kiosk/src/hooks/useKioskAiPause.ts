// 后台「AI 暂停」开关在一体机侧的读数（我的 → AI 服务记录用，稿 my-ai 的「小青这次不可用」；
// 简历服务台也用它，把要 AI 的入口先置灰写原因，稿 resume 的 ?ai=down，走查 I-35）。
//
// 数据源：终端配置 GET /terminals/:id/config 里的 ai.paused。服务端对每一条 AI 请求回 503 AI_PAUSED
// 用的就是同一个开关（ai-access.service.ts），所以读到 true 就是「小青此刻一定答不了」的真值。
// 读的是 getCachedKioskTerminalConfig（30 秒内存缓存 + 在途请求合并）：同一页里的招聘托管读数共用这一次请求，
// 不多发一条。
//
// 只在读到 paused === true 时才报 'paused'：
//   · 配置没读到、读失败、字段缺失、本机没有终端身份 → 'unknown'，不把「没读到」说成「不可用」；
//   · paused === false → 'not-paused'，只说明没被后台暂停，不说「一定能用」——密钥、额度、上游故障
//     只有真实调用才暴露，这里不假装探过。
// 页面据此只多一句说明和不用 AI 的出口，从不因为它藏起已有记录或改记录的说法。

import { useEffect, useState } from 'react'
import {
  getCachedKioskTerminalConfig,
  getTerminalId,
  peekCachedKioskTerminalConfig,
} from '../services/api/terminalConfig'

export type KioskAiPauseState = 'paused' | 'not-paused' | 'unknown'

const REFRESH_MS = 5 * 60 * 1000

/** 纯判定：这份终端配置里后台有没有把 AI 暂停。畸形、缺字段一律 unknown。 */
export function kioskAiPauseOf(config: unknown): KioskAiPauseState {
  if (typeof config !== 'object' || config === null) return 'unknown'
  const ai = (config as { ai?: unknown }).ai
  if (typeof ai !== 'object' || ai === null) return 'unknown'
  const paused = (ai as { paused?: unknown }).paused
  if (paused === true) return 'paused'
  return paused === false ? 'not-paused' : 'unknown'
}

function initialState(): KioskAiPauseState {
  const terminalId = getTerminalId()
  return terminalId ? kioskAiPauseOf(peekCachedKioskTerminalConfig(terminalId, REFRESH_MS)) : 'unknown'
}

export function useKioskAiPause(): KioskAiPauseState {
  const [state, setState] = useState<KioskAiPauseState>(initialState)

  useEffect(() => {
    let alive = true
    const load = () => {
      const terminalId = getTerminalId()
      if (!terminalId) return
      getCachedKioskTerminalConfig(terminalId)
        .then((config) => {
          if (alive) setState(kioskAiPauseOf(config))
        })
        // 刷新失败就保持上一次读到的，不因为一次网络抖动把「已暂停」说回「未知」。
        .catch(() => {})
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  return state
}
