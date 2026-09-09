import { useEffect, useState } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { formatDateTime, type ExternalJobFairDTO, type FairLiveStatsDTO } from '@ai-job-print/shared'
import {
  AlertTriangleIcon,
  BarChart3Icon,
  BuildingIcon,
  CalendarIcon,
  FileTextIcon,
  LockIcon,
  MapIcon,
  NavigationIcon,
  SparklesIcon,
} from 'lucide-react'
import { getFairStats, getJobFairById } from '../../services/api'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { buildNavUrl } from '../../lib/url'
import { useFavorites } from '../../favorites/useFavorites'
import { useAuth } from '../../auth/useAuth'
import { evaluateJobSourceTrust } from '../jobs/utils/sourceTrust'
import {
  QxFairCta,
  QxFairNavRow,
  QxFairNotice,
  QxFairQrDialog,
  QxFairShell,
  QxFairSkel,
  QxFairSourceCard,
  QxFairState,
  type QxCtaLabel,
} from './qx/qxFairChrome'

// verify marker: getFairVenueGuide

const BOOK_LABEL: QxCtaLabel = '去来源平台预约'
const SCAN_BOOK: QxCtaLabel = '扫码预约'

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
  const [stats, setStats] = useState<FairLiveStatsDTO | null>(null)

  const { isFavorite, toggle: toggleFavorite } = useFavorites()
  const isFav = id ? isFavorite('job_fair', id) : false
  const { getToken } = useAuth()

  useEffect(() => {
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

  useEffect(() => {
    if (!fair) return
    let cancelled = false
    getFairStats(fair.id).then((r) => { if (!cancelled) setStats(r.data) }).catch(() => { if (!cancelled) setStats(null) })
    return () => { cancelled = true }
  }, [fair])

  useEffect(() => {
    if (fair?.id) recordBrowse(getToken(), 'job_fair', fair.id)
  }, [fair?.id, getToken])

  const openBookingQr = () => {
    if (fair && evaluateJobSourceTrust(fair).ok) {
      recordExternalJump(getToken(), 'job_fair', fair.id, 'external_appointment')
    }
    setQr({ kind: 'book' })
  }

  const openCheckinQr = () => {
    if (
      fair &&
      evaluateJobSourceTrust({
        sourceName: fair.sourceName,
        syncTime: fair.syncTime,
        externalId: fair.externalId,
        sourceUrl: fair.checkinUrl,
      }).ok
    ) {
      recordExternalJump(getToken(), 'job_fair', fair.id, 'external_checkin_open')
    }
    setQr({ kind: 'checkin' })
  }

  const unpublished = Boolean(fair && (fair.publishStatus === 'unpublished' || fair.publishStatus === 'draft'))
  const isEnded = fair?.status === 'ended'
  const statsReady = Boolean(stats && !stats.isMockData)
  const navUrl = fair
    ? buildNavUrl({ latitude: fair.latitude, longitude: fair.longitude, venue: fair.venue, address: fair.address })
    : null

  const viewState = loading
    ? 'loading'
    : error || !fair
      ? 'error'
      : unpublished
        ? 'unpublished'
        : isEnded
          ? 'ended'
          : 'detail'
  const pill = viewState === 'detail'
    ? { tone: 'ok' as const, label: '场次与参展名单由主办方发布' }
    : viewState === 'ended'
      ? { tone: 'warn' as const, label: '这场已经结束' }
      : viewState === 'unpublished'
        ? { tone: 'bad' as const, label: '已被来源方下架' }
        : viewState === 'error'
          ? { tone: 'bad' as const, label: '详情这次没取到' }
          : { tone: 'unknown' as const, label: '正在取这场的详情' }

  return (
    <QxFairShell
      title="招聘会详情"
      subtitle="时间、地点与来源三要素由主办方发布，本机不代预约。"
      status={pill}
      screen="detail"
      fairId={id}
      state={viewState}
      ctabar={
        viewState === 'detail' && fair ? (
          <>
            {fair.checkinUrl ? <QxFairCta onClick={openCheckinQr}>到场指引</QxFairCta> : (
              <QxFairCta onClick={() => navigate('/job-fairs/checkin')}>到场指引</QxFairCta>
            )}
            <QxFairCta variant="primary" testId="detail-primary" onClick={openBookingQr}>
              {evaluateJobSourceTrust(fair).ok ? BOOK_LABEL : SCAN_BOOK}
            </QxFairCta>
          </>
        ) : viewState === 'ended' ? (
          <QxFairCta variant="primary" testId="detail-primary" onClick={() => navigate('/job-fairs')}>
            看还在进行的场次
          </QxFairCta>
        ) : viewState === 'loading' ? (
          <QxFairCta variant="primary" testId="detail-primary" onClick={() => navigate('/job-fairs')}>
            返回场次列表
          </QxFairCta>
        ) : (
          <>
            <QxFairCta onClick={() => navigate('/help')}>找工作人员</QxFairCta>
            <QxFairCta variant="primary" testId="detail-primary" onClick={() => viewState === 'error' ? setRetryKey((k) => k + 1) : navigate('/job-fairs')}>
              {viewState === 'error' ? '重新加载' : '回场次列表'}
            </QxFairCta>
          </>
        )
      }
    >
      {viewState === 'loading' ? (
        <>
          <QxFairSkel rows={2} />
          <p className="qx-fair-local-note">正在取这场的详情与来源三要素。字段返回前不展示任何内容。</p>
        </>
      ) : viewState === 'error' ? (
        <>
          <QxFairState screen="detail" tone="error" icon={AlertTriangleIcon} title="这场的详情没取到">
            请求失败。本机<b>不拿列表里的片段拼一个详情页</b>给你，时间地点错了会让人白跑。
          </QxFairState>
          <div className="qx-rows">
            <QxFairNavRow icon={CalendarIcon} title="回场次列表" description="列表还能打开，可以先看别的场次。" onClick={() => navigate('/job-fairs')} testId="detail-back" />
            <QxFairNavRow icon={MapIcon} title="到场指引" description="通用指引不依赖这场的详情接口。" onClick={() => navigate('/job-fairs/checkin')} testId="detail-checkin" />
          </div>
        </>
      ) : viewState === 'unpublished' ? (
        <>
          <QxFairState screen="detail" tone="info" icon={LockIcon} title="这场已经被来源方下架">
            主办方或管理员把这条信息取消发布了。本机<b>不保留下架内容的副本</b>，也不展示缓存的时间地点。
          </QxFairState>
          <div className="qx-rows">
            <QxFairNavRow icon={BuildingIcon} title="岗位信息" description="按岗位继续找，来源与有效期照样标注。" onClick={() => navigate('/jobs')} testId="detail-jobs" />
            <QxFairNavRow icon={BuildingIcon} title="企业目录" description="按用人单位查看在招岗位。" onClick={() => navigate('/companies')} testId="detail-companies-dir" />
          </div>
        </>
      ) : fair ? (
        <>
          <section className="qx-card">
            <h2 className="qx-fair-hero-t">
              {fair.name}
              <span className={`qx-fair-tag ${isEnded ? 'warn' : 'teal'}`}>{isEnded ? '已结束' : fair.status === 'ongoing' ? '进行中' : '即将开始'}</span>
            </h2>
            <div className="qx-fair-hero-meta">
              <span>主办方 {fair.organizer}</span>
              <span>举办时间 {formatDateTime(fair.startTime, { fallback: fair.startTime })} — {formatDateTime(fair.endTime, { fallback: fair.endTime })}</span>
              <span>举办地点 {fair.city ? `${fair.city} · ` : ''}{fair.venue}</span>
            </div>
            <button
              type="button"
              className="qx-fair-mini"
              style={{ marginTop: 16 }}
              onClick={() => toggleFavorite({ type: 'job_fair', id: fair.id, title: fair.name })}
              aria-pressed={isFav}
            >
              {isFav ? '已收藏' : '收藏场次'}
            </button>
            {navUrl ? (
              <button type="button" className="qx-fair-mini" style={{ marginTop: 10 }} onClick={() => setQr({ kind: 'nav', url: navUrl })}>
                <NavigationIcon size={18} aria-hidden />
                扫码在手机上导航
              </button>
            ) : null}
          </section>
          {isEnded ? (
            <QxFairState screen="detail" tone="info" icon={CalendarIcon} title="这场招聘会已经结束">
              举办时间已经过去，所以<b>不再提供预约入口</b>。参展名单与物料如果主办方仍然保留，可以继续查看。
            </QxFairState>
          ) : null}
          <QxFairSourceCard sourceName={fair.sourceName} syncTime={fair.syncTime} externalId={fair.externalId} />
          <section>
            <div className="qx-sec-h"><span className="t">这场招聘会里可以做的</span><span className="hint">每一项各自核验数据，缺数据就诚实空着</span></div>
            <div className="qx-rows" style={{ marginTop: 12 }}>
              <QxFairNavRow icon={BuildingIcon} title="参展企业名单" description="主办方提供的名单，可看展位号并进入企业详情。" onClick={() => navigate(`/job-fairs/${fair.id}/companies`)} testId="detail-companies" />
              <QxFairNavRow icon={MapIcon} title="展位分布" description="主办方提供展位图或展位索引时在这里查看。" onClick={() => navigate(`/job-fairs/${fair.id}/map`)} testId="detail-map" />
              <QxFairNavRow icon={FileTextIcon} title="活动物料" description="名单、手册与指引，可现场打印带走。" onClick={() => navigate(`/job-fairs/${fair.id}/materials`)} testId="detail-materials" />
              <QxFairNavRow
                icon={SparklesIcon}
                title={isEnded ? 'AI参会回顾' : 'AI 参会准备清单'}
                description={isEnded ? '基于本人简历梳理后续跟进' : '需要你确认本人简历；不排路线、不承诺结果。'}
                onClick={() => navigate(`/job-fairs/${fair.id}/visit-plan`)}
                testId="detail-plan"
              />
              <QxFairNavRow
                icon={BarChart3Icon}
                title="现场统计"
                description={statsReady ? '主办方回传统计' : '暂无真实统计'}
                onClick={() => navigate(`/job-fairs/${fair.id}/stats`)}
                testId="detail-stats"
              />
            </div>
          </section>
          <QxFairNotice />
        </>
      ) : null}

      {qr?.kind === 'book' && fair ? (
        <QxFairQrDialog
          title={SCAN_BOOK}
          subtitle={fair.name}
          value={fair.sourceUrl}
          meta={[{ label: '来源机构', value: fair.sourceName }, { label: '外部编号', value: fair.externalId }]}
          note="请使用手机扫码前往来源平台办理预约，预约由对方平台管理，本系统不参与活动报名流程、不接收简历。"
          onClose={() => setQr(null)}
        />
      ) : null}
      {qr?.kind === 'checkin' && fair ? (
        <QxFairQrDialog
          title="扫码前往来源平台签到"
          subtitle={fair.name}
          value={fair.checkinUrl}
          meta={[{ label: '来源机构', value: fair.sourceName }, { label: '外部编号', value: fair.externalId }]}
          note="请使用手机扫码前往来源平台签到。本系统不记录签到结果，不参与现场入场办理。"
          onClose={() => setQr(null)}
        />
      ) : null}
      {qr?.kind === 'nav' ? (
        <QxFairQrDialog
          title="扫码在手机上导航"
          subtitle={fair?.venue}
          value={qr.url}
          note="请使用手机扫码，在手机地图中打开场馆位置并开始导航。"
          onClose={() => setQr(null)}
        />
      ) : null}
    </QxFairShell>
  )
}
