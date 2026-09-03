import { useNavigate } from 'react-router-dom'
import { useIdleTimer } from '../../hooks/useIdleTimer'
import { IDLE_TIMEOUT_MS, clearSession } from './selfAssessmentSession'

/**
 * 自我探索四页共用的公共屏闲置退出。
 *
 * 答题页原先只在本页挂 60 秒计时；结果页 / 记录页 / 同意页没有，sessionStorage
 * 里的作答和解读会活过刷新与全局清场（清场名单漏了这个键）。四页都走这里，
 * 闲置即清会话并回首页；忙碌中（交卷 / 出 PDF）由调用方把 enabled 关掉。
 */
export function useSelfAssessmentIdleExit(enabled = true): void {
  const navigate = useNavigate()
  useIdleTimer({
    timeoutMs: IDLE_TIMEOUT_MS,
    enabled,
    onIdle: () => {
      clearSession()
      navigate('/')
    },
  })
}
