import { useCallback, useEffect, useState } from 'react'
import { getJobs } from '../../../services/api'

export type HomeJobHighlightState =
  | { status: 'loading'; total: null }
  | { status: 'ready'; total: number }
  | { status: 'empty'; total: null }
  | { status: 'error'; total: null }

// 口径：**不按 category 收窄**。这颗卡片点进去是 /jobs-service 服务台，
// 底下有全职 /jobs?category=fulltime、实习 ?category=intern、兼职 ?category=parttime
// 和「全部岗位」/jobs 四个入口（JobsServiceHubPage.tsx:57/69/81/93）。
// 只数全职的话，全职为 0 而实习有内容时卡片会写「暂无岗位」，
// 用户就不点了 —— 那比现在什么都不说更糟。所以与「全部岗位」同构（无 category）。
//
// pageSize 取 1：total 来自服务端一次独立的 prisma.job.count({ where })
// （jobs-kiosk.service.ts:68-76 的 Promise.all，count 不带 skip/take），
// 与 pageSize 无关；为显示一个数字把 100 条拉回首页没必要。
// 只读 pagination.total，不做客户端过滤。
//
// 审核/发布闸门由服务端把守：公开 /jobs 只返回已审核发布且在有效期内的岗位。
// 公开列表 DTO 即使类型上还留着 reviewStatus / publishStatus，运行时也可能
// 不下发。招聘会 hook 早前额外比对这两个字段，真实接口下它们恒为 undefined，
// 于是首页永远「暂无」。这里不再发明合格判据。

export function useHomeJobHighlight(): HomeJobHighlightState & { retry: () => void } {
  const [state, setState] = useState<HomeJobHighlightState>({ status: 'loading', total: null })
  const [requestVersion, setRequestVersion] = useState(0)

  const retry = useCallback(() => {
    setRequestVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', total: null })

    void getJobs({ pageSize: 1 })
      .then((response) => {
        if (cancelled) return
        const total = response.pagination.total
        if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
          setState({ status: 'error', total: null })
          return
        }
        setState(total > 0 ? { status: 'ready', total } : { status: 'empty', total: null })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', total: null })
      })

    return () => {
      cancelled = true
    }
  }, [requestVersion])

  return { ...state, retry }
}
