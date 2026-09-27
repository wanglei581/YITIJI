import { resumeUserReason } from '../../resumeUserCopy'
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { GeneratedResume, ResumeOptimizeModule, ResumeTemplate } from '@ai-job-print/shared'
import { getResumeOptimize, type ResumeReadAccess } from '../../../../services/api'
import { getResumeTemplates } from '../../../../services/api/jobMaterials'
import { errorCodeOf, userMessageOf } from '../../../../services/api/userErrorMessage'
import { isAiOutage } from '../../../../ai/aiOutage'
import { SYNTHETIC_MODULES, SYNTHETIC_RESUME } from './fixtures'
import type { OptimizeViewState } from './constants'

import { useBusyLock } from '../../../../contexts/KioskBusyContext'

// 最长一次读取为 100 秒；全局硬隐私截止照常运行，不受此锁豁免。
export const OPTIMIZE_LOAD_LIMIT_MS = 100_000

type FailKind = 'retry' | 'reparse' | 'expired' | 'consent' | 'outage'

export function useOptimizeLoad(opts: {
  taskId?: string
  existingOnly?: boolean
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
    taskId, existingOnly = false, access, syntheticReady, requested, consentChecking, consentNeedsPrompt, consentReady, retryNonce,
    setLoading, setFailKind, setFailMsg, setModules, setOptimizedResume,
    setTemplatesError, setResumeTemplates, setSelectedTemplateId,
  } = opts
  const [requestBusy, setRequestBusy] = useState(false)
  useBusyLock(requestBusy)
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
    if (!taskId) { setLoading(false); setFailKind('reparse'); setFailMsg('优化建议基于诊断结果生成。回到 AI 简历服务上传简历并完成诊断后，再进入本页。'); return }
    if (consentChecking || consentNeedsPrompt || !consentReady) { setLoading(true); return }
    let cancelled = false
    setRequestBusy(true)
    const timer = setTimeout(() => {
      cancelled = true
      setRequestBusy(false)
      setLoading(false)
      setFailKind('retry')
      setFailMsg('等待时间较长，请重试。已生成的结果会保留。')
    }, OPTIMIZE_LOAD_LIMIT_MS)
    setModules([])
    setOptimizedResume(null)
    setLoading(true)
    setFailMsg(null)
    getResumeOptimize(taskId, { token, accessToken }, existingOnly)
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
          const reason = resumeUserReason(res.failReason, '本次没有生成优化建议，可重试或返回重新解析')
          setFailKind(reason.includes('重新上传') ? 'expired' : 'retry')
          setFailMsg(reason)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const code = errorCodeOf(err)
        if (code === 'AI_TASK_NOT_FOUND') { setFailKind('reparse'); setFailMsg('这份结果已删除、已超过保存期限或不属于当前账号，无法打开。请返回记录列表选择其他简历，或重新上传。'); return }
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
      .finally(() => { if (!cancelled) { clearTimeout(timer); setLoading(false); setRequestBusy(false) } })
    return () => { cancelled = true; clearTimeout(timer); setRequestBusy(false) }
  }, [taskId, existingOnly, token, accessToken, consentChecking, consentNeedsPrompt, consentReady, retryNonce, syntheticReady, requested, setFailKind, setFailMsg, setLoading, setModules, setOptimizedResume])
}
