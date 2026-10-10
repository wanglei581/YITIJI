// 招聘内容托管打开时才拉已发布岗位。关着时不请求，也不把 loading 收成 false
//（列表根本不渲染，卡住的 loading 看不见）。
import { useEffect, useState } from 'react'
import type { ExternalJobDTO } from '@ai-job-print/shared'
import { getJobs } from '../../../services/api'

export function usePublishedJobs(hostingEnabled: boolean, keyword: string) {
  const [jobs, setJobs] = useState<ExternalJobDTO[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsError, setJobsError] = useState(false)

  useEffect(() => {
    if (!hostingEnabled) return
    let cancelled = false
    setJobsLoading(true)
    getJobs({ keyword: keyword || undefined, page: 1, pageSize: 8 })
      .then((res) => {
        if (cancelled) return
        setJobsError(false)
        setJobs(res.data)
      })
      .catch(() => {
        if (cancelled) return
        // 「没搜到岗位」和「岗位列表没取回来」对用户是两件事，
        // 原实现一律渲染成空列表，等于把故障说成没有结果。
        setJobsError(true)
        setJobs([])
      })
      .finally(() => { if (!cancelled) setJobsLoading(false) })
    return () => { cancelled = true }
  }, [keyword, hostingEnabled])

  return { jobs, jobsLoading, jobsError }
}
