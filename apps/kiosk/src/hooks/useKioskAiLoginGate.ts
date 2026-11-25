// 后台「用 AI 前先登录」开关在一体机侧的读数（改简历的来源页用：开着且是游客时，先去登录再选来源、传文件）。
//
// 数据源：终端配置 GET /terminals/:id/config 里的 ai.loginGate。服务端拦 AI 请求用的是同一个开关
// （ai-access.service.ts：before_generate 时生成、语音、导出都要登录；before_export 时只有导出要登录）。
// 读的是 getCachedKioskTerminalConfig（30 秒内存缓存 + 在途请求合并），首页、服务台读过的那一份直接复用。
//
// 只认三个明确取值。没读到、读失败、字段缺失、本机没有终端身份 → 'unknown'，按没开处理，页面照旧。

import { useEffect, useState } from 'react'
import {
  getCachedKioskTerminalConfig,
  getTerminalId,
  peekCachedKioskTerminalConfig,
} from '../services/api/terminalConfig'

export type KioskAiLoginGate = 'off' | 'before_export' | 'before_generate' | 'unknown'

/** 纯判定：这份终端配置里后台要求哪一档登录。畸形、缺字段一律 unknown。 */
export function kioskAiLoginGateOf(config: unknown): KioskAiLoginGate {
  if (typeof config !== 'object' || config === null) return 'unknown'
  const ai = (config as { ai?: unknown }).ai
  if (typeof ai !== 'object' || ai === null) return 'unknown'
  const gate = (ai as { loginGate?: unknown }).loginGate
  return gate === 'off' || gate === 'before_export' || gate === 'before_generate' ? gate : 'unknown'
}

/** 游客现在用 AI 生成（诊断、优化都算）会不会被服务端要求先登录。只有 before_generate 会；没读到按不会。 */
export function guestMustLoginBeforeAi(gate: KioskAiLoginGate, loggedIn: boolean): boolean {
  return gate === 'before_generate' && !loggedIn
}

function initialState(): KioskAiLoginGate {
  const terminalId = getTerminalId()
  // 首屏先用本页内存里最近一次读到的配置（不限时长），免得页面先画出来、配置回来后才跳走；挂载后照常重读一次。
  return terminalId
    ? kioskAiLoginGateOf(peekCachedKioskTerminalConfig(terminalId, Number.POSITIVE_INFINITY))
    : 'unknown'
}

export function useKioskAiLoginGate(): KioskAiLoginGate {
  const [state, setState] = useState<KioskAiLoginGate>(initialState)

  useEffect(() => {
    let alive = true
    const terminalId = getTerminalId()
    if (!terminalId) return
    getCachedKioskTerminalConfig(terminalId)
      .then((config) => {
        if (alive) setState(kioskAiLoginGateOf(config))
      })
      // 读失败就保持首屏那一份，不因为一次网络抖动改判。
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  return state
}
