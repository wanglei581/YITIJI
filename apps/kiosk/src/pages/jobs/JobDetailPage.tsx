import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ErrorState, LoadingState } from '@ai-job-print/ui'
import type { ExternalJobDTO, JobExplainResponse, MemberResumeItem } from '@ai-job-print/shared'
import { ExternalLinkIcon, QrCodeIcon } from 'lucide-react'
import { getJobById } from '../../services/api'
import {
  explainJobWithAi,
  getJobAiConsentStatus,
  grantJobAiConsent,
  matchJobWithAi,
  type JobAiMatchResponse,
} from '../../services/api/jobAi'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { getTerminalId } from '../../services/api/screensaver'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { SOURCE_APPLY_UNAVAILABLE_REASON } from '../../lib/capabilityReasons'
import { isValidSourceUrl } from '../../lib/url'
import { useAuth } from '../../auth/useAuth'
import { useFavorites } from '../../favorites/useFavorites'
import { JobAiConsentModal } from './components/JobAiConsentModal'
import { ResumeSelectModal } from './components/ResumeSelectModal'
import { JobAiResultPanel } from './components/JobAiResultPanel'
import {
  JobDescriptionSection,
  JobNextActionsSection,
  JobSummarySection,
  JobTrustSection,
  QrOverlay,
} from './components/JobDetailSections'
import { FusionBadge, KioskPageFrame } from './components/W4Presentation'

export function JobDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const { getToken } = useAuth()
  const { isFavorite, toggle: toggleFavorite } = useFavorites()

  const stateJob = (location.state as { job?: ExternalJobDTO } | null)?.job
  const hasStateMatch = stateJob?.id === id

  const [job, setJob] = useState<ExternalJobDTO | null>(hasStateMatch ? stateJob! : null)
  const [loading, setLoading] = useState(!hasStateMatch)
  const [error, setError] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [pendingAiAction, setPendingAiAction] = useState<'explain' | 'match' | null>(null)
  const [showConsent, setShowConsent] = useState(false)
  const [showResumeSelect, setShowResumeSelect] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [explanation, setExplanation] = useState<JobExplainResponse | null>(null)
  const [matchResult, setMatchResult] = useState<JobAiMatchResponse | null>(null)
  const mountedRef = useRef(false)
  const aiInFlightRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (hasStateMatch) return
    let cancelled = false
    getJobById(id!)
      .then((res) => {
        if (cancelled) return
        if (res.data) setJob(res.data)
        else setError(true)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, hasStateMatch])

  useEffect(() => {
    if (job?.id) recordBrowse(getToken(), 'job', job.id)
  }, [job?.id, getToken])

  if (loading) {
    return <LoadingState className="h-full" />
  }

  if (error || !job) {
    return (
      <ErrorState
        message="岗位数据未找到或后端服务未连接，请返回列表重试"
        onRetry={() => navigate('/jobs')}
        className="h-full"
      />
    )
  }

  const currentJob = job
  const favorite = isFavorite('job', currentJob.id)
  const sourceCanApply = isValidSourceUrl(currentJob.sourceUrl)
  const isTerminalKiosk = Boolean(getTerminalId())

  function openSourceQr() {
    if (!sourceCanApply) return
    recordExternalJump(getToken(), 'job', currentJob.id, 'external_apply')
    setShowQr(true)
  }

  function openSourcePlatform() {
    if (!sourceCanApply) return
    if (isTerminalKiosk) {
      openSourceQr()
      return
    }
    recordExternalJump(getToken(), 'job', currentJob.id, 'external_apply')
    window.open(currentJob.sourceUrl, '_blank', 'noopener,noreferrer')
  }

  function viewCompany() {
    if (currentJob.companyProfileId) navigate(`/companies/${currentJob.companyProfileId}`)
  }

  function requireToken(): string | null {
    const token = getToken()
    if (!token) {
      navigate('/login', { state: { from: `/jobs/${currentJob.id}` } })
      return null
    }
    return token
  }

  async function ensureConsent(token: string, action: 'explain' | 'match'): Promise<boolean> {
    setAiError(null)
    try {
      const rows = await getJobAiConsentStatus(token)
      if (!mountedRef.current) return false
      if (rows.some((row) => row.scope === 'job_ai' && row.granted)) return true
      setPendingAiAction(action)
      setShowConsent(true)
      return false
    } catch (err) {
      if (!mountedRef.current) return false
      setAiError(formatJobAiError(err))
      return false
    }
  }

  async function startExplain() {
    if (aiInFlightRef.current || aiLoading) return
    const token = requireToken()
    if (!token) return
    aiInFlightRef.current = true
    try {
      setPendingAiAction('explain')
      if (!(await ensureConsent(token, 'explain'))) return
      await runExplain(token)
    } finally {
      aiInFlightRef.current = false
    }
  }

  async function startMatch() {
    if (aiInFlightRef.current || aiLoading) return
    const token = requireToken()
    if (!token) return
    aiInFlightRef.current = true
    try {
      setPendingAiAction('match')
      if (!(await ensureConsent(token, 'match'))) return
      if (mountedRef.current) setShowResumeSelect(true)
    } finally {
      aiInFlightRef.current = false
    }
  }

  async function confirmConsent() {
    if (aiInFlightRef.current || aiLoading) return
    const token = requireToken()
    if (!token || !pendingAiAction) return
    aiInFlightRef.current = true
    setAiLoading(true)
    setAiError(null)
    try {
      await grantJobAiConsent(token)
      if (!mountedRef.current) return
      setShowConsent(false)
      if (pendingAiAction === 'explain') await runExplain(token)
      else setShowResumeSelect(true)
    } catch (err) {
      if (!mountedRef.current) return
      setAiError(formatJobAiError(err))
    } finally {
      aiInFlightRef.current = false
      if (mountedRef.current) setAiLoading(false)
    }
  }

  async function runExplain(token: string) {
    setAiLoading(true)
    setAiError(null)
    setMatchResult(null)
    try {
      const result = await explainJobWithAi(token, currentJob.id)
      if (!mountedRef.current) return
      setExplanation(result)
    } catch (err) {
      if (!mountedRef.current) return
      setAiError(formatJobAiError(err))
    } finally {
      if (mountedRef.current) setAiLoading(false)
    }
  }

  async function runMatch(resume: MemberResumeItem) {
    if (aiInFlightRef.current || aiLoading) return
    const token = requireToken()
    if (!token) return
    aiInFlightRef.current = true
    setShowResumeSelect(false)
    setAiLoading(true)
    setAiError(null)
    setExplanation(null)
    try {
      const result = await matchJobWithAi(token, currentJob.id, resume.taskId)
      if (!mountedRef.current) return
      setMatchResult(result)
    } catch (err) {
      if (!mountedRef.current) return
      setAiError(formatJobAiError(err))
    } finally {
      aiInFlightRef.current = false
      if (mountedRef.current) setAiLoading(false)
    }
  }

  return (
    <KioskPageFrame
      tone="clay"
      title="岗位详情"
      subtitle={`${currentJob.sourceName} · 信息以来源平台为准`}
      backLabel="返回列表"
      onBack={() => navigate('/jobs')}
      badge={<FusionBadge icon={ExternalLinkIcon}>线上招聘平台来源</FusionBadge>}
      actionBar={
        <>
          <span className="jf-action-note">
            投递在来源平台完成，本终端不接收简历、不参与招聘流程
            {sourceCanApply ? null : (
              <b id="job-detail-apply-blocked" className="jf-blocked-reason">
                {SOURCE_APPLY_UNAVAILABLE_REASON}
              </b>
            )}
          </span>
          <div className="jf-spacer" />
          {/* 能力门禁置灰：aria-disabled 而不是原生 disabled —— 原生 disabled 会把按钮
              踢出 Tab 序列、读屏直接跳过，旁边那句原因就永远不会被念出来。
              放行由 openSourceQr / openSourcePlatform 自身的 `if (!sourceCanApply) return`
              兜底，置灰不是靠属性拦的，点了也不会真的跳出去。 */}
          <button
            type="button"
            className="jf-btn dark"
            aria-disabled={!sourceCanApply || undefined}
            aria-describedby={sourceCanApply ? undefined : 'job-detail-apply-blocked'}
            onClick={openSourceQr}
          >
            <QrCodeIcon aria-hidden="true" />
            扫码投递
          </button>
          <button
            type="button"
            className="jf-btn primary"
            aria-disabled={!sourceCanApply || undefined}
            aria-describedby={sourceCanApply ? undefined : 'job-detail-apply-blocked'}
            onClick={openSourcePlatform}
          >
            <ExternalLinkIcon aria-hidden="true" />
            去来源平台投递
          </button>
        </>
      }
    >
      {showQr && <QrOverlay job={currentJob} onClose={() => setShowQr(false)} />}
      <JobAiConsentModal
        open={showConsent}
        loading={aiLoading}
        error={showConsent ? aiError : null}
        onConfirm={() => void confirmConsent()}
        onCancel={() => {
          setShowConsent(false)
          setPendingAiAction(null)
        }}
      />
      <ResumeSelectModal
        open={showResumeSelect}
        token={getToken()}
        onClose={() => setShowResumeSelect(false)}
        onSelect={(resume) => void runMatch(resume)}
        onUpload={() => navigate('/resume/source?intent=diagnose')}
      />
      <JobSummarySection
        job={currentJob}
        favorite={favorite}
        onToggleFavorite={() => toggleFavorite({ type: 'job', id: currentJob.id, title: currentJob.title })}
      />
      <JobDescriptionSection job={currentJob} />
      <JobTrustSection job={currentJob} sourceCanApply={sourceCanApply} />
      <JobNextActionsSection
        job={currentJob}
        sourceCanApply={sourceCanApply}
        onOpenQr={openSourceQr}
        onViewCompany={viewCompany}
        onExplainAi={() => void startExplain()}
        onMatchAi={() => void startMatch()}
        // 这里原来传 `state: { source:'job_detail', jobId, jobTitle }`，三个都没人读：
        // `/print/upload` 的 source 取自 **query**（`searchParams.get('source')`）而不是 state，
        // 且取值只认 'resume' | 'document'，'job_detail' 不是合法值；jobId / jobTitle
        // 在整个打印链路里没有任何消费点。传了不用会让人以为岗位上下文已经带过去了，
        // 实际落到的一直是默认的「文档打印」。改成如实不传。
        onPrint={() => navigate('/print/upload')}
      />
      {(aiLoading || aiError || explanation || matchResult) && (
        <JobAiResultPanel
          title={matchResult ? '岗位匹配参考' : 'AI岗位解读'}
          loading={aiLoading}
          error={aiError}
          explanation={explanation}
          match={matchResult}
          onRetry={() => {
            if (pendingAiAction === 'match') void startMatch()
            else void startExplain()
          }}
          onClear={() => {
            setExplanation(null)
            setMatchResult(null)
            setAiError(null)
          }}
        />
      )}
    </KioskPageFrame>
  )
}

function formatJobAiError(err: unknown): string {
  if (err instanceof ApiHttpError) {
    if (err.code === 'JOB_AI_QUOTA_EXCEEDED') return '今日 AI 辅助额度已用完，请明天再试。'
    if (err.code === 'JOB_AI_QUOTA_UNAVAILABLE') return '岗位 AI 配额服务暂不可用，请联系现场工作人员确认服务状态。'
    if (err.code === 'USER_AI_CONSENT_REQUIRED') return '请先确认岗位 AI 辅助授权。'
    if (err.code === 'JOB_AI_MOCK_DISABLED') return '岗位 AI 需要连接真实后端服务后使用。'
    return err.message
  }
  return err instanceof Error ? err.message : 'AI 辅助暂时不可用，请稍后重试。'
}
