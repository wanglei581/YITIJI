import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobFairDTO } from '@ai-job-print/shared'
import { CalendarIcon, MapPinIcon, QrCodeIcon, SmartphoneIcon, XIcon } from 'lucide-react'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { getJobFairs, getTerminalId } from '../../services/api'
import { recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'
import { isValidSourceUrl } from '../../lib/url'

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function CheckinQrOverlay({ fair, onClose }: { fair: ExternalJobFairDTO; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-80 rounded-2xl bg-white p-7 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100"
          aria-label="关闭"
        >
          <XIcon className="h-5 w-5" aria-hidden="true" />
        </button>
        <p className="text-center text-base font-semibold text-gray-800">扫码前往来源平台签到</p>
        <p className="mt-1 line-clamp-1 text-center text-sm text-gray-500">{fair.name}</p>
        <div className="mt-5 flex justify-center">
          <SourceUrlQr value={fair.checkinUrl} size={180} />
        </div>
        <div className="mt-5 space-y-1.5 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-500">
          <div className="flex justify-between">
            <span className="text-gray-400">来源机构</span>
            <span className="font-medium">{fair.sourceName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">外部编号</span>
            <span className="font-mono">{fair.externalId}</span>
          </div>
        </div>
        <div className="mt-4 flex items-start gap-2">
          <SmartphoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-gray-500">
            请使用手机扫码到来源平台办理现场签到。本系统不记录签到结果、不接收报名信息或简历。
          </p>
        </div>
      </div>
    </div>
  )
}

function CheckinEntryCard({ fair, onOpenQr }: { fair: ExternalJobFairDTO; onOpenQr: () => void }) {
  const sourceUrlAvailable = isValidSourceUrl(fair.checkinUrl ?? '')
  const navigate = useNavigate()

  return (
    <Card className="grid gap-5 p-5 lg:grid-cols-[1fr_220px]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">
            {fair.status === 'ongoing' ? '进行中' : '即将开始'}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {fair.sourceName}
          </span>
        </div>
        <h2 className="mt-3 text-xl font-bold text-slate-950">{fair.name}</h2>
        <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
          <span className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-orange-500" />
            {formatDateTime(fair.startTime)}
          </span>
          <span className="flex items-center gap-2">
            <MapPinIcon className="h-4 w-4 text-orange-500" />
            {fair.city ? `${fair.city} · ` : ''}{fair.venue}
          </span>
        </div>
        <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600">
          请使用手机扫码前往来源平台签到。本系统不记录签到结果，请以来源平台显示为准。
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="mt-4"
          onClick={() => navigate(`/job-fairs/${fair.id}`, { state: { fair } })}
        >
          查看详情
        </Button>
      </div>

      <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-100 bg-white p-4">
        {sourceUrlAvailable ? (
          <>
            <button
              type="button"
              onClick={onOpenQr}
              className="flex h-[168px] w-[168px] flex-col items-center justify-center rounded-xl border border-orange-100 bg-orange-50 text-orange-700 transition-colors hover:bg-orange-100 active:bg-orange-200"
            >
              <QrCodeIcon className="h-14 w-14" aria-hidden="true" />
              <span className="mt-3 text-sm font-bold">打开签到码</span>
            </button>
            <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <SmartphoneIcon className="h-3.5 w-3.5" />
              扫码前往来源平台签到
            </p>
          </>
        ) : (
          <div className="flex h-[168px] w-[168px] items-center justify-center rounded-xl bg-slate-50 text-center text-sm font-medium text-slate-400">
            来源链接暂不可用
          </div>
        )}
      </div>
    </Card>
  )
}

export function JobFairCheckinPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [fairs, setFairs] = useState<ExternalJobFairDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [qrFair, setQrFair] = useState<ExternalJobFairDTO | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)

    getJobFairs({ terminalId: getTerminalId() })
      .then((res) => {
        if (!alive) return
        setFairs(res.data)
      })
      .catch(() => {
        if (alive) setError(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [retryKey])

  const availableFairs = useMemo(
    () => fairs.filter((fair) => (fair.status === 'ongoing' || fair.status === 'upcoming') && Boolean(fair.checkinUrl)),
    [fairs],
  )

  const openCheckinQr = (fair: ExternalJobFairDTO) => {
    recordExternalJump(getToken(), 'job_fair', fair.id, 'external_checkin_open')
    setQrFair(fair)
  }

  if (loading) return <LoadingState className="h-full" />

  return (
    <div className="flex h-full flex-col">
      {qrFair && <CheckinQrOverlay fair={qrFair} onClose={() => setQrFair(null)} />}
      <div className="px-6 pt-6">
        <PageHeader
          title="来源平台入场入口"
          subtitle="展示招聘会官方/第三方来源签到二维码，本系统不记录签到结果"
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
              返回首页
            </Button>
          }
        />
      </div>

      <div className="mt-4 flex-1 overflow-y-auto px-6 pb-6">
        {error ? (
          <ErrorState message="入口加载失败，请检查网络后重试" onRetry={() => setRetryKey((value) => value + 1)} />
        ) : availableFairs.length === 0 ? (
          <EmptyState
            icon={QrCodeIcon}
            title="暂无可展示的来源入口"
            description="当前没有配置来源签到链接的进行中或即将开始招聘会"
            className="py-20"
          />
        ) : (
          <div className="grid gap-4">
            {availableFairs.map((fair) => (
              <CheckinEntryCard key={fair.id} fair={fair} onOpenQr={() => openCheckinQr(fair)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
