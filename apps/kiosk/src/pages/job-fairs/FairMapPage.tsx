// /job-fairs/:id/map —— 展位分布（稿 28-jobfair-enhanced.html，screen=map / 090）。
//
// 状态与稿同名：index | empty | error。
// 稿原话：「这里只放主办方给的展位信息……本机不画推荐路线——没有实时人流数据，
// 排出来的顺序不作数。」所以本页只呈现三类**服务端真的返回过**的东西：
//   ① 展区（FairZone）与展位（FairBooth） —— GET /job-fairs/:id/map
//   ② 会场布局与设施点位（FairVenueGuide） —— GET /job-fairs/:id/venue-guide
//   ③ 展区签到统计 —— 只在 boothCount>0 时才渲染（见 metricZones 守卫）
//
// 会场布局是 2026-09-20 从旧详情页的「场馆导览」Tab 迁过来的：展位分布才是它的落点，
// 详情页那份 Tab 壳已随迁移退休。设施名一律用服务端返回的 `facility.name`，
// 不再本地写死点位名——本机没有资格替主办方给现场的服务点起名字。
// （旧 Tab 里那几个硬编码点位名已随之删除；此处不复述其字面，
//   verify:visible-actions-truth 是纯文本扫描，连注释一起查。）

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type {
  FairBoothDTO,
  FairVenueFacilityType,
  FairVenueGuideDTO,
  FairVenueHallDTO,
  FairZoneDTO,
  ExternalJobFairDTO,
} from '@ai-job-print/shared'
import { BOOTH_STATUS_LABELS } from '../../types/fair'
import {
  BuildingIcon,
  DoorOpenIcon,
  FileTextIcon,
  InfoIcon,
  MapPinIcon,
  MessageCircleQuestionIcon,
  PrinterIcon,
  UsersIcon,
} from 'lucide-react'
import { getFairMap, getFairVenueGuide, getJobFairById } from '../../services/api'
import { QxFairWorkbench } from './QxFairWorkbench'
import { FairSkeletonList } from './components/FairWorkbenchBits'
import { fmtFairSyncDate } from './fairFormat'
import {
  DirKv,
  DirNote,
  DirState,
  DirStrip,
  DirStripItem,
} from '../../components/qingxu/directory/DirectoryBits'

const FACILITY_ICON: Record<FairVenueFacilityType, typeof InfoIcon> = {
  entrance: DoorOpenIcon,
  serviceDesk: InfoIcon,
  printPoint: PrinterIcon,
  consulting: MessageCircleQuestionIcon,
}

export function FairMapPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const fairId = id ?? ''

  const [fair, setFair] = useState<ExternalJobFairDTO | null>(null)
  const [zones, setZones] = useState<FairZoneDTO[]>([])
  const [booths, setBooths] = useState<FairBoothDTO[]>([])
  const [guide, setGuide] = useState<FairVenueGuideDTO | null>(null)
  /**
   * 会场布局取不到 ≠ 主办方没提供。两者在屏幕上长得一样（都没有布局区块），
   * 但只有前者该说「没取到、可以重试」。不分开记就会在 500 时对用户说
   * 「主办方没有提供展位图」—— 那是替主办方背了一口锅，用户也不会再重试。
   */
  const [guideFailed, setGuideFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [activeZone, setActiveZone] = useState<string | null>(null)
  const [selectedBooth, setSelectedBooth] = useState<FairBoothDTO | null>(null)
  const [activeHallId, setActiveHallId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setGuideFailed(false)
    Promise.all([
      getJobFairById(fairId),
      getFairMap(fairId),
      // 会场布局是加分项：它取不到不该让整页变错误态，展位索引仍然有用。
      // 但「取不到」这件事要记下来（guideFailed），否则下面的空态会替主办方认领这口锅。
      getFairVenueGuide(fairId).then((res) => ({ ok: true as const, data: res.data })).catch(() => ({ ok: false as const, data: null })),
    ])
      .then(([fairRes, mapRes, guideRes]) => {
        if (cancelled) return
        setFair(fairRes.data)
        setZones(mapRes.data.zones)
        setBooths(mapRes.data.booths)
        setGuide(guideRes.data)
        setGuideFailed(!guideRes.ok)
        setActiveHallId(guideRes.data?.halls[0]?.hallId ?? null)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId, retryKey])

  const displayedBooths = activeZone ? booths.filter((b) => b.zoneName === activeZone) : booths
  const halls = guide?.halls ?? []
  const hasMapData = zones.length > 0 || booths.length > 0 || halls.length > 0
  const hasInteractiveMap = booths.length > 0
  // 适配层对 FairZone 只能给 boothCount=0 / checkedInCount=0 占位（后端无该字段）。
  // 不过滤就会恒显示「已签到 0」——把「没有这项数据」冒充成「真实统计为 0」。
  const metricZones = zones.filter((zone) => zone.boothCount > 0)
  const activeHall: FairVenueHallDTO | null = halls.find((h) => h.hallId === activeHallId) ?? halls[0] ?? null
  const selectedBoothZone = selectedBooth ? zones.find((z) => z.zoneName === selectedBooth.zoneName) : null

  /**
   * 展位与展区都没有、而且会场布局那条请求也失败了 —— 这一屏的三个数据源里
   * 至少有一个是「没取到」，不能落空态说「主办方没有提供」。
   */
  const uiState = loading ? 'index' : error || (!hasMapData && guideFailed) ? 'error' : !hasMapData ? 'empty' : 'index'

  /**
   * 「查看可打印导览资料」是这一页**唯一能真正出纸**的出口：展位图看不到时，
   * 纸质手册就是用户当下还能拿到的东西。因此它在 index / empty / error 三态都在
   * 固定底栏里，不因为页面降级就消失（迁移前它挂在 KioskPageFrame 的 actionBar 上，
   * 空态照样显示；迁移的第一版只在 index 态保留，等于在最需要它的两屏把它删了）。
   */
  const materialsCta = (
    <button
      type="button"
      className="qx-btn"
      data-variant="primary"
      onClick={() => navigate(`/job-fairs/${fairId}/materials`)}
    >
      <PrinterIcon size={20} aria-hidden />
      查看可打印导览资料
    </button>
  )

  const ctabar = uiState === 'error'
    ? (
      <>
        <button type="button" className="qx-btn narrow" data-variant="ghost" onClick={() => setRetryKey((value) => value + 1)}>重新加载</button>
        {materialsCta}
      </>
    )
    : uiState === 'empty'
      ? (
        <>
          <button type="button" className="qx-btn narrow" data-variant="ghost" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>看参展名单</button>
          {materialsCta}
        </>
      )
      : (
        <>
          <button type="button" className="qx-btn narrow" data-variant="ghost" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>参展名单</button>
          {materialsCta}
        </>
      )

  return (
    <QxFairWorkbench
      screen="map"
      state={uiState}
      fairId={fairId}
      subtitle={fair ? `${fair.name} · ${fair.venue} · 有主办方给的图或展位号才显示；本机不画推荐路线。` : undefined}
      ctabar={ctabar}
    >
      {loading ? (
        <FairSkeletonList rows={2} />
      ) : uiState === 'error' ? (
        <>
          <DirState tone="error" testId="fair-map-error" title="展位信息没取到">
            请求失败。展位号错一位就会白跑一趟，所以<b>取不到时宁可先不显示</b>。
            这不代表主办方没有提供展位图——<b>是这次没取到</b>，可以重新加载再看。
          </DirState>
          <DirStrip>
            <DirStripItem icon={FileTextIcon} title="活动物料" desc="手册与名单是另一份接口，可能还能打开" onClick={() => navigate(`/job-fairs/${fairId}/materials`)} />
            <DirStripItem icon={BuildingIcon} tone="wheat" title="返回招聘会" desc="时间地点仍可查看" onClick={() => navigate(`/job-fairs/${fairId}`)} />
          </DirStrip>
        </>
      ) : !hasMapData ? (
        <>
          <DirState tone="empty" testId="fair-map-empty" title="暂无场馆导览数据">
            主办方没有提供展位图或展位索引。本机<b>不放灰色占位块，也不自己画一张示意图</b>——现场按指示牌走更靠谱。
          </DirState>
          <DirStrip>
            <DirStripItem icon={UsersIcon} title="看参展名单" desc="到场前挑好想去的几家，省时间" onClick={() => navigate(`/job-fairs/${fairId}/companies`)} />
            <DirStripItem icon={InfoIcon} tone="slate" title="到了现场问工作人员" desc="入口一般有纸质导览和指示牌" onClick={() => navigate('/help')} />
          </DirStrip>
        </>
      ) : (
        <>
          <DirNote>
            <b>这里只放主办方给的展位信息。</b>
            上传了展位图就显示图，只给了展位号就按索引查。本机不画推荐路线——没有实时人流数据，排出来的顺序不作数。
          </DirNote>

          {halls.length > 0 && guide ? (
            <section className="dw-blk">
              <div className="dw-sec-h">
                <span className="t">{guide.venueName} · 会场布局</span>
                <span className="hint">点击展厅查看该厅企业</span>
              </div>
              <div className="dw-fgrp">
                <div className="fc">
                  {halls.map((hall) => (
                    <button
                      key={hall.hallId}
                      type="button"
                      className={`dw-chip${hall.hallId === activeHall?.hallId ? ' on' : ''}`}
                      aria-pressed={hall.hallId === activeHall?.hallId}
                      onClick={() => setActiveHallId(hall.hallId)}
                    >
                      {hall.hallCode} · {hall.hallName}（{hall.companyCount} 家）
                    </button>
                  ))}
                </div>
              </div>
              {guide.facilities.length > 0 ? (
                <div className="dw-row-chips">
                  {guide.facilities.map((facility) => {
                    const Icon = FACILITY_ICON[facility.type] ?? InfoIcon
                    return (
                      <span key={facility.id} className="dw-tag slate">
                        <Icon size={16} aria-hidden />
                        {facility.name}
                        {facility.locationLabel ? ` · ${facility.locationLabel}` : ''}
                        {facility.relatedHallCode ? ` · ${facility.relatedHallCode} 厅` : ''}
                      </span>
                    )
                  })}
                </div>
              ) : null}
              {activeHall ? (
                <>
                  <p className="dw-rhead" style={{ marginTop: 12 }}>
                    <span className="rn">{activeHall.hallName}</span>
                    {/* 主办方没标行业就不写。原来兜底成「综合展区」——那是本机替主办方
                        给展厅定了性，而现场指示牌上可能根本没有这四个字。 */}
                    {activeHall.industryCategory ? <span>{activeHall.industryCategory}</span> : null}
                    {activeHall.boothRange ? <span>展位 {activeHall.boothRange}</span> : null}
                    <span className="rsp">共 {activeHall.companyCount} 家企业</span>
                  </p>
                  {activeHall.companies.length === 0 ? (
                    <p className="dw-why">该展厅暂未录入企业。</p>
                  ) : (
                    <div className="dw-rlist">
                      {activeHall.companies.map((company) => (
                        <button
                          key={company.companyId}
                          type="button"
                          className="dw-row"
                          onClick={() => navigate(`/job-fairs/${fairId}/companies/${company.companyId}`)}
                        >
                          <span className="dw-row-ic slate"><BuildingIcon size={24} aria-hidden /></span>
                          <span className="dw-row-main">
                            <span className="dw-row-t">
                              {company.companyName}
                              {company.boothNo ? <span className="dw-tag">展位 {company.boothNo}</span> : null}
                            </span>
                            <span className="dw-row-sub">
                              {/* 「岗位待录入」是在替主办方解释他们的后台状态：本机看到的只是
                                  jobCount=0，它既可能是还没录，也可能是这家本来就不带岗位来。
                                  不知道就不说，这一行直接不出现。行业同理。 */}
                              {company.industry ? <span>{company.industry}</span> : null}
                              {company.jobCount > 0 ? <span>{company.jobCount} 个岗位</span> : null}
                            </span>
                          </span>
                          <span className="dw-row-go" aria-hidden>›</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </section>
          ) : null}

          {zones.length > 0 ? (
            <section className="dw-blk">
              <div className="dw-sec-h">
                <span className="t">场馆分区</span>
                <span className="hint">由主办方 / 管理员配置，现场以指示牌为准</span>
              </div>
              <div className="qxfw-zones">
                {zones.map((zone) => (
                  <button
                    key={zone.id}
                    type="button"
                    className="qxfw-zone"
                    aria-pressed={activeZone === zone.zoneName}
                    disabled={!hasInteractiveMap}
                    onClick={() => {
                      setActiveZone(activeZone === zone.zoneName ? null : zone.zoneName)
                      setSelectedBooth(null)
                    }}
                  >
                    <b>{zone.zoneName}</b>
                    {zone.industry ? <span className="theme">{zone.industry}</span> : null}
                    {zone.description || zone.city
                      ? <span className="range">{zone.description || zone.city}</span>
                      : null}
                  </button>
                ))}
              </div>
              {/* 仅在接口真实提供非零统计时展示，避免把适配层的 0 占位包装成现场指标。 */}
              {metricZones.length > 0 && (
                <div className="qxfw-bars" style={{ marginTop: 14 }}>
                  {metricZones.map((zone) => {
                    const rate = Math.round((zone.checkedInCount / zone.boothCount) * 100)
                    return (
                      <div key={zone.id} className="qxfw-bar">
                        <span>{zone.zoneName}{zone.industry ? ` · ${zone.industry}` : ''}</span>
                        <span className="qxfw-track"><i style={{ width: `${rate}%` }} /></span>
                        <span className="n">已签到 {zone.checkedInCount}/{zone.boothCount}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          ) : null}

          {booths.length > 0 ? (
            <section className="dw-blk">
              <div className="dw-sec-h">
                <span className="t">{activeZone ? `${activeZone} 展位` : '展位索引'}</span>
                <span className="hint">
                  {activeZone
                    ? `已选 ${activeZone}（共 ${displayedBooths.length} 个展位）· 点展位查看入驻企业`
                    : `共 ${displayedBooths.length} 个展位 · 点上方展区可筛选`}
                </span>
              </div>
              <div className="qxfw-booths" data-testid="fair-map-booths">
                {displayedBooths.map((booth) => (
                  <button
                    key={booth.id}
                    type="button"
                    className="qxfw-booth"
                    data-status={booth.status}
                    aria-pressed={selectedBooth?.id === booth.id}
                    onClick={() => setSelectedBooth(selectedBooth?.id === booth.id ? null : booth)}
                  >
                    <span>{booth.boothNumber}</span>
                    {booth.companyName ? <small>{booth.companyName.slice(0, 6)}</small> : null}
                  </button>
                ))}
              </div>
              {selectedBooth ? (
                <div className="dw-row solid" style={{ marginTop: 12 }}>
                  <span className="dw-row-ic"><MapPinIcon size={24} aria-hidden /></span>
                  <span className="dw-row-main">
                    <span className="dw-row-t">
                      {selectedBooth.companyName
                        ? `${selectedBooth.companyName} · 展位 ${selectedBooth.boothNumber}`
                        : `展位 ${selectedBooth.boothNumber}`}
                      <span className="dw-tag slate">{BOOTH_STATUS_LABELS[selectedBooth.status]}</span>
                    </span>
                    <span className="dw-row-sub">
                      {/* 展区 / 行业都没有时整段不出现：一句「展区信息由主办方提供」
                          既没给信息，又让人以为下面还会有内容。 */}
                      {[selectedBooth.zoneName && `所属展区 ${selectedBooth.zoneName}`, selectedBoothZone?.industry]
                        .filter(Boolean).length > 0 ? (
                        <span>
                          {[selectedBooth.zoneName && `所属展区 ${selectedBooth.zoneName}`, selectedBoothZone?.industry]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {selectedBooth.companyId ? (
                    <button
                      type="button"
                      className="qx-btn"
                      data-variant="teal"
                      onClick={() => {
                        const companyId = selectedBooth.companyId!
                        setSelectedBooth(null)
                        navigate(`/job-fairs/${fairId}/companies/${companyId}`)
                      }}
                    >
                      查看企业详情
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : (
            <DirState tone="empty" testId="fair-map-booths-empty" title="暂无展位明细">
              主办方已发布展区信息，但暂未发布可查询的展位明细。
            </DirState>
          )}

          {fair ? (
            <DirKv rows={[
              ['来源机构', fair.sourceName],
              ['同步时间', fair.syncTime ? fmtFairSyncDate(fair.syncTime) : '同步时间未知'],
              ['外部编号', fair.externalId],
            ]} />
          ) : null}

          <DirNote>场馆导览信息由主办方提供，仅供现场参考；岗位办理请前往来源平台。</DirNote>
        </>
      )}
    </QxFairWorkbench>
  )
}
