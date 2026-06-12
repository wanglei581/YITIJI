import { useEffect, useState } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { Button, Card, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobDTO } from '@ai-job-print/shared'
import {
  BuildingIcon,
  BriefcaseIcon,
  ExternalLinkIcon,
  InfoIcon,
  MapPinIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  StarIcon,
  TagIcon,
  XIcon,
} from 'lucide-react'
import { getJobById } from '../../services/api'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { isValidSourceUrl } from '../../lib/url'
import { useFavorites } from '../../favorites/useFavorites'
import { useAuth } from '../../auth/useAuth'

const CATEGORY_LABEL: Record<string, string> = {
  fulltime: '全职',
  intern: '实习',
  campus: '校招',
  parttime: '兼职',
}

const CATEGORY_STYLE: Record<string, string> = {
  fulltime: 'bg-blue-50 text-blue-600',
  intern: 'bg-orange-50 text-orange-600',
  campus: 'bg-green-50 text-green-600',
  parttime: 'bg-purple-50 text-purple-600',
}

function formatSync(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

// ─── QR overlay：内容为真实 sourceUrl ───────────────────────────────────────────

function QrOverlay({
  sourceName,
  sourceUrl,
  externalId,
  onClose,
}: {
  sourceName: string
  sourceUrl: string
  externalId: string
  onClose: () => void
}) {
  const valid = isValidSourceUrl(sourceUrl)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="relative w-[22rem] max-w-full rounded-2xl bg-white p-7 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="关闭"
          className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100"
        >
          <XIcon className="h-5 w-5" />
        </button>

        <p className="text-center text-base font-semibold text-gray-800">扫码前往来源平台投递</p>

        <div className="mt-5 flex justify-center">
          <SourceUrlQr value={sourceUrl} size={196} />
        </div>

        {valid && (
          <p className="mt-3 break-all rounded-lg bg-gray-50 px-3 py-2 text-center text-[11px] text-gray-500">
            {sourceUrl}
          </p>
        )}

        <div className="mt-4 space-y-1.5 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-500">
          <div className="flex justify-between gap-3">
            <span className="text-gray-400">来源机构</span>
            <span className="text-right font-medium">{sourceName}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-400">外部编号</span>
            <span className="font-mono">{externalId}</span>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2">
          <SmartphoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
          <p className="text-xs leading-relaxed text-gray-500">
            请使用手机扫码前往来源平台办理投递，本系统不接收简历、不参与招聘闭环。
          </p>
        </div>
      </div>
    </div>
  )
}

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
  const { isFavorite, toggle: toggleFavorite } = useFavorites()
  const { getToken } = useAuth()

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

  // 浏览记录（P1）：详情真实加载成功后上报一次；fire-and-forget，失败不影响页面。
  // 服务端 30 分钟窗口去重，反复进出不会刷屏「我的」记录。
  useEffect(() => {
    if (job?.id) recordBrowse(getToken(), 'job', job.id)
  }, [job?.id, getToken])

  // 外部跳转记录（P1）：记录的是「打开来源平台入口」这一动作本身，
  // 不记录、也无法得知用户是否在来源平台完成投递。
  const openSourceQr = () => {
    recordExternalJump(getToken(), 'job', job!.id, 'external_apply')
    setShowQr(true)
  }

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

  const fav = isFavorite('job', job.id)
  const sourceCanApply = isValidSourceUrl(job.sourceUrl)

  return (
    <div className="flex h-full flex-col">
      {showQr && (
        <QrOverlay
          sourceName={job.sourceName}
          sourceUrl={job.sourceUrl}
          externalId={job.externalId}
          onClose={() => setShowQr(false)}
        />
      )}

      <div className="px-6 pt-6">
        <PageHeader
          title="岗位详情"
          subtitle={job.sourceName}
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
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-bold text-gray-900">{job.title}</h2>
            <button
              onClick={() => toggleFavorite({ type: 'job', id: job.id, title: job.title })}
              aria-pressed={fav}
              aria-label={fav ? '取消收藏' : '收藏岗位'}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
            >
              <StarIcon className={`h-4 w-4 ${fav ? 'fill-amber-400 text-amber-400' : 'text-neutral-300'}`} />
              {fav ? '已收藏' : '收藏'}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-gray-600">
            <span className="flex items-center gap-1.5">
              <BuildingIcon className="h-4 w-4 text-gray-400" />
              {job.company}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPinIcon className="h-4 w-4 text-gray-400" />
              {job.city}
            </span>
          </div>
          <p className="mt-3 text-lg font-semibold text-primary-600">{job.salaryDisplay}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {job.category && (
              <span
                className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium ${CATEGORY_STYLE[job.category] ?? 'bg-gray-100 text-gray-500'}`}
              >
                {CATEGORY_LABEL[job.category] ?? job.category}
              </span>
            )}
            {job.tags.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1 rounded bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500"
              >
                <TagIcon className="h-3 w-3" />
                {t}
              </span>
            ))}
          </div>
        </Card>

        {/* 岗位描述 / 要求 */}
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

        {/* 企业 / 岗位信息 */}
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <BriefcaseIcon className="h-4 w-4 text-gray-400" />
            <p className="text-sm font-medium text-gray-700">岗位信息</p>
          </div>
          <div className="space-y-2">
            <InfoRow label="企业名称" value={job.company} />
            <InfoRow label="工作地点" value={job.city} />
            {job.industry && <InfoRow label="所属行业" value={job.industry} />}
            {job.category && <InfoRow label="岗位类型" value={CATEGORY_LABEL[job.category] ?? job.category} />}
          </div>
        </Card>

        {/* 来源说明 */}
        <Card className="p-5">
          <p className="mb-3 text-sm font-medium text-gray-700">数据来源</p>
          <div className="space-y-2">
            <InfoRow label="来源机构" value={job.sourceName} />
            <InfoRow label="同步时间" value={formatSync(job.syncTime)} />
            <div className="flex justify-between gap-4 text-sm">
              <span className="shrink-0 text-gray-400">外部编号</span>
              <span className="text-right font-mono text-xs text-gray-600">{job.externalId}</span>
            </div>
            <div className="flex justify-between gap-4 text-sm">
              <span className="shrink-0 text-gray-400">来源链接</span>
              <span className="break-all text-right text-xs text-gray-600">
                {sourceCanApply ? job.sourceUrl : '来源平台未提供有效链接'}
              </span>
            </div>
          </div>
        </Card>

        {/* 企业展示联动:岗位已关联来源企业时提供「查看企业」入口 */}
        {job.companyProfileId && (
          <button
            type="button"
            onClick={() => navigate(`/companies/${job.companyProfileId}`)}
            className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 text-left transition-colors hover:bg-gray-50 active:bg-gray-100"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <BuildingIcon className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-900">查看企业</span>
              <span className="block truncate text-xs text-gray-400">{job.company} · 来源企业展示页</span>
            </span>
            <ExternalLinkIcon className="h-4 w-4 shrink-0 text-gray-300" aria-hidden="true" />
          </button>
        )}

        {/* 合规说明 */}
        <div className="flex items-start gap-2 rounded-lg border border-primary-100 bg-primary-50/50 px-4 py-3">
          <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
          <p className="text-xs leading-relaxed text-gray-500">
            本岗位来自第三方/官方来源，本系统不接收简历、不参与招聘流程。
            <span className="mt-1 block text-gray-400">{job.dataSourceNote}</span>
          </p>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="border-t border-neutral-100 px-6 pb-6 pt-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            size="lg"
            className="flex items-center gap-2"
            disabled={!sourceCanApply}
            onClick={openSourceQr}
          >
            <ExternalLinkIcon className="h-4 w-4" />
            去来源平台投递
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="flex items-center gap-2"
            disabled={!sourceCanApply}
            onClick={openSourceQr}
          >
            <QrCodeIcon className="h-4 w-4" />
            扫码投递
          </Button>
        </div>
        <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-neutral-400">
          <InfoIcon className="h-3 w-3" />
          {sourceCanApply
            ? '扫码将跳转至来源平台办理，本系统不收取简历'
            : '来源平台未提供有效投递链接，请前往来源机构咨询'}
        </div>
      </div>
    </div>
  )
}
