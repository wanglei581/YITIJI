import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import type { ExternalJobFairDTO } from '@ai-job-print/shared'
import { CalendarIcon, MapPinIcon, QrCodeIcon, SmartphoneIcon, XIcon } from 'lucide-react'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { getJobFairs, getTerminalId } from '../../services/api'
import { recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'
import { isValidSourceUrl } from '../../lib/url'
import { ProtoBadge, ProtoNotice, ProtoPage, ProtoStepStrip } from '../jobs-fairs-prototype'

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
          className="absolute right-4 top-4 rounded-full p-1 text-neutral-400 hover:bg-neutral-100"
          aria-label="关闭"
        >
          <XIcon className="h-5 w-5" aria-hidden="true" />
        </button>
        <p className="text-center text-base font-semibold text-neutral-800">扫码前往来源平台签到</p>
        <p className="mt-1 line-clamp-1 text-center text-sm text-neutral-500">{fair.name}</p>
        <div className="mt-5 flex justify-center">
          <SourceUrlQr value={fair.checkinUrl} size={180} />
        </div>
        <div className="mt-5 space-y-1.5 rounded-lg bg-neutral-50 px-4 py-3 text-xs text-neutral-500">
          <div className="flex justify-between">
            <span className="text-neutral-400">来源机构</span>
            <span className="font-medium">{fair.sourceName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">外部编号</span>
            <span className="font-mono">{fair.externalId}</span>
          </div>
        </div>
        <div className="mt-4 flex items-start gap-2">
          <SmartphoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-neutral-500">
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
    <div className="grid grid-cols-[1fr_280px] gap-6 rounded-[var(--r-md)] border border-[var(--line)] border-t-4 border-t-[var(--wheat)] bg-[var(--surface)] p-7 shadow-sm">
      <div className="min-w-0">
        <div className="jf-meta-chips">
          <span className={`jf-chip ${fair.status === 'ongoing' ? 'ok' : 'warn'}`}>
            {fair.status === 'ongoing' ? '进行中' : '即将开始'}
          </span>
          <span className="jf-chip src">来源 · {fair.sourceName}</span>
        </div>
        <h2 className="mt-4 font-serif text-[30px] font-bold tracking-[1px]">{fair.name}</h2>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[20px] text-[var(--muted)]">
          <span className="inline-flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            {formatDateTime(fair.startTime)}
          </span>
          <span className="inline-flex items-center gap-2">
            <MapPinIcon className="h-5 w-5" />
            {fair.city ? `${fair.city} · ` : ''}{fair.venue}
          </span>
        </div>
        <p className="mt-4 rounded-xl bg-[var(--paper)] px-5 py-3.5 text-[18px] leading-relaxed text-[var(--muted)]">
          请使用手机扫码前往来源平台签到。本系统不记录签到结果，请以来源平台显示为准。
        </p>
        <div className="jf-meta-chips mt-4">
          <span className="jf-chip">外部ID <b>{fair.externalId}</b></span>
          <button type="button" className="jf-btn sm ghost" onClick={() => navigate(`/job-fairs/${fair.id}`, { state: { fair } })}>
          查看详情
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--r-sm)] border border-[var(--line)] bg-[var(--paper)] p-5">
        {sourceUrlAvailable ? (
          <>
            <button
              type="button"
              onClick={onOpenQr}
              className="flex h-[190px] w-[190px] flex-col items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface)] text-[var(--wheat-deep)]"
            >
              <QrCodeIcon className="h-14 w-14" aria-hidden="true" />
              <span className="mt-3 text-[20px] font-bold">来源平台签到码</span>
            </button>
            <p className="flex items-center gap-1.5 text-[16px] font-semibold text-[var(--muted)]">
              <SmartphoneIcon className="h-3.5 w-3.5" />
              扫码前往来源平台签到
            </p>
          </>
        ) : (
          <div className="flex h-[168px] w-[168px] items-center justify-center rounded-xl bg-neutral-50 text-center text-sm font-medium text-neutral-400">
            来源链接暂不可用
          </div>
        )}
      </div>
    </div>
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
    <ProtoPage
      tone="wheat"
      title="来源平台入场入口"
      subtitle="展示招聘会官方 / 第三方来源签到二维码，本系统不记录签到结果"
      backLabel="返回"
      onBack={() => navigate('/')}
      badge={<ProtoBadge icon={QrCodeIcon}>{availableFairs.length} 场可签到</ProtoBadge>}
      actionBar={
        <>
          <button type="button" className="jf-btn ghost" onClick={() => navigate('/')}>
            返回首页
          </button>
          <div className="jf-spacer" />
          <button type="button" className="jf-btn dark" onClick={() => navigate('/job-fairs')}>
            查看招聘会
          </button>
        </>
      }
    >
      {qrFair && <CheckinQrOverlay fair={qrFair} onClose={() => setQrFair(null)} />}
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
        availableFairs.map((fair) => (
          <CheckinEntryCard key={fair.id} fair={fair} onOpenQr={() => openCheckinQr(fair)} />
        ))
      )}
      <section className="jf-card accented">
        <div className="jf-card-head">
          <span className="jf-g-icon">
            <QrCodeIcon aria-hidden="true" />
          </span>
          <div>
            <h2>签到步骤</h2>
            <div className="sub">三步完成来源平台现场签到</div>
          </div>
        </div>
        <ProtoStepStrip
          steps={[
            { title: '手机扫描签到码', desc: '扫描上方对应场次的二维码' },
            { title: '来源平台完成签到', desc: '在来源平台页面按提示办理' },
            { title: '出示入场凭证', desc: '向现场工作人员出示凭证进场' },
          ]}
        />
      </section>
      <ProtoNotice>签到与入场由主办方管理，本系统不记录签到结果、不接收报名信息或简历。</ProtoNotice>
    </ProtoPage>
  )
}
