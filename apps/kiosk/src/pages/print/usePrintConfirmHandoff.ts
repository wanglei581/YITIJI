// 报价确认页读交接上下文 + 参数与本机能力求交（商用收口 P0-5，F01 / F02 / F16）。
//
// 文件身份只认交接上下文：跳转带来的临时状态里只有交接编号，文件、参数一律不看。
// 登录回跳、返回预览、刷新之后回来的都还是这一份；归属不符、过期、被替换时落「没法确认」屏，不猜是哪一份。
// 参数不拦截（9/29 定稿，稿 14）：本机没开通的彩色 / 双面改成能打的，按改后的参数报价并逐项说明。

import { useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import {
  DEFAULT_PRINT_JOB_PARAMS,
  negotiatePrintParams,
  type PrintJobParams,
} from '@ai-job-print/shared'
import type { PrintParamCapabilityState } from '../../hooks/usePrintParamCapability'
import {
  patchPrintHandoff,
  printHandoffProblemText,
  readPrintHandoff,
  resolveRouteHandoff,
  type PrintHandoffRouteState,
} from './printHandoff'
import { computePrintUsageEstimate } from './printUsageEstimate'
import { usePrintHandoffOwner } from './usePrintHandoff'

const BASE_PARAMS: PrintJobParams = { ...DEFAULT_PRINT_JOB_PARAMS, pageRange: 'all', pagesPerSheet: 1 }

export function usePrintConfirmHandoff(capability: PrintParamCapabilityState) {
  const location = useLocation()
  const owner = usePrintHandoffOwner()
  const resolved = useMemo(
    () => resolveRouteHandoff(readPrintHandoff(owner), location.state as PrintHandoffRouteState | null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- location.state 随 location.key 一起变
    [owner, location.key],
  )
  const handoff = resolved.status === 'ok' ? resolved.context : null
  const problem = printHandoffProblemText(resolved.status)
  const handoffInvalid = resolved.status !== 'ok' && resolved.status !== 'none'
  const returnPath = 'returnPath' in resolved ? resolved.returnPath : handoff?.returnPath
  const ordered = Boolean(handoff?.order)

  // 参数：上下文里用户定过的 → 来源建议 → 基线。
  const incomingParams = useMemo<PrintJobParams>(
    () => handoff?.printParams ?? { ...BASE_PARAMS, ...(handoff?.paramsSuggestion ?? {}) },
    [handoff],
  )
  const negotiated = useMemo(() => negotiatePrintParams(incomingParams, capability), [incomingParams, capability])
  const params = negotiated.params

  // 求交后的参数写回上下文：去登录、返回预览之后回来还是这一组。
  const paramsKey = JSON.stringify(params)
  useEffect(() => {
    if (!handoff || negotiated.waiting || ordered) return
    if (JSON.stringify(handoff.printParams ?? null) === paramsKey) return
    patchPrintHandoff(handoff.contextId, { printParams: params })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paramsKey 已编码全部参数
  }, [handoff, negotiated.waiting, ordered, paramsKey])

  // 改过双面时说清用纸变化（稿 14：比原来多用 N 张纸 / 用纸张数不变）。
  const pages = handoff?.file.pages ?? null
  const now = computePrintUsageEstimate({ pages, copies: params.copies, pagesPerSheet: 1, duplex: params.duplex }).sheetsUsed
  const was = computePrintUsageEstimate({ pages, copies: incomingParams.copies, pagesPerSheet: 1, duplex: incomingParams.duplex }).sheetsUsed
  const paperNote = now === null || was === null ? null : now > was ? `比原来多用 ${now - was} 张纸` : '用纸张数不变'

  return {
    resolved,
    handoff,
    problem,
    handoffInvalid,
    returnPath,
    ordered,
    incomingParams,
    params,
    adjustments: negotiated.adjustments,
    waitingCapability: negotiated.waiting,
    paperNote,
  }
}
