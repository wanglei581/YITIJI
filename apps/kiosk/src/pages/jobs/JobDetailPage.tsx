import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobDTO, JobExplainResponse, MemberResumeItem } from '@ai-job-print/shared'
import { getJobById } from '../../services/api'
import {
  explainJobWithAi,
  getJobAiConsentStatus,
  grantJobAiConsent,
  matchJobWithAi,
  type JobAiMatchResponse,
} from '../../services/api/jobAi'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { ApiHttpError } from '../../services/api/httpAdapter'
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
  StickyActionBar,
} from './components/JobDetailSections'

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

  function openSourceQr() {
    recordExternalJump(getToken(), 'job', currentJob.id, 'external_apply')
    setShowQr(true)
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
    <div className="flex h-full flex-col">
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

      <div className="px-6 pt-6">
        <PageHeader
          title="岗位详情"
          subtitle={currentJob.sourceName}
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate('/jobs')}>
              返回列表
            </Button>
          }
        />
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
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
      </div>

      <StickyActionBar sourceCanApply={sourceCanApply} onOpenSource={openSourceQr} />
    </div>
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
