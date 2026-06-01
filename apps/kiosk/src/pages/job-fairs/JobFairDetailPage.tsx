import { useEffect, useState } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { Button, Card, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobFairDTO } from '@ai-job-print/shared'
import {
  ActivityIcon,
  BuildingIcon,
  CalendarIcon,
  ExternalLinkIcon,
  FileTextIcon,
  InfoIcon,
  MapIcon,
  MapPinIcon,
  PrinterIcon,
  QrCodeIcon,
  SmartphoneIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react'
import { getJobFairById } from '../../services/api'

const STATUS_CONFIG = {
  upcoming: { label: '未开始', bg: 'bg-blue-50',  text: 'text-blue-600' },
  ongoing:  { label: '进行中', bg: 'bg-green-50', text: 'text-green-700' },
  ended:    { label: '已结束', bg: 'bg-gray-100', text: 'text-gray-400' },
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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
        <p className="text-center text-base font-semibold text-gray-800">扫码前往来源平台预约</p>
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
            请使用手机前往来源平台办理，预约结果由对方平台管理，本系统不参与活动报名流程。
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function JobFairDetailPage() {
  const navigate = useNavigate()
  const { id }   = useParams<{ id: string }>()
  const location = useLocation()

  const stateFair = (location.state as { fair?: ExternalJobFairDTO } | null)?.fair
  const hasStateMatch = stateFair?.id === id

  const [fair,    setFair]    = useState<ExternalJobFairDTO | null>(hasStateMatch ? stateFair! : null)
  const [loading, setLoading] = useState(!hasStateMatch)
  const [error,   setError]   = useState(false)
  const [showQr,  setShowQr]  = useState(false)

  useEffect(() => {
    if (hasStateMatch) return
    let cancelled = false
    getJobFairById(id!)
      .then((res) => { if (!cancelled) { setFair(res.data); if (!res.data) setError(true) } })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, hasStateMatch])

  if (loading) {
    return <LoadingState className="h-full" />
  }

  if (error || !fair) {
    return (
      <ErrorState
        message="活动数据未找到，请返回列表重试"
        onRetry={() => navigate('/job-fairs')}
        className="h-full"
      />
    )
  }

  const sc      = STATUS_CONFIG[fair.status]
  const isEnded = fair.status === 'ended'
  const fairId  = fair.id

  const handlePrintMaterial = () => {
    navigate('/print/confirm', {
      state: {
        file: { name: `${fair.name}_活动资料.pdf`, size: '256 KB', pages: 2 },
        copies: 1,
        duplex: 'single',
        color: 'bw',
      },
    })
  }

  return (
    <div className="flex h-full flex-col">
      {showQr && (
        <QrOverlay
          sourceName={fair.sourceName}
          externalId={fair.externalId}
          onClose={() => setShowQr(false)}
        />
      )}

      <div className="px-6 pt-6">
        <PageHeader
          title="招聘会详情"
          subtitle={fair.sourceName}
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate('/job-fairs')}>
              返回列表
            </Button>
          }
        />
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        {/* 基本信息卡 */}
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="flex-1 text-xl font-bold text-gray-900">{fair.name}</h2>
            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${sc.bg} ${sc.text}`}>
              {sc.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">主办方：{fair.organizer}</p>
          <div className="mt-4 space-y-2 text-sm text-gray-700">
            <div className="flex items-start gap-2">
              <CalendarIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              <span>
                {formatDateTime(fair.startTime)}
                <span className="mx-1 text-gray-400">–</span>
                {formatDateTime(fair.endTime)}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              <span>{fair.venue}</span>
            </div>
            {fair.boothCount && (
              <div className="flex items-center gap-2">
                <UsersIcon className="h-4 w-4 shrink-0 text-gray-400" />
                <span>{fair.boothCount} 家单位参展</span>
              </div>
            )}
          </div>
        </Card>

        {fair.description && (
          <Card className="p-5">
            <p className="mb-2 text-sm font-medium text-gray-700">活动简介</p>
            <p className="text-sm leading-relaxed text-gray-600">{fair.description}</p>
          </Card>
        )}

        {/* 来源信息（合规必展示） */}
        <Card className="p-5">
          <p className="mb-3 text-sm font-medium text-gray-700">数据来源</p>
          <div className="space-y-2 text-sm text-gray-600">
            <div className="flex justify-between">
              <span className="text-gray-400">来源机构</span>
              <span>{fair.sourceName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">同步时间</span>
              <span>{formatSync(fair.syncTime)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">外部编号</span>
              <span className="font-mono text-xs">{fair.externalId}</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-400">{fair.dataSourceNote}</p>
        </Card>

        {/* 现场服务（有数字化数据时显示） */}
        {fair.hasManagedData && (
          <Card className="p-5">
            <p className="mb-3 text-sm font-medium text-gray-700">现场服务</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button
                className="flex flex-col items-center gap-1.5 rounded-xl bg-gray-50 p-3 text-center transition-colors hover:bg-primary-50"
                onClick={() => navigate(`/job-fairs/${fairId}/companies`)}
              >
                <BuildingIcon className="h-5 w-5 text-primary-500" />
                <span className="text-xs font-medium text-gray-700">参会企业</span>
                <span className="text-xs text-gray-400">{fair.managedCompanyCount} 家</span>
              </button>
              <button
                className="flex flex-col items-center gap-1.5 rounded-xl bg-gray-50 p-3 text-center transition-colors hover:bg-primary-50"
                onClick={() => navigate(`/job-fairs/${fairId}/map`)}
              >
                <MapIcon className="h-5 w-5 text-primary-500" />
                <span className="text-xs font-medium text-gray-700">展馆导览</span>
                <span className="text-xs text-gray-400">展位分布</span>
              </button>
              <button
                className="flex flex-col items-center gap-1.5 rounded-xl bg-gray-50 p-3 text-center transition-colors hover:bg-primary-50"
                onClick={() => navigate(`/job-fairs/${fairId}/materials`)}
              >
                <FileTextIcon className="h-5 w-5 text-primary-500" />
                <span className="text-xs font-medium text-gray-700">活动资料</span>
                <span className="text-xs text-gray-400">{fair.managedMaterialCount} 份</span>
              </button>
              <button
                className="flex flex-col items-center gap-1.5 rounded-xl bg-gray-50 p-3 text-center transition-colors hover:bg-primary-50"
                onClick={() => navigate(`/job-fairs/${fairId}/stats`)}
              >
                <ActivityIcon className="h-5 w-5 text-primary-500" />
                <span className="text-xs font-medium text-gray-700">现场数据</span>
                <span className="text-xs text-gray-400">准实时</span>
              </button>
            </div>
          </Card>
        )}

        <div className="flex items-start gap-2 rounded-lg bg-gray-50 px-4 py-3">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
          <p className="text-xs leading-relaxed text-gray-400">
            本系统仅展示第三方来源招聘会信息，不参与活动报名流程。系统仅记录外部跳转行为，活动预约由来源平台管理。
          </p>
        </div>
      </div>

      <div className="px-6 pb-6 pt-2">
        <div className="grid grid-cols-2 gap-3">
          {!isEnded && (
            <>
              <Button size="lg" className="flex items-center gap-2" onClick={() => setShowQr(true)}>
                <ExternalLinkIcon className="h-4 w-4" />
                去来源平台预约
              </Button>
              <Button size="lg" variant="secondary" className="flex items-center gap-2" onClick={() => setShowQr(true)}>
                <QrCodeIcon className="h-4 w-4" />
                扫码预约
              </Button>
            </>
          )}
          <Button
            size="lg"
            variant="secondary"
            className={`flex items-center gap-2 ${isEnded ? 'col-span-2' : ''}`}
            onClick={handlePrintMaterial}
          >
            <PrinterIcon className="h-4 w-4" />
            打印活动资料
          </Button>
          {isEnded && (
            <Button size="lg" variant="secondary" className="col-span-2" onClick={() => navigate('/job-fairs')}>
              返回列表
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
