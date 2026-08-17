// ── 打印参数能力（彩色 / 双面）前端可用性 ─────────────────────────────────────
//
// 服务端才是门禁真相源（TerminalCapabilitiesService.assertPrintParamsAllowed）。
// 本 hook 只决定**控件长什么样**：能不能点、点不了时说什么理由。
//
// fail-closed 三条：
//   1. 尚未取到能力（加载中 / 拉取失败 / 本机没有终端身份）→ 一律按「未验证」禁用。
//      绝不「先当可用，等失败再回退」—— 那会让用户先选中彩色再被打回。
//   2. 只有 configured=true 且 status='available' 才算放行，与服务端判定一致。
//   3. 禁用理由必须说清是「本机未通过真机验证」，不是「不支持」——
//      硬件确实支持彩色和双面（奔图 CM2800/CM2820），说「不支持」是谎报。

import { useEffect, useState } from 'react'
import {
  CAPABILITY_DENIAL_REASON,
  type PrintScanCapabilityKey,
} from '@ai-job-print/shared'
import { loadConfiguredCapabilities } from '../services/api/printScanCapabilities'

export interface PrintParamCapability {
  allowed: boolean
  /** 禁用理由；allowed=true 时为 null。 */
  reason: string | null
}

export interface PrintParamCapabilityState {
  loading: boolean
  color: PrintParamCapability
  duplex: PrintParamCapability
}

const LOADING_REASON = '正在确认本机打印能力…'
const UNKNOWN_REASON = '暂时无法确认本机打印能力，已按未验证处理'

function denied(reason: string): PrintParamCapability {
  return { allowed: false, reason }
}

const INITIAL: PrintParamCapabilityState = {
  loading: true,
  color: denied(LOADING_REASON),
  duplex: denied(LOADING_REASON),
}

export function usePrintParamCapability(): PrintParamCapabilityState {
  const [state, setState] = useState<PrintParamCapabilityState>(INITIAL)

  useEffect(() => {
    let cancelled = false

    void loadConfiguredCapabilities().then((result) => {
      if (cancelled) return

      // 拉取失败 / 跳过（mock 或无终端身份）：按未验证处理，不放大可用性。
      if (result.status !== 'ok') {
        setState({ loading: false, color: denied(UNKNOWN_REASON), duplex: denied(UNKNOWN_REASON) })
        return
      }

      const resolve = (key: PrintScanCapabilityKey): PrintParamCapability => {
        const row = result.map[key]
        // 未配置行对这两个键 = 未验证（与服务端 DEFAULT_DENY_CAPABILITY_KEYS 一致）。
        if (!row) return denied(CAPABILITY_DENIAL_REASON[key] ?? UNKNOWN_REASON)
        if (row.status === 'available') return { allowed: true, reason: null }
        return denied(row.note ?? CAPABILITY_DENIAL_REASON[key] ?? UNKNOWN_REASON)
      }

      setState({ loading: false, color: resolve('color_print'), duplex: resolve('duplex_print') })
    })

    return () => {
      cancelled = true
    }
  }, [])

  return state
}
