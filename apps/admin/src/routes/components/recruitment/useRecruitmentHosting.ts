import { useCallback, useEffect, useState } from 'react'
import { recruitmentEmergencyService } from '../../../services/api/recruitmentEmergency'

/**
 * 招聘内容托管开关（3.13），管理员招聘类页面共用。
 *
 * - ready + enabled=false：我们云上的默认。审核 / 发布 / 新建 / 编辑 / 导入 / 同步
 *   一律不显示（点了也只会 403 RECRUITMENT_HOSTING_DISABLED），只留查看与紧急下架。
 * - ready + enabled=true：私有化部署（b）。既有控件照旧，另加紧急下架。
 * - loading / error：按关闭处理（fail-closed）。管理员侧的写按钮本身就是要收掉的风险面，
 *   开关没读到时宁可少给按钮，也不能给出一排点了就 403 的「审核通过 / 发布」。
 *   紧急下架不受影响。
 *
 * 开关是部署级环境变量，运行期不会变，所以一次页面生命周期里只请求一次；失败后下次挂载重试。
 */
export type RecruitmentHostingView =
  | { status: 'loading'; writable: false; retry: () => void }
  | { status: 'ready'; enabled: boolean; writable: boolean; retry: () => void }
  | { status: 'error'; writable: false; retry: () => void }

let pending: Promise<boolean> | null = null

function loadHostingEnabled(): Promise<boolean> {
  if (!pending) {
    pending = recruitmentEmergencyService.getHostingEnabled().catch((error: unknown) => {
      pending = null
      throw error
    })
  }
  return pending
}

type Snapshot = { status: 'loading' } | { status: 'ready'; enabled: boolean } | { status: 'error' }

export function useRecruitmentHosting(): RecruitmentHostingView {
  const [snapshot, setSnapshot] = useState<Snapshot>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    loadHostingEnabled()
      .then((enabled) => { if (alive) setSnapshot({ status: 'ready', enabled }) })
      .catch(() => { if (alive) setSnapshot({ status: 'error' }) })
    return () => { alive = false }
  }, [attempt])

  const retry = useCallback(() => {
    setSnapshot({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  if (snapshot.status === 'ready') {
    return { status: 'ready', enabled: snapshot.enabled, writable: snapshot.enabled, retry }
  }
  return { status: snapshot.status, writable: false, retry }
}
