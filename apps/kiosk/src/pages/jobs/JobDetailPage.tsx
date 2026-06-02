import { useEffect, useState } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { Button, Card, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobDTO } from '@ai-job-print/shared'
import {
  BuildingIcon,
  BriefcaseIcon,
  ExternalLinkIcon,
  GraduationCapIcon,
  InfoIcon,
  MapPinIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  TagIcon,
  XIcon,
} from 'lucide-react'
import { getJobById } from '../../services/api'
import { enrichJob, type JobCardView } from '../../data/jobsMeta'

const TAG_STYLES: Record<string, string> = {
  全职: 'bg-blue-50 text-blue-600',
  实习: 'bg-orange-50 text-orange-600',
  校招: 'bg-green-50 text-green-600',
  兼职: 'bg-purple-50 text-purple-600',
}

function formatSync(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

// ─── QR overlay ───────────────────────────────────────────────────────────────

function QrOverlay({
  sourceName,
  externalId,
  onClose,
}: {
  sourceName: string
  externalId: string
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="relative w-80 rounded-2xl bg-white p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100"
        >
          <XIcon className="h-5 w-5" />
        </button>

        <p className="text-center text-base font-semibold text-gray-800">来源平台二维码</p>

        <div className="mx-auto mt-5 flex h-44 w-44 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50">
          <div className="flex flex-col items-center gap-2 text-gray-300">
            <QrCodeIcon className="h-16 w-16" />
            <span className="text-xs">二维码由来源平台生成</span>
          </div>
        </div>

        <div className="mt-5 space-y-1.5 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-500">
          <div className="flex justify-between">
            <span className="text-gray-400">来源机构</span>
            <span className="font-medium">{sourceName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">外部编号</span>
            <span className="font-mono">{externalId}</span>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2">
          <SmartphoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
          <p className="text-xs leading-relaxed text-gray-500">
            请使用手机前往来源平台办理，本系统不接收简历，不参与招聘闭环。
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── 小信息块 ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="shrink-0 text-gray-400">{label}</span>
      <span className="text-right text-gray-700">{value}</span>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function JobDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const location = useLocation()

  const stateJob = (location.state as { job?: ExternalJobDTO } | null)?.job
  const hasStateMatch = stateJob?.id === id

  const [job, setJob] = useState<JobCardView | null>(
    hasStateMatch ? enrichJob(stateJob!) : null,
  )
  const [loading, setLoading] = useState(!hasStateMatch)
  const [error, setError] = useState(false)
  const [showQr, setShowQr] = useState(false)

  useEffect(() => {
    if (hasStateMatch) return
    let cancelled = false
    getJobById(id!)
      .then((res) => {
        if (cancelled) return
        if (res.data) setJob(enrichJob(res.data))
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

  if (loading) {
    return <LoadingState className="h-full" />
  }

  if (error || !job) {
    return (
      <ErrorState
        message="岗位数据未找到，请返回列表重试"
        onRetry={() => navigate('/jobs')}
        className="h-full"
      />
    )
  }

  const locationText = [job.city, job.district].filter(Boolean).join(' · ')

  return (
    <div className="flex h-full flex-col">
      {showQr && (
        <QrOverlay
          sourceName={job.sourceOrgName ?? job.sourceName}
          externalId={job.externalId}
          onClose={() => setShowQr(false)}
        />
      )}

      <div className="px-6 pt-6">
        <PageHeader
          title="岗位详情"
          subtitle={job.sourceOrgName ?? job.sourceName}
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate('/jobs')}>
              返回列表
            </Button>
          }
        />
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        {/* 基本信息卡 */}
        <Card className="p-5">
          <h2 className="text-xl font-bold text-gray-900">{job.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-gray-600">
            <span className="flex items-center gap-1.5">
              <BuildingIcon className="h-4 w-4 text-gray-400" />
              {job.company}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPinIcon className="h-4 w-4 text-gray-400" />
              {locationText}
            </span>
            <span className="flex items-center gap-1.5">
              <GraduationCapIcon className="h-4 w-4 text-gray-400" />
              {job.education ?? '学历不限'} · {job.experience ?? '经验不限'}
            </span>
          </div>
          <p className="mt-3 text-lg font-semibold text-primary-600">{job.salaryDisplay}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {job.tags.map((t) => (
              <span
                key={t}
                className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium ${TAG_STYLES[t] ?? 'bg-gray-100 text-gray-500'}`}
              >
                <TagIcon className="h-3 w-3" />
                {t}
              </span>
            ))}
          </div>
        </Card>

        {/* 岗位要求 */}
        {(job.description || job.requirements) && (
          <Card className="p-5">
            {job.description && (
              <div className="mb-4">
                <p className="mb-2 text-sm font-medium text-gray-700">岗位描述</p>
                <p className="text-sm leading-relaxed text-gray-600">{job.description}</p>
              </div>
            )}
            {job.requirements && (
              <div>
                <p className="mb-2 text-sm font-medium text-gray-700">岗位要求</p>
                <p className="text-sm leading-relaxed text-gray-600">{job.requirements}</p>
              </div>
            )}
          </Card>
        )}

        {/* 企业信息 */}
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <BriefcaseIcon className="h-4 w-4 text-gray-400" />
            <p className="text-sm font-medium text-gray-700">企业信息</p>
          </div>
          <div className="space-y-2">
            <InfoRow label="企业名称" value={job.company} />
            <InfoRow label="工作地点" value={locationText} />
            {job.industry && <InfoRow label="所属行业" value={job.industry} />}
            <InfoRow label="学历要求" value={job.education ?? '学历不限'} />
            <InfoRow label="经验要求" value={job.experience ?? '经验不限'} />
          </div>
        </Card>

        {/* 来源说明 */}
        <Card className="p-5">
          <p className="mb-3 text-sm font-medium text-gray-700">数据来源</p>
          <div className="space-y-2">
            <InfoRow label="来源机构" value={job.sourceOrgName ?? job.sourceName} />
            <InfoRow label="同步时间" value={formatSync(job.syncTime)} />
            <div className="flex justify-between gap-4 text-sm">
              <span className="shrink-0 text-gray-400">外部编号</span>
              <span className="text-right font-mono text-xs text-gray-600">{job.externalId}</span>
            </div>
          </div>
        </Card>

        {/* 合规说明 */}
        <div className="flex items-start gap-2 rounded-lg border border-primary-100 bg-primary-50/50 px-4 py-3">
          <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
          <p className="text-xs leading-relaxed text-gray-500">
            本岗位来自第三方/官方来源，本系统不接收简历、不参与招聘流程。
            <span className="mt-1 block text-gray-400">
              {job.dataSourceNote}
            </span>
          </p>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="border-t border-neutral-100 px-6 pb-6 pt-3">
        <div className="grid grid-cols-2 gap-3">
          <Button
            size="lg"
            className="flex items-center gap-2"
            onClick={() => setShowQr(true)}
          >
            <ExternalLinkIcon className="h-4 w-4" />
            去来源平台投递
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="flex items-center gap-2"
            onClick={() => setShowQr(true)}
          >
            <QrCodeIcon className="h-4 w-4" />
            扫码投递
          </Button>
        </div>
        <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-neutral-400">
          <InfoIcon className="h-3 w-3" />
          投递将跳转至来源平台办理，本系统不收取简历
        </div>
      </div>
    </div>
  )
}
