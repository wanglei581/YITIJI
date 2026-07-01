import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobDTO } from '@ai-job-print/shared'
import { getJobById } from '../../services/api'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { isValidSourceUrl } from '../../lib/url'
import { useAuth } from '../../auth/useAuth'
import { useFavorites } from '../../favorites/useFavorites'
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

  function goJobFit() {
    navigate('/resume/job-fit', { state: { selectedJob: currentJob } })
  }

  return (
    <div className="flex h-full flex-col">
      {showQr && <QrOverlay job={currentJob} onClose={() => setShowQr(false)} />}

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
          onGoFit={goJobFit}
        />
      </div>

      <StickyActionBar sourceCanApply={sourceCanApply} onOpenSource={openSourceQr} />
    </div>
  )
}
