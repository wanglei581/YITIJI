import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import type { FairBoothDTO, FairZoneDTO, ExternalJobFairDTO } from '@ai-job-print/shared'
import { BOOTH_STATUS_LABELS } from '../../types/fair'
import { BuildingIcon, MapPinIcon, XIcon } from 'lucide-react'
import { getFairMap, getJobFairById } from '../../services/api'

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
    available: 'text-green-600',
    occupied:  'text-blue-600',
    reserved:  'text-orange-500',
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
          <p className="text-base font-semibold text-gray-900">展位 {booth.boothNumber}</p>
          <button onClick={onClose} className="rounded-full p-1 text-gray-400 hover:bg-gray-100">
            <XIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">所属展区</span>
            <span className="text-gray-700">{booth.zoneName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">展位状态</span>
            <span className={`font-medium ${statusColors[booth.status]}`}>{BOOTH_STATUS_LABELS[booth.status]}</span>
          </div>
          {booth.areaSqm && (
            <div className="flex justify-between">
              <span className="text-gray-400">展位面积</span>
              <span className="text-gray-700">{booth.areaSqm} ㎡</span>
            </div>
          )}
          {booth.companyName && (
            <div className="flex justify-between">
              <span className="text-gray-400">入驻企业</span>
              <span className="font-medium text-gray-900">{booth.companyName}</span>
            </div>
          )}
        </div>
        {booth.companyId && (
          <Button size="md" className="mt-5 w-full" onClick={() => onViewCompany(booth.companyId!)}>
            查看企业详情 / 扫码查看
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

const BOOTH_CELL_STYLES: Record<string, string> = {
  available: 'bg-gray-50 border-gray-200 text-gray-400',
  occupied:  'bg-blue-50 border-blue-200 text-blue-700',
  reserved:  'bg-orange-50 border-orange-200 text-orange-600',
}

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
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">加载中...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <MapPinIcon className="h-12 w-12 text-gray-200" />
        <p className="text-sm text-gray-400">加载失败，请稍后重试</p>
        <Button variant="secondary" onClick={() => navigate(`/job-fairs/${fairId}`)}>返回详情</Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {selectedBooth && (
        <BoothSheet
          booth={selectedBooth}
          onClose={() => setSelectedBooth(null)}
          onViewCompany={handleViewCompany}
        />
      )}

      <div className="px-6 pt-6">
        <PageHeader
          title="展馆导览"
          subtitle={fair ? `${fair.venue}` : '展位分布图'}
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate(`/job-fairs/${fairId}`)}>
              返回详情
            </Button>
          }
        />
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {zoneOptions.map((z) => (
            <button
              key={z}
              onClick={() => setActiveZone(z === '全部展区' ? null : z)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                (z === '全部展区' && activeZone === null) || activeZone === z
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {z}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-blue-200 bg-blue-50" />已入驻
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-orange-200 bg-orange-50" />已预留
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-gray-200 bg-gray-50" />空闲
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {displayedZones.map((zone) => (
            <Card key={zone.id} className="p-3">
              <p className="text-xs font-medium text-gray-700">{zone.zoneName}</p>
              {zone.industry && <p className="mt-0.5 text-xs text-gray-400">{zone.industry}</p>}
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-gray-500">{zone.boothCount} 个展位</span>
                <span className="text-green-600">已签到 {zone.checkedInCount}</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-gray-100">
                <div
                  className="h-1 rounded-full bg-green-400"
                  style={{ width: `${zone.boothCount > 0 ? (zone.checkedInCount / zone.boothCount) * 100 : 0}%` }}
                />
              </div>
            </Card>
          ))}
        </div>

        <div>
          <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <MapPinIcon className="h-4 w-4 text-gray-400" />
            展位分布（{displayedBooths.length} 个）
            <span className="text-xs font-normal text-gray-400">— 点击展位查看详情</span>
          </p>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {displayedBooths.map((booth) => (
              <button
                key={booth.id}
                onClick={() => setSelectedBooth(booth)}
                className={`rounded-lg border p-2 text-center transition-colors hover:opacity-80 ${BOOTH_CELL_STYLES[booth.status]}`}
              >
                <BuildingIcon className="mx-auto h-4 w-4" />
                <p className="mt-1 text-xs font-medium">{booth.boothNumber}</p>
                {booth.companyName && (
                  <p className="mt-0.5 truncate text-xs opacity-70">{booth.companyName.slice(0, 4)}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
