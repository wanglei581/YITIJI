import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import type { FairBoothDTO, FairZoneDTO, ExternalJobFairDTO } from '@ai-job-print/shared'
import { BOOTH_STATUS_LABELS } from '../../types/fair'
import { BuildingIcon, MapPinIcon, PrinterIcon } from 'lucide-react'
import { getFairMap, getJobFairById } from '../../services/api'
import { FusionNotice, FusionSourceMeta, KioskPageFrame } from '../jobs/components/W4Presentation'

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
  const [retryKey,      setRetryKey]      = useState(0)
  const [activeZone,    setActiveZone]    = useState<string | null>(null)
  const [selectedBooth, setSelectedBooth] = useState<FairBoothDTO | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
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
  }, [fairId, retryKey])

  const displayedBooths = activeZone ? booths.filter((b) => b.zoneName === activeZone) : booths
  const hasMapData = zones.length > 0 || booths.length > 0
  const hasInteractiveMap = booths.length > 0
  const metricZones = zones.filter((zone) => zone.boothCount > 0)

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
        onRetry={() => setRetryKey((value) => value + 1)}
        className="h-full"
      />
    )
  }

  // Compute the zone the selected booth belongs to
  const selectedBoothZone = selectedBooth
    ? zones.find((z) => z.zoneName === selectedBooth.zoneName)
    : null

  return (
    <KioskPageFrame
      tone="wheat"
      title="场馆导览"
      subtitle={
        fair
          ? `${fair.name} · ${fair.venue}${hasInteractiveMap ? ' · 点击展区 / 展位查看详情' : ''}`
          : hasInteractiveMap ? '展位分布图 · 点击展区 / 展位查看详情' : '主办方暂未发布场馆导览数据'
      }
      backLabel="返回详情"
      onBack={() => navigate(`/job-fairs/${fairId}`)}
      badge={booths.length > 0 ? (
        <div className="jf-meta-chips">
          <span className="jf-chip ok">
            <span className="inline-block h-3 w-3 flex-none rounded bg-[var(--teal)]" aria-hidden="true" />
            已入驻
          </span>
          <span className="jf-chip warn">
            <span className="inline-block h-3 w-3 flex-none rounded bg-[var(--wheat)]" aria-hidden="true" />
            已预留
          </span>
          <span className="jf-chip">
            <span className="inline-block h-3 w-3 flex-none rounded bg-[var(--line)]" aria-hidden="true" />
            空闲
          </span>
        </div>
      ) : undefined}
      actionBar={
        <>
          <button type="button" className="jf-btn ghost" onClick={() => navigate(`/job-fairs/${fairId}`)}>
            返回详情
          </button>
          <div className="jf-spacer" />
          <button type="button" className="jf-btn ghost" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>
            查看参展企业
          </button>
          <button
            type="button"
            className="jf-btn dark"
            onClick={() => navigate(`/job-fairs/${fairId}/materials`)}
          >
            <PrinterIcon aria-hidden="true" />
            查看可打印导览资料
          </button>
        </>
      }
    >
      {!hasMapData ? (
        <EmptyState
          icon={MapPinIcon}
          title="暂无场馆导览数据"
          description="主办方暂未发布场馆分区或展位明细，请以现场指示牌为准"
          className="flex-1"
        />
      ) : (
        <>
          {/* 场馆分区示意：只呈现主办方真实配置，不补固定服务区或推导展位号。 */}
          {zones.length > 0 && (
            <section className="jf-card accented">
              <div className="jf-card-head">
                <span className="jf-g-icon">
                  <MapPinIcon aria-hidden="true" />
                </span>
                <div>
                  <h2>场馆分区示意</h2>
                  <div className="sub">由主办方 / 管理员配置，现场以指示牌为准</div>
                </div>
              </div>
              <div className="jf-map-grid">
                {zones.map((zone, idx) => (
                  <button
                    key={zone.id}
                    type="button"
                    className={`jf-zone ${idx % 3 === 0 ? 'z-a' : idx % 3 === 1 ? 'z-b' : 'z-c'} ${activeZone === zone.zoneName ? 'sel' : ''} ${hasInteractiveMap ? '' : 'cursor-default'}`}
                    disabled={!hasInteractiveMap}
                    onClick={() => {
                      setActiveZone(activeZone === zone.zoneName ? null : zone.zoneName)
                      setSelectedBooth(null)
                    }}
                  >
                    <b>{zone.zoneName}</b>
                    {zone.industry && <span className="theme">{zone.industry}</span>}
                    <span className="range">
                      {zone.description || zone.city || '展区信息由主办方提供'}
                    </span>
                  </button>
                ))}
              </div>
              {/* 仅在接口真实提供非零统计时展示，避免把适配层的 0 占位包装成现场指标。 */}
              {metricZones.length > 0 && (
                <div className="jf-zone-stats">
                  {metricZones.map((zone) => {
                    const rate = Math.round((zone.checkedInCount / zone.boothCount) * 100)
                    return (
                      <div key={zone.id} className="jf-zs">
                        <b>{zone.zoneName}{zone.industry ? ` · ${zone.industry}` : ''}</b>
                        <div className="jf-zs-nums">
                          <span>{zone.boothCount} 个展位</span>
                          <span>已签到 {zone.checkedInCount}</span>
                        </div>
                        <div className="jf-progress">
                          <div className="jf-progress-fill" style={{ width: `${rate}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {/* 展位分布 */}
          {booths.length > 0 ? (
            <section className="jf-card">
              <div className="jf-card-head">
                <span className="jf-g-icon">
                  <BuildingIcon aria-hidden="true" />
                </span>
                <div>
                  <h2>{activeZone ? `${activeZone}展位分布` : '展位分布'}</h2>
                  <div className="sub">
                    {activeZone
                      ? `已选 ${activeZone}（共 ${displayedBooths.length} 个展位）· 点击展位查看入驻企业`
                      : `共 ${displayedBooths.length} 个展位 · 点击上方展区可筛选 · 点击展位查看详情`}
                  </div>
                </div>
              </div>
              <div className="jf-booth-grid">
                {displayedBooths.map((booth) => (
                  <button
                    key={booth.id}
                    type="button"
                    onClick={() => setSelectedBooth(selectedBooth?.id === booth.id ? null : booth)}
                    className={[
                      'jf-booth-cell',
                      booth.status === 'occupied' ? 'occ' : booth.status === 'reserved' ? 'res' : '',
                      selectedBooth?.id === booth.id ? 'sel' : '',
                    ].join(' ')}
                  >
                    <span>{booth.boothNumber}</span>
                    {booth.companyName && <small>{booth.companyName.slice(0, 6)}</small>}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <EmptyState
              icon={BuildingIcon}
              title="暂无展位明细"
              description="主办方已发布展区信息，但暂未发布可查询的展位明细"
              className="py-12"
            />
          )}

          {/* 选中展位内联面板（替代底部弹窗，原型屏46样式）*/}
          {selectedBooth && (
            <div className="jf-picked">
              <span className="p-booth">{selectedBooth.boothNumber}</span>
              <div className="flex-1 min-w-0">
                <b className="block text-[25px] font-bold">
                  {selectedBooth.companyName
                    ? `${selectedBooth.companyName} · 展位 ${selectedBooth.boothNumber} · ${BOOTH_STATUS_LABELS[selectedBooth.status]}`
                    : `展位 ${selectedBooth.boothNumber} · ${BOOTH_STATUS_LABELS[selectedBooth.status]}`}
                </b>
                <span className="mt-2 block text-[18px] text-[var(--muted)]">
                  {[
                    selectedBooth.zoneName && `所属展区 ${selectedBooth.zoneName}`,
                    selectedBoothZone?.industry,
                  ].filter(Boolean).join(' · ')}
                </span>
              </div>
              {selectedBooth.companyId && (
                <button
                  type="button"
                  className="jf-btn sm dark flex-none"
                  onClick={() => handleViewCompany(selectedBooth.companyId!)}
                >
                  查看企业详情
                </button>
              )}
            </div>
          )}
        </>
      )}

      {fair && (
        <FusionSourceMeta
          sourceName={fair.sourceName}
          syncTime={fair.syncTime ?? fair.startTime}
          externalId={fair.externalId}
        />
      )}

      <FusionNotice>
        场馆导览信息由主办方提供，仅供现场参考；岗位投递请前往来源平台办理。
      </FusionNotice>
    </KioskPageFrame>
  )
}
