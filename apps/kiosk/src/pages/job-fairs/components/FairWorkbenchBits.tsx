// 招聘会共享工作台的页内基础件（青序流光）。
//
// 稿 28-jobfair-enhanced.html 里 fairListCard / companyRow / boothRow / materialRow /
// qr-placeholder / skel 这几块在多个 screen 之间复用，所以抽到一处；
// 通用的分区、状态块、kv、tile、steps 继续用 components/qingxu/directory 的 `Dir*`，
// 不在本文件重复实现。

import { type ReactNode } from 'react'
import type { ExternalJobFairDTO } from '@ai-job-print/shared'
import {
  Building2Icon,
  CalendarIcon,
  ClockIcon,
  ExternalLinkIcon,
  MapPinIcon,
  QrCodeIcon,
  StarIcon,
  XIcon,
} from 'lucide-react'
import { SourceUrlQr } from '../../../components/SourceUrlQr'
import { SOURCE_ELEMENT_MISSING_TEXT } from '../../jobs/utils/sourceTrust'
import { fmtFairDate, fmtFairSync, fmtFairTime } from '../fairFormat'

/**
 * 来源要素缺项时显示「来源平台未提供」，而不是把标签后面留白。
 *
 * 留白看起来像渲染坏了，也说不清是谁没给；而这几项**正是**预约被拦下的原因
 * （见 evaluateJobSourceTrust），按钮旁边的阻断说明点名的就是它们——
 * 卡片这边必须能对得上号。文案沿用岗位域的同一个常量，两处不另起叫法。
 */
function sourceValue(text: string | null | undefined): string {
  return typeof text === 'string' && text.trim() ? text : SOURCE_ELEMENT_MISSING_TEXT
}

const THEME_LABEL: Record<string, string> = {
  campus: '校园双选会',
  campus_corp: '校企合作专场',
  industry: '行业专场',
  general: '综合招聘会',
}

const STATUS_LABEL: Record<ExternalJobFairDTO['status'], string> = {
  upcoming: '即将开始',
  ongoing: '进行中',
  ended: '已结束',
}

// 不导出：只有本文件的场次卡用它。导出会让这个模块同时导出组件与工具函数，
// react-refresh/only-export-components 会因此对整个文件停用热更新。
function fairStatusTagTone(status: ExternalJobFairDTO['status']): string {
  if (status === 'ongoing') return 'dw-tag'
  if (status === 'upcoming') return 'dw-tag wheat'
  return 'dw-tag slate'
}

/**
 * 场次卡（稿 .fair-card）。
 *
 * 「查看详情」按钮的无障碍名逐字是 `查看 {场次名} 详情` —— 一体机上一屏有多张卡，
 * 只写「查看详情」读屏用户无从分辨是哪一场；跨端旅程用例也按这个名字找入口。
 */
export function FairListCard({
  fair,
  favorite,
  bookBlockedReason,
  onToggleFavorite,
  onBook,
  onDetail,
}: {
  fair: ExternalJobFairDTO
  favorite: boolean
  /**
   * 来源四要素缺项时的常显原因（空串＝可放行）。
   * 有值时「扫码预约」aria-disabled 且点击不出码 —— 码一旦出屏用户就离开本机了，
   * 事后没有补救手段，所以拦在出码之前，并把缺了哪几项写在按钮旁边。
   */
  bookBlockedReason?: string
  onToggleFavorite: () => void
  onBook: () => void
  onDetail: () => void
}) {
  const isEnded = fair.status === 'ended'
  const themeLabel = fair.theme ? (THEME_LABEL[fair.theme] ?? '招聘会') : '招聘会'
  const companyCount = fair.hasManagedData ? fair.managedCompanyCount : (fair.boothCount ?? 0)

  return (
    <article className="qxfw-fair" data-past={isEnded ? 'true' : undefined} data-testid={`fair-card-${fair.id}`}>
      <span className="qxfw-fair-ic"><CalendarIcon size={28} aria-hidden /></span>
      <div className="qxfw-fair-main">
        <h2 className="qxfw-fair-t">
          {fair.name}
          <span className="dw-tag slate">{themeLabel}</span>
          <span className={fairStatusTagTone(fair.status)}>{STATUS_LABEL[fair.status]}</span>
        </h2>
        <div className="qxfw-fair-meta">
          <span><ClockIcon size={19} aria-hidden />时间 {fmtFairDate(fair.startTime)} {fmtFairTime(fair.startTime)}—{fmtFairTime(fair.endTime)}</span>
          <span><MapPinIcon size={19} aria-hidden />地点 {fair.city ? `${fair.city} · ` : ''}{fair.venue}</span>
          {companyCount > 0 ? (
            <span><Building2Icon size={19} aria-hidden />参展数 {companyCount} 家{fair.jobCount != null ? ` · ${fair.jobCount} 个岗位` : ''}</span>
          ) : null}
        </div>
        <div className="qxfw-fair-src">
          <span>来源 {sourceValue(fair.sourceName)}</span>
          <span>同步 {fair.syncTime ? fmtFairSync(fair.syncTime) : SOURCE_ELEMENT_MISSING_TEXT}</span>
          <span>外部编号 {sourceValue(fair.externalId)}</span>
        </div>
      </div>
      <div className="qxfw-fair-acts">
        <button
          type="button"
          className="qx-btn"
          data-variant={favorite ? 'teal' : 'ghost'}
          aria-pressed={favorite}
          aria-label={favorite ? `取消收藏 ${fair.name}` : `收藏 ${fair.name}`}
          onClick={onToggleFavorite}
        >
          <StarIcon size={20} aria-hidden />
          {favorite ? '已收藏' : '收藏场次'}
        </button>
        {isEnded ? null : (
          <>
            <button
              type="button"
              className="qx-btn"
              data-variant="ghost"
              aria-disabled={bookBlockedReason ? true : undefined}
              aria-describedby={bookBlockedReason ? `fair-book-blocked-${fair.id}` : undefined}
              onClick={onBook}
            >
              <QrCodeIcon size={20} aria-hidden />
              扫码预约
            </button>
            {bookBlockedReason ? (
              <span id={`fair-book-blocked-${fair.id}`} className="qxfw-blocked">{bookBlockedReason}</span>
            ) : null}
          </>
        )}
        <button
          type="button"
          className="qx-btn"
          data-variant="primary"
          aria-label={`查看 ${fair.name} 详情`}
          onClick={onDetail}
        >
          查看详情
        </button>
      </div>
    </article>
  )
}

/**
 * 来源平台预约二维码（稿 checkin:qr 的 .qr-placeholder 在真实页里换成真二维码）。
 * 本机不代预约，也拿不到预约结果——这句话必须和二维码同屏。
 *
 * 调用方必须先过 evaluateJobSourceTrust：要素不全的场次不允许走到这里。
 */
export function FairBookingQr({ fair, onClose }: { fair: ExternalJobFairDTO; onClose: () => void }) {
  return (
    <FairQrOverlay
      title="扫码前往来源平台预约"
      subtitle={fair.name}
      value={fair.sourceUrl}
      meta={[
        { label: '来源机构', value: fair.sourceName },
        { label: '外部编号', value: fair.externalId },
      ]}
      note="请使用手机扫码前往来源平台办理预约，预约由对方平台管理，本系统不参与活动报名流程、不接收简历。"
      onClose={onClose}
    />
  )
}

export function FairQrOverlay({
  title,
  subtitle,
  value,
  meta,
  note,
  onClose,
}: {
  title: string
  subtitle?: string
  value: string | undefined | null
  meta?: { label: string; value: string }[]
  note: string
  onClose: () => void
}) {
  return (
    <div className="qxfw-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="qxfw-overlay-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="qxfw-overlay-close" onClick={onClose} aria-label="关闭">
          <XIcon size={26} aria-hidden />
        </button>
        <p className="qxfw-overlay-t">{title}</p>
        {subtitle ? <p className="qxfw-overlay-sub">{subtitle}</p> : null}
        <div className="qxfw-overlay-qr" data-testid="fair-qr-slot">
          <SourceUrlQr value={value} size={320} />
        </div>
        {meta && meta.length > 0 ? (
          <div className="dw-kv">
            {meta.map((m) => (
              <div key={m.label}><span>{m.label}</span><b>{m.value}</b></div>
            ))}
          </div>
        ) : null}
        <p className="qxfw-overlay-note"><ExternalLinkIcon size={20} aria-hidden />{note}</p>
      </div>
    </div>
  )
}

/** 骨架行（稿 skel）。只表达「整体在等」，不画阶段进度，也不预估剩余时间。 */
export function FairSkeletonList({ rows }: { rows: number }) {
  return (
    <div className="qxfw-skel" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="qxfw-skel-row">
          <span className="qxfw-skel-line" style={{ width: `${44 + i * 4}%` }} />
          <span className="qxfw-skel-line" style={{ width: `${64 - i * 3}%` }} />
          <span className="qxfw-skel-line" style={{ width: `${38 + i * 2}%` }} />
        </div>
      ))}
    </div>
  )
}

/** 稿 .rows/.row：可点的一行出口。行高与触控目标由 dw-row 保证。 */
export function FairRowLink({
  icon,
  title,
  desc,
  onClick,
  testId,
  right,
}: {
  icon: ReactNode
  title: string
  desc: string
  onClick: () => void
  testId?: string
  right?: ReactNode
}) {
  return (
    <button type="button" className="dw-row solid" onClick={onClick} data-testid={testId}>
      <span className="dw-row-ic slate">{icon}</span>
      <span className="dw-row-main">
        <span className="dw-row-t">{title}</span>
        <span className="dw-row-sub"><span>{desc}</span></span>
      </span>
      {right ?? <span className="dw-row-go" aria-hidden>›</span>}
    </button>
  )
}
