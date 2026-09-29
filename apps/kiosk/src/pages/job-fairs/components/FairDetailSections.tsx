// /job-fairs/:id 详情页的分区（稿 28-jobfair-enhanced.html，screen=detail / 086）。
//
// 稿把详情页画成四块：hero（场次名 + 主办方/时间/地点）、source（来源三要素）、
// subnav（这场里可以做的五件事，各自一条路由）、notice（去之前先知道的三条）。
// 旧的四 Tab 壳（详情与特色 / 参展企业与岗位 / 场馆导览 / 数据大屏）随之退休——
// 那四个 Tab 的内容本来就各自有真路由（/companies /map /stats），
// 在详情页再复刻一份预览等于同一份数据维护两处，稿也没有这样画。
//
// 「详情与特色」里真正只属于详情页的部分（地址与交通、扫码导航、场馆图、
// 主办方描述、创新特色展区）保留在本文件，没有丢。

import type { ExternalJobFairDTO, FairZoneDTO } from '@ai-job-print/shared'
import {
  BarChart3Icon,
  BuildingIcon,
  CalendarIcon,
  FileTextIcon,
  MapIcon,
  MapPinIcon,
  NavigationIcon,
  SparklesIcon,
} from 'lucide-react'
import { MapBlock } from './MapBlock'
import { FairRowLink } from './FairWorkbenchBits'
import { DirKv, DirSteps } from '../../../components/qingxu/directory/DirectoryBits'
import { fmtFairFullDateTime, fmtFairSyncDate } from '../fairFormat'

/**
 * 一条 subnav 行背后那次请求的结局。
 *
 * 三档而不是两档，是因为「没取到」和「主办方没提供」在屏幕上长得一样，
 * 说错一句的代价却完全不同：说成「主办方还没提供」时用户不会再点进去，
 * 而实际上刷新一下就有了。`loading` 是第三档 —— 请求还没回来时不下结论。
 */
type FairCountAvailability =
  | { outcome: 'loading' }
  | { outcome: 'failed' }
  | { outcome: 'ok'; count: number }

type FairFlagAvailability<K extends string> =
  | { outcome: 'loading' }
  | { outcome: 'failed' }
  | ({ outcome: 'ok' } & Record<K, boolean>)

export interface FairSubnavAvailability {
  /** 参展名单：ok 时带真实家数（0 家也算 ok，如实说「还没提供」）。 */
  companies: FairCountAvailability
  /** 展位图 / 展位索引是否存在。 */
  map: FairFlagAvailability<'hasMap'>
  /** 可下载物料份数。 */
  materials: FairCountAvailability
  /** 主办方是否回传了**真实**统计（isMockData 一律按没有算）。 */
  stats: FairFlagAvailability<'hasRealStats'>
  /** 已结束场次的 AI 出口换语义：回顾 / 跟进，不再是「参会准备」。 */
  isEnded: boolean
}

/** 请求还没回来 / 这次没取到时的统一说法。两句都不替主办方下结论。 */
const PENDING_DESC = '正在确认这一项有没有数据。'
const FAILED_DESC = '这一项这次没取到，不代表主办方没提供；进去可以重新加载。'

export function FairHero({ fair }: { fair: ExternalJobFairDTO }) {
  const companyCount = fair.hasManagedData ? fair.managedCompanyCount : (fair.boothCount ?? 0)
  return (
    <section className="dw-blk">
      <h2 className="dw-row-t dw-title-lg">
        {fair.name}
        {fair.status === 'ended' ? <span className="dw-tag wheat">已结束</span> : null}
        {fair.status === 'ongoing' ? <span className="dw-tag">进行中</span> : null}
        {fair.status === 'upcoming' ? <span className="dw-tag slate">即将开始</span> : null}
      </h2>
      <div className="dw-row-sub dw-row-sub-gap">
        <span><BuildingIcon size={20} aria-hidden />主办方 {fair.organizer}</span>
        <span><CalendarIcon size={20} aria-hidden />举办时间 {fmtFairFullDateTime(fair.startTime)} — {fmtFairFullDateTime(fair.endTime)}</span>
        <span><MapPinIcon size={20} aria-hidden />举办地点 {fair.city ? `${fair.city} · ` : ''}{fair.venue}</span>
      </div>
      <div className="dw-row-chips">
        <span className="dw-tag slate">参展企业 {companyCount} 家</span>
        {fair.jobCount != null ? <span className="dw-tag slate">招聘岗位 {fair.jobCount} 个</span> : null}
        {fair.expectedAttendance != null ? (
          <span className="dw-tag wheat">主办方预计参会 {fair.expectedAttendance.toLocaleString()} 人</span>
        ) : null}
      </div>
      {fair.description ? <p className="dw-ai-d" style={{ marginTop: 14 }}>{fair.description}</p> : null}
    </section>
  )
}

/** 来源三要素。缺一即不放行预约入口——这是合规底线，不是展示偏好。 */
export function FairSourceBlock({ fair }: { fair: ExternalJobFairDTO }) {
  return (
    <section className="dw-blk">
      <div className="dw-sec-h">
        <span className="t">信息来源</span>
        <span className="hint">来源要素不全即不放行预约入口</span>
      </div>
      <DirKv rows={[
        ['来源机构', fair.sourceName],
        ['同步时间', fair.syncTime ? fmtFairSyncDate(fair.syncTime) : '同步时间未知'],
        ['外部编号', fair.externalId],
        ['数据来源说明', fair.dataSourceNote || '本机仅展示来源信息，信息以来源平台为准。'],
      ]} />
    </section>
  )
}

/** 地址、交通与场馆图。没有真实图就落 MapBlock 自己的诚实兜底，不自画示意图。 */
export function FairVenueBlock({
  fair,
  navUrl,
  onNav,
}: {
  fair: ExternalJobFairDTO
  navUrl: string | null
  onNav: () => void
}) {
  if (!fair.address && !fair.trafficInfo && !navUrl && !fair.mapImageUrl && fair.latitude == null) return null
  return (
    <section className="dw-blk">
      <div className="dw-sec-h"><span className="t">怎么到现场</span><span className="hint">以主办方公示与现场指示牌为准</span></div>
      {fair.address || fair.trafficInfo ? (
        <DirKv rows={[
          ...(fair.address ? [['详细地址', fair.address] as [string, string]] : []),
          ...(fair.trafficInfo ? [['交通指引', fair.trafficInfo] as [string, string]] : []),
        ]} />
      ) : null}
      <div className="qxfw-venue">
        <MapBlock lat={fair.latitude} lng={fair.longitude} mapImageUrl={fair.mapImageUrl} venue={fair.venue} />
      </div>
      {navUrl ? (
        <button type="button" className="qx-btn" data-variant="ghost" onClick={onNav} style={{ alignSelf: 'flex-start' }}>
          <NavigationIcon size={20} aria-hidden />
          扫码在手机上导航
        </button>
      ) : null}
    </section>
  )
}

/** 创新特色展区：只渲染主办方真的配置过的展区，一个都没有就整块不出现。 */
export function FairFeaturedZones({ zones }: { zones: FairZoneDTO[] }) {
  if (zones.length === 0) return null
  return (
    <section className="dw-blk">
      <div className="dw-sec-h"><span className="t">各市区创新特色展区</span><span className="hint">由主办方设置，现场以指示牌为准</span></div>
      <div className="qxfw-zones">
        {zones.map((zone) => (
          <div key={zone.id} className="qxfw-zone" role="presentation">
            <b>{zone.zoneName}</b>
            {zone.industry ? <span className="theme">{zone.industry}</span> : null}
            {zone.description || zone.city
              ? <span className="range">{zone.description || zone.city}</span>
              : null}
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * 稿 fairSubnav：这场招聘会里可以做的五件事。
 * 每一条的副文案必须说明「这一项的数据到底有没有」——稿原话是
 * 「每一项各自核验数据，缺数据就诚实空着」。
 */
export function FairSubnav({
  availability,
  onCompanies,
  onMap,
  onMaterials,
  onVisitPlan,
  onStats,
}: {
  availability: FairSubnavAvailability
  onCompanies: () => void
  onMap: () => void
  onMaterials: () => void
  onVisitPlan: () => void
  onStats: () => void
}) {
  const { companies, map, materials, stats, isEnded } = availability
  return (
    <section className="dw-sec">
      <div className="dw-sec-h">
        <span className="t">这场招聘会里可以做的</span>
        <span className="hint">每一项各自核验数据，缺数据就诚实空着</span>
      </div>
      <div className="dw-rlist">
        <FairRowLink
          icon={<BuildingIcon size={24} aria-hidden />}
          title="参展企业名单"
          desc={describeCount(
            companies,
            (count) => count > 0
              ? `主办方已提供 ${count} 家，可看展位号并进入企业详情。`
              : '主办方还没有提供名单，进去会看到空态。',
          )}
          onClick={onCompanies}
          testId="fair-detail-companies"
        />
        <FairRowLink
          icon={<MapIcon size={24} aria-hidden />}
          title="展位分布"
          desc={map.outcome === 'ok'
            ? (map.hasMap ? '主办方提供了展位图或展位索引，可按展区查看。' : '主办方没有提供展位图或展位索引。')
            : map.outcome === 'failed' ? FAILED_DESC : PENDING_DESC}
          onClick={onMap}
          testId="fair-detail-map"
        />
        <FairRowLink
          icon={<FileTextIcon size={24} aria-hidden />}
          title="活动物料"
          desc={describeCount(
            materials,
            (count) => count > 0 ? `${count} 份，可现场打印带走。` : '这场还没有可下载的物料。',
          )}
          onClick={onMaterials}
          testId="fair-detail-materials"
        />
        <FairRowLink
          icon={<SparklesIcon size={24} aria-hidden />}
          title={isEnded ? 'AI参会回顾' : 'AI 参会准备清单'}
          desc={isEnded ? '基于本人简历梳理后续跟进；不承诺结果。' : '需要你确认本人简历；不排路线、不承诺结果。'}
          onClick={onVisitPlan}
          testId="fair-detail-visit-plan"
        />
        <FairRowLink
          icon={<BarChart3Icon size={24} aria-hidden />}
          title="现场统计"
          desc={stats.outcome === 'ok'
            ? (stats.hasRealStats ? '主办方已回传统计，数值不由本机估算。' : '主办方还没有回传统计，进去会看到空态。')
            : stats.outcome === 'failed' ? FAILED_DESC : PENDING_DESC}
          onClick={onStats}
          testId="fair-detail-stats"
        />
      </div>
    </section>
  )
}

/** 稿 fairNotice：三条「去之前先知道这几件事」。 */
function describeCount(item: FairCountAvailability, ok: (count: number) => string): string {
  if (item.outcome === 'ok') return ok(item.count)
  return item.outcome === 'failed' ? FAILED_DESC : PENDING_DESC
}

export function FairNoticeBlock({ rules }: { rules: readonly string[] }) {
  return (
    <section className="dw-blk">
      <div className="dw-sec-h"><span className="t">去之前先知道这几件事</span></div>
      <DirSteps items={[...rules]} />
    </section>
  )
}
