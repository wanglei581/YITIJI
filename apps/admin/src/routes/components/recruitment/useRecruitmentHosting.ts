import { useCallback, useEffect, useState } from 'react'
import { recruitmentEmergencyService } from '../../../services/api/recruitmentEmergency'

/**
 * 招聘内容托管开关（3.13），管理员后台读它来决定说法与少数只读展示。
 *
 * 3.15 起管理员对岗位 / 招聘会 / 企业 / 线下机构的审核、发布、新建、编辑、导入、同步控件
 * **不论开关一律停放**（源码保留在各页的停放文件里，不再挂载），`writable` 因此不再用来显示写按钮，
 * 只留给停放文件在私有化部署（b）恢复时使用。
 *
 * - ready + enabled=false：我们云上的默认。一体机与小程序不展示招聘类内容。
 * - ready + enabled=true：私有化部署（b）。
 * - loading / error：按关闭处理（fail-closed）。
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
