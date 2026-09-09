import { useCallback, useEffect, useState } from 'react'
import { getJobs } from '../../../services/api'

export type HomeJobHighlightState =
  | { status: 'loading'; total: null }
  | { status: 'ready'; total: number }
  | { status: 'empty'; total: null }
  | { status: 'error'; total: null }

// 与 JobsPage 打开 /jobs?category=fulltime 时发出的列表查询同构：
// getJobs({ category, page: listPage, pageSize: 100 })，首页等价于
// category='fulltime'、page=1。只读 pagination.total，不做客户端过滤。
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

    void getJobs({ category: 'fulltime', page: 1, pageSize: 100 })
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
