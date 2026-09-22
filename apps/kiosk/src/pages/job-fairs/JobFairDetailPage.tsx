// /job-fairs/:id —— 招聘会详情（稿 28-jobfair-enhanced.html，screen=detail / 086）。
//
// 状态与稿同名：detail | loading | ended | unpublished | error。
// 版面 = hero + 来源三要素 + 怎么到现场 + 特色展区 + 这场里可以做的五件事 + 三条提醒，
// 分区实现见 components/FairDetailSections.tsx。
//
// 旧的四 Tab（详情与特色 / 参展企业与岗位 / 场馆导览 / 数据大屏）已随本次迁移退休：
// 后三个 Tab 的内容各自有真路由（/companies、/map、/stats），详情页再放一份预览
// 等于同一份数据维护两处；稿把它们画成 subnav 五行。场馆导览（getFairVenueGuide）
// 迁到 /job-fairs/:id/map —— 那才是它的落点，能力没有丢。
//
// 「预约结果本机不记录」这条不变：openBookingQr / openCheckinQr 只记录**打开来源入口**
// 这个动作（external_appointment / external_checkin_open），不记录你有没有办成。
//
// 来源四要素（来源机构 / 同步时间 / 外部ID / 外部链接）缺一即**不放行**外跳与扫码：
// 按钮 aria-disabled、底栏常显缺哪几项，点击直接返回。这条是 fail-closed，
// 不是「记不上日志但照样弹码」——二维码一旦出屏，用户就已经离开本机了，
// 事后没有任何补救手段，所以拦截必须发生在弹码之前。

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import type { ExternalJobFairDTO, FairZoneDTO } from '@ai-job-print/shared'
import { CalendarIcon, QrCodeIcon, UsersIcon } from 'lucide-react'
import { getFairCompanies, getFairMaterials, getFairStats, getFairZones, getJobFairById } from '../../services/api'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { buildNavUrl } from '../../lib/url'
import { useFavorites } from '../../favorites/useFavorites'
import { useAuth } from '../../auth/useAuth'
import { evaluateJobSourceTrust, sourceTrustReason } from '../jobs/utils/sourceTrust'
import { FAIR_BOOKING_LINK_UNAVAILABLE_REASON } from '../../lib/capabilityReasons'
import { QxFairWorkbench } from './QxFairWorkbench'
import { FAIR_NOTICE_RULES } from './fairWorkbenchSpecs'
import { FairQrOverlay, FairSkeletonList } from './components/FairWorkbenchBits'
import {
  FairFeaturedZones,
  FairHero,
  FairNoticeBlock,
  FairSourceBlock,
  FairSubnav,
  FairVenueBlock,
  type FairSubnavAvailability,
} from './components/FairDetailSections'
import { DirState, DirStrip, DirStripItem } from '../../components/qingxu/directory/DirectoryBits'

type QrState =
  | { kind: 'book' }
  | { kind: 'checkin' }
  | { kind: 'nav'; url: string }
  | null

export function JobFairDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const location = useLocation()

  const stateFair = (location.state as { fair?: ExternalJobFairDTO } | null)?.fair
  const hasStateMatch = stateFair?.id === id

  const [fair, setFair] = useState<ExternalJobFairDTO | null>(hasStateMatch ? stateFair! : null)
  const [loading, setLoading] = useState(!hasStateMatch)
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [qr, setQr] = useState<QrState>(null)

  /**
   * subnav 每一行都要回答「这一项到底有没有数据」。子请求失败时**不能**把它
   * 折成「主办方还没提供」——那是替主办方认领一件没发生的事，用户也不会再点进去。
   * 所以每一项都带上自己的结局，缺省 'loading' 先不下结论。
   */
  const [availability, setAvailability] = useState<FairSubnavAvailability>({
    companies: { outcome: 'loading' },
    map: { outcome: 'loading' },
    materials: { outcome: 'loading' },
    stats: { outcome: 'loading' },
    isEnded: false,
  })
  const [zones, setZones] = useState<FairZoneDTO[]>([])

  // 收藏（C-2D）：登录走 /me/favorites，匿名存本机；仅兴趣标记，不形成预约/投递闭环。
  const { isFavorite, toggle: toggleFavorite } = useFavorites()
  const isFav = id ? isFavorite('job_fair', id) : false
  const { getToken } = useAuth()

  useEffect(() => {
    // 带 location.state 直达时不重复取详情；但用户点了「重新加载」就必须真的重取，
    // 否则错误态里的重试按钮只是个安慰剂。
    if (hasStateMatch && retryKey === 0) return
    let cancelled = false
    setLoading(true)
    setError(false)
    getJobFairById(id!)
      .then((res) => { if (!cancelled) { setFair(res.data); if (!res.data) setError(true) } })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, hasStateMatch, retryKey])

  // 子任务各自失败只影响自己那一行副文案，不拖垮详情页（稿 fallback 口径）。
  // 注意每一项都把 failed 与「服务端真的返回了空」区分开，见 availability 的注释。
  useEffect(() => {
    if (!fair) return
    const ended = fair.status === 'ended'
    let cancelled = false
    Promise.all([
      getFairCompanies(fair.id).then((r) => ({ outcome: 'ok' as const, count: r.data.length })).catch(() => ({ outcome: 'failed' as const })),
      getFairZones(fair.id).then((r) => ({ outcome: 'ok' as const, zones: r.data })).catch(() => ({ outcome: 'failed' as const, zones: [] as FairZoneDTO[] })),
      getFairMaterials(fair.id).then((r) => ({ outcome: 'ok' as const, count: r.pagination?.total ?? r.data.length })).catch(() => ({ outcome: 'failed' as const })),
      getFairStats(fair.id).then((r) => ({ outcome: 'ok' as const, stats: r.data })).catch(() => ({ outcome: 'failed' as const, stats: null })),
    ]).then(([companies, zonesResult, materials, statsResult]) => {
      if (cancelled) return
      setZones(zonesResult.zones ?? [])
      setAvailability({
        companies,
        map: zonesResult.outcome === 'ok'
          ? { outcome: 'ok', hasMap: (zonesResult.zones ?? []).length > 0 }
          : { outcome: 'failed' },
        materials,
        // 统计只认真实回传：isMockData 一律按「没有」算，绝不把演示数据说成现场数据。
        stats: statsResult.outcome === 'ok'
          ? { outcome: 'ok', hasRealStats: Boolean(statsResult.stats && !statsResult.stats.isMockData) }
          : { outcome: 'failed' },
        isEnded: ended,
      })
    })
    return () => { cancelled = true }
  }, [fair])

  const featuredZones = useMemo(() => zones.filter((z) => z.category === 'innovation'), [zones])

  // 浏览记录（P1）：详情真实加载后上报；fire-and-forget，失败不影响页面；服务端 30 分钟去重。
  useEffect(() => {
    if (fair?.id) recordBrowse(getToken(), 'job_fair', fair.id)
  }, [fair?.id, getToken])

  // 来源四要素门禁。book 看 sourceUrl，checkin 看 checkinUrl，其余三项共用。
  const bookTrust = evaluateJobSourceTrust(fair ?? {})
  const checkinTrust = evaluateJobSourceTrust({
    sourceName: fair?.sourceName,
    syncTime: fair?.syncTime,
    externalId: fair?.externalId,
    sourceUrl: fair?.checkinUrl,
  })

  // 外部跳转记录（P1）：只记录「打开来源平台预约入口」动作；预约结果以来源平台为准，本系统不记录。
  // 要素不全时**先拦住，再谈记录**：原实现是「记不上日志，但码照弹」，
  // 那等于把一个本机无法核对来源的链接推到用户手机上。
  const openBookingQr = () => {
    if (!fair || !bookTrust.ok) return
    recordExternalJump(getToken(), 'job_fair', fair.id, 'external_appointment')
    setQr({ kind: 'book' })
  }

  const openCheckinQr = () => {
    if (!fair || !checkinTrust.ok) return
    recordExternalJump(getToken(), 'job_fair', fair.id, 'external_checkin_open')
    setQr({ kind: 'checkin' })
  }

  const isEnded = fair?.status === 'ended'
  const blockedReason = bookTrust.ok ? '' : sourceTrustReason(bookTrust, FAIR_BOOKING_LINK_UNAVAILABLE_REASON, 'job_fair')
  const isUnpublished = Boolean(fair && fair.publishStatus && fair.publishStatus !== 'published')
  const uiState = loading
    ? 'loading'
    : error || !fair
      ? 'error'
      : isUnpublished
        ? 'unpublished'
        : isEnded
          ? 'ended'
          : 'detail'

  const navUrl = fair
    ? buildNavUrl({
      latitude: fair.latitude,
      longitude: fair.longitude,
      venue: fair.venue,
      address: fair.address,
    })
    : null

  // 合规：打印只基于机构上传的真实活动资料（FairMaterial），不构造虚拟文件；
  // 「打印资料」跳真实资料列表页，逐份选择打印。
  const handlePrintMaterial = () => { if (fair) navigate(`/job-fairs/${fair.id}/materials`) }
  const handleVisitPlan = () => { if (fair) navigate(`/job-fairs/${fair.id}/visit-plan`) }

  /*
   * 底栏只放**这一屏的主操作**，每态最多两个大键。
   *
   * 2026-09-20 去重：此前这里还有「AI准备单 / AI参会回顾」和「打印资料」两个键，
   * 而 subnav 的五行里本来就各有一行同名入口、还附带「这一项有没有数据」的说明。
   * 同一屏两个同名控件指向同一条路由，读屏上是两个无法区分的目标，触屏上是
   * 四个键挤在一条里（每个都被压到最小宽度）。入口留在 subnav，底栏只留
   * 「离开本机去办」的那两件事：扫码签到、扫码预约。
   */
  const ctabar = uiState === 'loading'
    ? <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/job-fairs')}>返回场次列表</button>
    : uiState === 'error'
      ? (
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/help')}>找工作人员</button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => setRetryKey((k) => k + 1)}>重新加载</button>
        </>
      )
    : uiState === 'unpublished'
      ? (
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/help')}>向工作人员反馈</button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/job-fairs')}>回场次列表</button>
        </>
      )
      : isEnded
        ? (
          <>
            <button type="button" className="qx-btn narrow" data-variant="ghost" onClick={() => navigate(`/job-fairs/${fair!.id}/companies`)}>
              看当时的参展名单
            </button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/job-fairs')}>
              看还在进行的场次
            </button>
          </>
        )
        : (
          <>
            {/* 要素不全时把缺了哪几项写在常显位置：触屏读不到 title，
                只给一个点不动的按钮等于让用户反复点。 */}
            <p className="why">
              {bookTrust.ok
                ? '预约在来源平台完成；本机不代预约，也拿不到预约结果。'
                : blockedReason}
            </p>
            {fair?.checkinUrl ? (
              <button
                type="button"
                className="qx-btn narrow"
                data-variant="ghost"
                aria-disabled={checkinTrust.ok ? undefined : true}
                onClick={openCheckinQr}
              >
                <QrCodeIcon size={20} aria-hidden />
                扫码签到
              </button>
            ) : null}
            <button
              type="button"
              className="qx-btn narrow"
              data-variant="primary"
              aria-disabled={bookTrust.ok ? undefined : true}
              onClick={openBookingQr}
            >
              <QrCodeIcon size={20} aria-hidden />
              扫码预约
            </button>
          </>
        )

  return (
    <QxFairWorkbench
      screen="detail"
      state={uiState}
      fairId={id ?? ''}
      title={fair && uiState !== 'error' ? fair.name : undefined}
      subtitle={fair && uiState !== 'error' ? `来源 · ${fair.sourceName} · 信息以来源平台为准` : undefined}
      ctabar={ctabar}
    >
      {qr?.kind === 'book' && fair ? (
        <FairQrOverlay
          title="扫码前往来源平台预约"
          subtitle={fair.name}
          value={fair.sourceUrl}
          meta={[
            { label: '来源机构', value: fair.sourceName },
            { label: '外部编号', value: fair.externalId },
          ]}
          note="请使用手机扫码前往来源平台办理预约，预约由对方平台管理，本系统不参与活动报名流程、不接收简历。"
          onClose={() => setQr(null)}
        />
      ) : null}
      {qr?.kind === 'checkin' && fair ? (
        <FairQrOverlay
          title="扫码前往来源平台签到"
          subtitle={fair.name}
          value={fair.checkinUrl}
          meta={[
            { label: '来源机构', value: fair.sourceName },
            { label: '外部编号', value: fair.externalId },
          ]}
          note="请使用手机扫码前往来源平台签到。本系统不记录签到结果，不参与现场入场办理。"
          onClose={() => setQr(null)}
        />
      ) : null}
      {qr?.kind === 'nav' && fair ? (
        <FairQrOverlay
          title="扫码在手机上导航"
          subtitle={fair.venue}
          value={qr.url}
          note="请使用手机扫码，在手机地图中打开场馆位置并开始导航。"
          onClose={() => setQr(null)}
        />
      ) : null}

      {uiState === 'loading' ? (
        <>
          <FairSkeletonList rows={2} />
          <p className="dw-why">正在取这场的详情与来源三要素。字段返回前不展示任何内容。</p>
        </>
      ) : uiState === 'error' || !fair ? (
        <>
          <DirState tone="error" testId="fair-detail-error" title="这场的详情没取到">
            请求失败。本机<b>不拿列表里的片段拼一个详情页</b>给你，时间地点错了会让人白跑。
          </DirState>
          <DirStrip>
            <DirStripItem icon={CalendarIcon} tone="wheat" title="回场次列表" desc="列表还能打开，可以先看别的场次" onClick={() => navigate('/job-fairs')} />
            <DirStripItem icon={QrCodeIcon} title="到场指引" desc="通用指引不依赖这场的详情接口" onClick={() => navigate('/job-fairs/checkin')} />
          </DirStrip>
        </>
      ) : uiState === 'unpublished' ? (
        <>
          <DirState tone="error" testId="fair-detail-unpublished" title="这场已经被来源方下架">
            主办方或管理员把这条信息取消发布了。本机<b>不保留下架内容的副本</b>，也不展示缓存的时间地点。
          </DirState>
          <DirStrip>
            <DirStripItem icon={UsersIcon} title="岗位信息" desc="按岗位继续找，来源与有效期照样标注" onClick={() => navigate('/jobs')} />
            <DirStripItem icon={CalendarIcon} tone="wheat" title="回场次列表" desc="看看还有哪些场次可以去" onClick={() => navigate('/job-fairs')} />
          </DirStrip>
        </>
      ) : (
        <>
          <FairHero fair={fair} />
          {isEnded ? (
            <DirState tone="info" testId="fair-detail-ended" title="这场招聘会已经结束">
              举办时间已经过去，所以<b>不再提供预约入口</b>。参展名单与物料如果主办方仍然保留，可以继续查看。
            </DirState>
          ) : null}
          <FairSourceBlock fair={fair} />
          <div className="dw-fgrp">
            <div className="fc">
              <button
                type="button"
                className={`dw-chip${isFav ? ' on' : ''}`}
                aria-pressed={isFav}
                aria-label={isFav ? '取消收藏' : '收藏招聘会'}
                onClick={() => toggleFavorite({ type: 'job_fair', id: fair.id, title: fair.name })}
              >
                {isFav ? '已收藏' : '收藏这场'}
              </button>
              <span className="dw-why">收藏只是这台终端的浏览辅助，不代表已预约、已报名或已签到。</span>
            </div>
          </div>
          <FairVenueBlock fair={fair} navUrl={navUrl} onNav={() => navUrl && setQr({ kind: 'nav', url: navUrl })} />
          <FairFeaturedZones zones={featuredZones} />
          <FairSubnav
            availability={availability}
            onCompanies={() => navigate(`/job-fairs/${fair.id}/companies`)}
            onMap={() => navigate(`/job-fairs/${fair.id}/map`)}
            onMaterials={handlePrintMaterial}
            onVisitPlan={handleVisitPlan}
            onStats={() => navigate(`/job-fairs/${fair.id}/stats`)}
          />
          <FairNoticeBlock rules={FAIR_NOTICE_RULES} />
        </>
      )}
    </QxFairWorkbench>
  )
}
