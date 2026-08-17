import type { ExternalJobFairDTO } from '@ai-job-print/shared'
import { useCallback, useEffect, useState } from 'react'
import { getJobFairs } from '../../../services/api/jobFairs'
import { getTerminalId } from '../../../services/api/screensaver'

export type HomeJobFairHighlightState =
  | { status: 'loading'; fair: null }
  | { status: 'ready'; fair: ExternalJobFairDTO }
  | { status: 'empty'; fair: null }
  | { status: 'error'; fair: null }

function eligibleFair(fair: ExternalJobFairDTO, now: number): boolean {
  // 审核/发布闸门由服务端把守:/job-fairs 只返回 approved + published。
  // 公开列表 DTO 因此「刻意不下发」reviewStatus / publishStatus。
  // 早前这里还额外比对这两个字段,真实接口下它们恒为 undefined,
  // 于是每一条都被判不合格 —— 首页永远显示「暂无进行中或即将开始的招聘会」,
  // 而库里明明有几十场在办。mock 数据带这两个字段,所以只在接真后才暴露。
  if (fair.status !== 'ongoing' && fair.status !== 'upcoming') return false

  const endTime = Date.parse(fair.endTime)
  return Number.isFinite(endTime) && endTime > now
}

function fairOrder(a: ExternalJobFairDTO, b: ExternalJobFairDTO): number {
  if (a.status !== b.status) return a.status === 'ongoing' ? -1 : 1
  return Date.parse(a.startTime) - Date.parse(b.startTime)
}

export function useHomeJobFairHighlight(): HomeJobFairHighlightState & { retry: () => void } {
  const [state, setState] = useState<HomeJobFairHighlightState>({ status: 'loading', fair: null })
  const [requestVersion, setRequestVersion] = useState(0)

  const retry = useCallback(() => {
    setRequestVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', fair: null })

    const terminalId = getTerminalId()
    void getJobFairs(terminalId ? { terminalId } : undefined)
      .then((response) => {
        if (cancelled) return
        const now = Date.now()
        const fair = response.data.filter((item) => eligibleFair(item, now)).sort(fairOrder)[0]
        setState(fair ? { status: 'ready', fair } : { status: 'empty', fair: null })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', fair: null })
      })

    return () => {
      cancelled = true
    }
  }, [requestVersion])

  return { ...state, retry }
}
