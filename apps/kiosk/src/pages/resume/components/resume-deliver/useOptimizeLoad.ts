import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type { GeneratedResume, ResumeOptimizeModule, ResumeTemplate } from '@ai-job-print/shared'
import { getResumeOptimize, type ResumeReadAccess } from '../../../../services/api'
import { getResumeTemplates } from '../../../../services/api/jobMaterials'
import { errorCodeOf, userMessageOf } from '../../../../services/api/userErrorMessage'
import { isAiOutage } from '../../../../ai/aiOutage'
import { SYNTHETIC_MODULES, SYNTHETIC_RESUME } from './fixtures'
import type { OptimizeViewState } from './constants'

type FailKind = 'retry' | 'reparse' | 'expired' | 'consent' | 'outage'

export function useOptimizeLoad(opts: {
  taskId?: string
  access: ResumeReadAccess
  syntheticReady: boolean
  requested: OptimizeViewState | null
  consentChecking: boolean
  consentNeedsPrompt: boolean
  consentReady: boolean
  retryNonce: number
  setLoading: Dispatch<SetStateAction<boolean>>
  setFailKind: Dispatch<SetStateAction<FailKind>>
  setFailMsg: Dispatch<SetStateAction<string | null>>
  setModules: Dispatch<SetStateAction<ResumeOptimizeModule[]>>
  setOptimizedResume: Dispatch<SetStateAction<GeneratedResume | null>>
  setTemplatesError: Dispatch<SetStateAction<boolean>>
  setResumeTemplates: Dispatch<SetStateAction<ResumeTemplate[]>>
  setSelectedTemplateId: Dispatch<SetStateAction<string>>
}) {
  const {
    taskId, access, syntheticReady, requested, consentChecking, consentNeedsPrompt, consentReady, retryNonce,
    setLoading, setFailKind, setFailMsg, setModules, setOptimizedResume,
    setTemplatesError, setResumeTemplates, setSelectedTemplateId,
  } = opts
  const token = access.token
  const accessToken = access.accessToken

  useEffect(() => {
    let cancelled = false
    getResumeTemplates()
      .then((templates) => {
        if (cancelled) return
        setTemplatesError(false)
        setResumeTemplates(templates)
        setSelectedTemplateId((current) => current && templates.some((item) => item.id === current) ? current : templates[0]?.id ?? '')
      })
      .catch(() => { if (!cancelled) { setTemplatesError(true); setResumeTemplates([]) } })
    return () => { cancelled = true }
  }, [setResumeTemplates, setSelectedTemplateId, setTemplatesError])

  useEffect(() => {
    if (syntheticReady && (requested === 'ready' || requested === 'empty')) {
      setLoading(false)
      setFailMsg(null)
      setModules(requested === 'ready' ? SYNTHETIC_MODULES : [])
      setOptimizedResume(requested === 'ready' ? SYNTHETIC_RESUME : null)
      return
    }
    if (!taskId) { setLoading(false); setFailKind('reparse'); setFailMsg('请先上传简历完成诊断'); return }
    if (consentChecking || consentNeedsPrompt || !consentReady) { setLoading(true); return }
    let cancelled = false
    setLoading(true)
    setFailMsg(null)
    getResumeOptimize(taskId, { token, accessToken })
      .then((res) => {
        if (cancelled) return
        if (res.status === 'completed') {
          setModules(res.modules ?? [])
          setOptimizedResume(res.optimizedResume ?? null)
          if (!res.optimizedResume && (res.modules ?? []).length === 0) {
            setFailKind('retry')
            setFailMsg('暂无优化建议，可重试一次；若仍没有内容请返回重新解析')
          }
        } else {
          const reason = res.failReason ?? ''
          setFailKind(reason.includes('重新上传') ? 'expired' : 'retry')
          setFailMsg(reason.includes('重新上传') ? '文件已过期，请重新上传简历' : (reason || '本次没有生成优化建议，可重试或返回重新解析'))
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const code = errorCodeOf(err)
        if (code === 'USER_AI_CONSENT_REQUIRED') { setFailKind('consent'); setFailMsg('请先确认简历 AI 服务授权后再生成优化建议'); return }
        if (isAiOutage(err)) { setFailKind('outage'); setFailMsg(userMessageOf(err, '简历优化当前不可用')); return }
        if (code && ['REQUEST_TIMEOUT', 'AI_BUSY', 'RATE_LIMITED', 'AI_RATE_LIMITED', 'AI_PUBLIC_QUOTA_UNAVAILABLE'].includes(code)) {
          setFailKind('retry')
          setFailMsg(userMessageOf(err, '优化请求超时或繁忙，请重试。已生成的结果不会重复扣次。'))
          return
        }
        setFailKind('reparse')
        setFailMsg(userMessageOf(err, '优化结果读取失败，请返回重新解析'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [taskId, token, accessToken, consentChecking, consentNeedsPrompt, consentReady, retryNonce, syntheticReady, requested, setFailKind, setFailMsg, setLoading, setModules, setOptimizedResume])
}
