import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ErrorState, LoadingState } from '@ai-job-print/ui'
import type { FairBoothDTO, FairZoneDTO, ExternalJobFairDTO } from '@ai-job-print/shared'
import { BOOTH_STATUS_LABELS } from '../../types/fair'
import { BuildingIcon, MapPinIcon, XIcon } from 'lucide-react'
import { getFairMap, getJobFairById } from '../../services/api'
import { ProtoBadge, ProtoNotice, ProtoPage } from '../jobs-fairs-prototype'

// ─── Booth detail sheet ───────────────────────────────────────────────────────

function BoothSheet({
  booth,
  onClose,
  onViewCompany,
}: {
  booth: FairBoothDTO
  onClose: () => void
  onViewCompany: (companyId: string) => void
}) {
  const statusColors = {
    available: 'text-success-fg',
    occupied:  'text-primary-600',
    reserved:  'text-warning-fg',
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-base font-semibold text-neutral-900">展位 {booth.boothNumber}</p>
          <button onClick={onClose} className="rounded-full p-1 text-neutral-400 hover:bg-neutral-100">
            <XIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-neutral-400">所属展区</span>
            <span className="text-neutral-700">{booth.zoneName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">展位状态</span>
            <span className={`font-medium ${statusColors[booth.status]}`}>{BOOTH_STATUS_LABELS[booth.status]}</span>
          </div>
          {booth.areaSqm && (
            <div className="flex justify-between">
              <span className="text-neutral-400">展位面积</span>
              <span className="text-neutral-700">{booth.areaSqm} ㎡</span>
            </div>
          )}
          {booth.companyName && (
            <div className="flex justify-between">
              <span className="text-neutral-400">入驻企业</span>
              <span className="font-medium text-neutral-900">{booth.companyName}</span>
            </div>
          )}
        </div>
        {booth.companyId && (
          <button type="button" className="jf-btn sm dark mt-5 w-full" onClick={() => onViewCompany(booth.companyId!)}>
            查看详情
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FairMapPage() {
  const navigate = useNavigate()
  const { id }   = useParams<{ id: string }>()
  const fairId   = id ?? ''

  const [fair,          setFair]          = useState<ExternalJobFairDTO | null>(null)
  const [zones,         setZones]         = useState<FairZoneDTO[]>([])
  const [booths,        setBooths]        = useState<FairBoothDTO[]>([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(false)
  const [activeZone,    setActiveZone]    = useState<string | null>(null)
  const [selectedBooth, setSelectedBooth] = useState<FairBoothDTO | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([getJobFairById(fairId), getFairMap(fairId)])
      .then(([fairRes, mapRes]) => {
        if (cancelled) return
        setFair(fairRes.data)
        setZones(mapRes.data.zones)
        setBooths(mapRes.data.booths)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId])

  const zoneOptions      = ['全部展区', ...zones.map((z) => z.zoneName)]
  const displayedBooths  = activeZone ? booths.filter((b) => b.zoneName === activeZone) : booths
  const displayedZones   = activeZone ? zones.filter((z) => z.zoneName === activeZone)  : zones

  const handleViewCompany = (companyId: string) => {
    setSelectedBooth(null)
    navigate(`/job-fairs/${fairId}/companies/${companyId}`)
  }

  if (loading) {
    return <LoadingState className="h-full" />
  }

  if (error) {
    return (
      <ErrorState
        message="加载失败，请稍后重试"
        onRetry={() => navigate(`/job-fairs/${fairId}`)}
        className="h-full"
      />
    )
  }

  return (
    <ProtoPage
      tone="wheat"
      title="展馆导览"
      subtitle={fair ? fair.venue : '展位分布图'}
      backLabel="返回详情"
      onBack={() => navigate(`/job-fairs/${fairId}`)}
      badge={<ProtoBadge icon={MapPinIcon}>{displayedBooths.length} 个展位</ProtoBadge>}
      actionBar={
        <>
          <button type="button" className="jf-btn ghost" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>
            参会企业
          </button>
          <div className="jf-spacer" />
          <button type="button" className="jf-btn dark" onClick={() => navigate(`/job-fairs/${fairId}`)}>
            查看招聘会
          </button>
        </>
      }
    >
      {selectedBooth && (
        <BoothSheet
          booth={selectedBooth}
          onClose={() => setSelectedBooth(null)}
          onViewCompany={handleViewCompany}
        />
      )}

        <div className="jf-filter-bar">
          {zoneOptions.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setActiveZone(z === '全部展区' ? null : z)}
              className={`jf-f-chip sm ${((z === '全部展区' && activeZone === null) || activeZone === z) ? 'on' : ''}`}
            >
              {z}
            </button>
          ))}
        </div>
        <div className="jf-meta-chips">
          <span className="jf-chip ok">
            <span className="h-3 w-3 rounded border border-[var(--teal)] bg-[var(--teal-soft)]" />已入驻
          </span>
          <span className="jf-chip warn">
            <span className="h-3 w-3 rounded border border-[var(--wheat)] bg-[var(--wheat-soft)]" />已预留
          </span>
          <span className="jf-chip">
            <span className="h-3 w-3 rounded border border-[var(--line)] bg-[var(--surface)]" />空闲
          </span>
        </div>

        <section className="jf-card accented">
          <div className="jf-card-head">
            <span className="jf-g-icon">
              <MapPinIcon aria-hidden="true" />
            </span>
            <div>
              <h2>展区分布</h2>
              <div className="sub">点击展区或展位查看现场信息</div>
            </div>
          </div>
          <div className="jf-map-grid">
          {displayedZones.map((zone) => (
            <button
              key={zone.id}
              type="button"
              className={`jf-zone ${displayedZones.indexOf(zone) % 3 === 0 ? 'z-a' : displayedZones.indexOf(zone) % 3 === 1 ? 'z-b' : 'z-c'}`}
              onClick={() => setActiveZone(activeZone === zone.zoneName ? null : zone.zoneName)}
            >
              <b>{zone.zoneName}</b>
              {zone.industry && <span className="theme">{zone.industry}</span>}
              <span className="range">{zone.boothCount} 个展位 · 已签到 {zone.checkedInCount}</span>
            </button>
          ))}
          {displayedZones.length < 4 && (
            <div className="jf-zone z-svc">
              <b>服务台</b>
              <span className="theme">签到 / 咨询 / 打印</span>
              <span className="range">入口附近</span>
            </div>
          )}
        </div>
        </section>

        <section className="jf-card">
          <div className="jf-card-head">
            <span className="jf-g-icon">
              <BuildingIcon aria-hidden="true" />
            </span>
            <div>
              <h2>展位分布</h2>
              <div className="sub">{displayedBooths.length} 个展位 · 点击展位查看详情</div>
            </div>
          </div>
          <div className="jf-booth-grid">
            {displayedBooths.map((booth) => (
              <button
                key={booth.id}
                type="button"
                onClick={() => setSelectedBooth(booth)}
                className={`jf-booth-cell ${booth.status === 'occupied' ? 'occ' : booth.status === 'reserved' ? 'res' : ''}`}
              >
                <span>{booth.boothNumber}</span>
                {booth.companyName && <small>{booth.companyName.slice(0, 6)}</small>}
              </button>
            ))}
          </div>
        </section>

      <ProtoNotice>导览仅作为现场参考，实际展位和动线以主办方现场指引为准。</ProtoNotice>
    </ProtoPage>
  )
}
