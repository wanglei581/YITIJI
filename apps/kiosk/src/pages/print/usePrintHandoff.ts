// 页面侧的打印交接：来源用 useStartPrintHandoff 整份写入并跳转；打印链各页用 usePrintHandoffOwner 取当前归属。
// 纯逻辑在 printHandoff.ts（有单元测试），这里只接上登录态与路由。

import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import {
  beginPrintHandoff,
  printHandoffOwnerFor,
  printHandoffTarget,
  type BeginPrintHandoffResult,
  type PrintHandoffInput,
  type PrintHandoffOwner,
} from './printHandoff'

/** 当前使用者的归属（游客，或本次登录的随机标记）。登录对象不变，标记就不变。 */
export function usePrintHandoffOwner(): PrintHandoffOwner {
  const { user } = useAuth()
  return useMemo(() => printHandoffOwnerFor(user), [user])
}

/**
 * 来源把这一份文件交给打印链：整份写入交接上下文（旧文件的检查结论、参数一并作废），
 * 再跳到入口（原件去打印台检查，派生产物去报价确认页），跳转只带交接编号。
 * 写不进时去确认页如实提示，不退回临时状态。
 */
export function useStartPrintHandoff(): (input: PrintHandoffInput) => BeginPrintHandoffResult {
  const navigate = useNavigate()
  const owner = usePrintHandoffOwner()
  return useCallback(
    (input: PrintHandoffInput) => {
      const result = beginPrintHandoff(input, owner)
      const target = printHandoffTarget(result)
      navigate(target.path, { state: target.state })
      return result
    },
    [navigate, owner],
  )
}
