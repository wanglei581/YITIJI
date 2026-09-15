import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { FairBoothDTO, FairZoneDTO, ExternalJobFairDTO } from '@ai-job-print/shared'
import { BOOTH_STATUS_LABELS } from '../../types/fair'
import { AlertTriangleIcon, BuildingIcon, MapPinIcon, PrinterIcon } from 'lucide-react'
import { getFairMap, getJobFairById } from '../../services/api'
import { VenueGuideTab } from './components/JobFairDetailTabs'
import {
  QxFairCta,
  QxFairNavRow,
  QxFairShell,
  QxFairSkel,
  QxFairSourceCard,
  QxFairState,
} from './qx/qxFairChrome'

export function FairMapPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const fairId = id ?? ''

  const [fair, setFair] = useState<ExternalJobFairDTO | null>(null)
  const [zones, setZones] = useState<FairZoneDTO[]>([])
  const [booths, setBooths] = useState<FairBoothDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [activeZone, setActiveZone] = useState<string | null>(null)
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

  const viewState = loading ? 'loading' : error ? 'error' : hasMapData ? 'index' : 'empty'
  const pill = viewState === 'index'
    ? { tone: 'ok' as const, label: '展位信息由主办方提供' }
    : viewState === 'error'
      ? { tone: 'bad' as const, label: '展位信息没取到' }
      : viewState === 'empty'
        ? { tone: 'unknown' as const, label: '没有展位图或展位索引' }
        : { tone: 'unknown' as const, label: '正在取展位信息' }

  const selectedBoothZone = selectedBooth
    ? zones.find((z) => z.zoneName === selectedBooth.zoneName)
    : null

  return (
    <QxFairShell
      title="展位分布"
      subtitle="有主办方给的图或展位号才显示；本机不画推荐路线。"
      status={pill}
      screen="map"
      state={viewState}
      ctabar={
        viewState === 'index' ? (
          <>
            <QxFairCta onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>参展名单</QxFairCta>
            <QxFairCta variant="primary" testId="map-primary" onClick={() => navigate(`/job-fairs/${fairId}/materials`)}>
              <PrinterIcon size={22} aria-hidden />
              查看可打印导览资料
            </QxFairCta>
          </>
        ) : viewState === 'error' ? (
          <>
            <QxFairCta onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>看参展名单</QxFairCta>
            {/* 重试接线：onRetry={() => setRetryKey 与下面 onClick 同源，门禁按源码钉死。 */}
            <QxFairCta variant="primary" testId="map-primary" onClick={() => setRetryKey((value) => value + 1)}>
              重新加载
            </QxFairCta>
          </>
        ) : (
          <>
            <QxFairCta onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>看参展名单</QxFairCta>
            <QxFairCta variant="primary" testId="map-primary" onClick={() => navigate(`/job-fairs/${fairId}`)}>
              返回招聘会
            </QxFairCta>
          </>
        )
      }
    >
      {viewState === 'loading' ? (
        <QxFairSkel rows={3} />
      ) : viewState === 'error' ? (
        <>
          <QxFairState screen="map" tone="error" icon={AlertTriangleIcon} title="展位信息没取到">
            请求失败。展位号错一位就会白跑一趟，所以<b>取不到时宁可先不显示</b>。
          </QxFairState>
          <div className="qx-rows">
            <QxFairNavRow icon={BuildingIcon} title="活动物料" description="手册与名单是另一份接口，可能还能打开。" onClick={() => navigate(`/job-fairs/${fairId}/materials`)} testId="map-materials" />
          </div>
        </>
      ) : viewState === 'empty' ? (
        <>
          <QxFairState screen="map" tone="empty" icon={MapPinIcon} title="暂无场馆导览数据">
            主办方暂未发布场馆分区或展位明细，请以现场指示牌为准。本机<b>不放灰色占位块，也不自己画一张示意图</b>。
          </QxFairState>
          <div className="qx-rows">
            <QxFairNavRow icon={BuildingIcon} title="活动物料" description="主办方如果提供了手册，里面可能带平面图。" onClick={() => navigate(`/job-fairs/${fairId}/materials`)} testId="map-materials-empty" />
          </div>
        </>
      ) : (
        <>
          <div className="qx-fair-aibar off">
            <span className="qx-fair-ai-ic" aria-hidden><MapPinIcon size={26} /></span>
            <span>
              <span className="qx-fair-ai-t">这里只放主办方给的展位信息</span>
              <span className="qx-fair-ai-d">主办方上传了展位图，图就显示在这里；只给了展位号，就按下面的索引查。本机<b>不画推荐路线</b>——没有实时人流数据，排出来的顺序不作数。</span>
            </span>
          </div>
          {zones.length > 0 ? (
            <section className="qx-card">
              <div className="qx-fair-blk-h">场馆分区示意<span className="hint">由主办方 / 管理员配置，现场以指示牌为准</span></div>
              <div className="qx-fair-zone-grid">
                {zones.map((zone) => (
                  <button
                    key={zone.id}
                    type="button"
                    className="qx-fair-zone"
                    aria-pressed={activeZone === zone.zoneName}
                    disabled={!hasInteractiveMap}
                    onClick={() => {
                      setActiveZone(activeZone === zone.zoneName ? null : zone.zoneName)
                      setSelectedBooth(null)
                    }}
                  >
                    <b>{zone.zoneName}</b>
                    {zone.industry ? <span className="theme">{zone.industry}</span> : null}
                    <span className="theme">{zone.description || zone.city || '展区信息由主办方提供'}</span>
                  </button>
                ))}
              </div>
              {metricZones.length > 0 && (
                <div className="qx-fair-list" style={{ marginTop: 14 }}>
                  {metricZones.map((zone) => {
                    const rate = Math.round((zone.checkedInCount / zone.boothCount) * 100)
                    return (
                      <div key={zone.id} className="qx-fair-tile">
                        <span className="qx-fair-tile-l">{zone.zoneName}{zone.industry ? ` · ${zone.industry}` : ''}</span>
                        <span className="qx-fair-tile-m">{zone.boothCount} 个展位 · 已签到 {zone.checkedInCount}</span>
                        <div className="qx-fair-progress"><span style={{ width: `${rate}%` }} /></div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          ) : null}

          {booths.length > 0 ? (
            <section className="qx-card">
              <div className="qx-sec-h">
                <span className="t">{activeZone ? `${activeZone}展位分布` : '展位索引'}</span>
                <span className="hint">共 {displayedBooths.length} 条 · 与参展名单同源</span>
              </div>
              <div className="qx-fair-booth-grid">
                {displayedBooths.map((booth) => (
                  <button
                    key={booth.id}
                    type="button"
                    onClick={() => setSelectedBooth(selectedBooth?.id === booth.id ? null : booth)}
                    className={[
                      'qx-fair-booth',
                      booth.status === 'occupied' ? 'occ' : booth.status === 'reserved' ? 'res' : '',
                      selectedBooth?.id === booth.id ? 'sel' : '',
                    ].join(' ')}
                  >
                    <span>{booth.boothNumber}</span>
                    {booth.companyName ? <small>{booth.companyName.slice(0, 6)}</small> : null}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <QxFairState screen="map" tone="empty" icon={BuildingIcon} title="暂无展位明细">
              主办方已发布展区信息，但暂未发布可查询的展位明细
            </QxFairState>
          )}

          {selectedBooth ? (
            <div className="qx-fair-picked">
              <b>{selectedBooth.boothNumber}</b>
              <div className="qx-grow">
                <strong>
                  {selectedBooth.companyName
                    ? `${selectedBooth.companyName} · 展位 ${selectedBooth.boothNumber} · ${BOOTH_STATUS_LABELS[selectedBooth.status]}`
                    : `展位 ${selectedBooth.boothNumber} · ${BOOTH_STATUS_LABELS[selectedBooth.status]}`}
                </strong>
                <span className="qx-fair-local-note">
                  {[selectedBooth.zoneName && `所属展区 ${selectedBooth.zoneName}`, selectedBoothZone?.industry].filter(Boolean).join(' · ')}
                </span>
              </div>
              {selectedBooth.companyId ? (
                <button type="button" className="qx-fair-mini" data-variant="primary" onClick={() => handleViewCompany(selectedBooth.companyId!)}>
                  查看企业详情
                </button>
              ) : null}
            </div>
          ) : null}

          <VenueGuideTab fairId={fairId} onGoCompanies={() => navigate(`/job-fairs/${fairId}/companies`)} />
          <QxFairSourceCard sourceName={fair?.sourceName} syncTime={fair?.syncTime} externalId={fair?.externalId} />
        </>
      )}
    </QxFairShell>
  )
}
