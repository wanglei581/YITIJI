import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { FairLiveStatsDTO } from '@ai-job-print/shared'
import {
  ActivityIcon,
  AlertTriangleIcon,
  BuildingIcon,
  PrinterIcon,
  QrCodeIcon,
  ScanIcon,
  UsersIcon,
} from 'lucide-react'
import { getFairStats } from '../../services/api'
import {
  QxFairCta,
  QxFairNavRow,
  QxFairShell,
  QxFairSkel,
  QxFairState,
} from './qx/qxFairChrome'

function formatMetric(value: number): string {
  return value.toLocaleString()
}

export function FairStatsPage() {
  const navigate = useNavigate()
  const { id }   = useParams<{ id: string }>()
  const fairId   = id ?? ''

  const [stats,   setStats]   = useState<FairLiveStatsDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    let cancelled = false
    getFairStats(fairId)
      .then((res) => {
        if (cancelled) return
        if (res.data) setStats(res.data)
        else setError(true)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId])

  const empty = !loading && (error || !stats || stats.isMockData)
  const viewState = loading ? 'loading' : empty ? (error ? 'error' : 'empty') : 'ready'
  const pill = viewState === 'ready'
    ? { tone: 'ok' as const, label: '数值由主办方回传' }
    : viewState === 'error'
      ? { tone: 'bad' as const, label: '统计数据没取到' }
      : viewState === 'empty'
        ? { tone: 'unknown' as const, label: '主办方还没有回传统计' }
        : { tone: 'unknown' as const, label: '正在取统计' }

  if (loading) {
    return (
      <QxFairShell
        title="现场统计"
        subtitle="数值由主办方回传，本机不估算、不推算。"
        status={pill}
        screen="stats"
      fairId={fairId}
        state="loading"
        ctabar={<QxFairCta variant="primary" testId="stats-primary" onClick={() => navigate(`/job-fairs/${fairId}`)}>返回招聘会</QxFairCta>}
      >
        <QxFairSkel rows={2} />
      </QxFairShell>
    )
  }

  if (error || !stats) {
    return (
      <QxFairShell
        title="现场统计"
        subtitle="数值由主办方回传，本机不估算、不推算。"
        status={pill}
        screen="stats"
        state="error"
        ctabar={
          <>
            <QxFairCta onClick={() => navigate(`/job-fairs/${fairId}`)}>返回招聘会</QxFairCta>
            <QxFairCta variant="primary" testId="stats-primary" onClick={() => navigate(`/job-fairs/${fairId}/stats`)}>
              重新加载
            </QxFairCta>
          </>
        }
      >
        <QxFairState screen="stats" tone="error" icon={AlertTriangleIcon} title="统计数据没取到">
          请求失败。本机<b>不显示上一次的数字</b>——统计一旦过时就会误导人。
        </QxFairState>
        <div className="qx-rows">
          <QxFairNavRow icon={BuildingIcon} title="看参展名单" description="名单是另一个接口，可能还能打开。" onClick={() => navigate(`/job-fairs/${fairId}/companies`)} testId="stats-companies" />
        </div>
      </QxFairShell>
    )
  }

  if (stats.isMockData) {
    return (
      <QxFairShell
        title="现场统计"
        subtitle="数值由主办方回传，本机不估算、不推算。"
        status={pill}
        screen="stats"
        state="empty"
        ctabar={
          <QxFairCta variant="primary" testId="stats-primary" onClick={() => navigate(`/job-fairs/${fairId}`)}>
            返回招聘会
          </QxFairCta>
        }
      >
        <QxFairState screen="stats" tone="empty" icon={ActivityIcon} title="真实数据正在接入">
          该招聘会暂未接入真实来源统计，商用模式不会展示模拟数据。统计通常在活动结束后才汇总。<b>没有数据就空着</b>，本机不按签到人数或名单条数替主办方算一个。
        </QxFairState>
        <div className="qx-rows">
          <QxFairNavRow icon={BuildingIcon} title="看参展名单" description="数字背后的单位清单在这里。" onClick={() => navigate(`/job-fairs/${fairId}/companies`)} testId="stats-companies-empty" />
        </div>
      </QxFairShell>
    )
  }

  const {
    checkedInCompanies,
    browseCount,
    scanCount,
    printCount,
    checkinCount,
    dataSourceLabel,
  } = stats

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  const companyNote = checkedInCompanies != null
    ? `已签到 ${checkedInCompanies} 家 · ${dataSourceLabel}`
    : dataSourceLabel

  const hasServiceStats =
    browseCount != null
    || scanCount != null
    || printCount != null
    || checkinCount != null

  return (
    <QxFairShell
      title="现场统计"
      subtitle={`${stats.fairName} · ${dataSourceLabel}`}
      status={{ tone: 'ok', label: dataSourceLabel }}
      screen="stats"
      state="ready"
      ctabar={
        <QxFairCta variant="primary" testId="stats-primary" onClick={() => navigate(`/job-fairs/${fairId}`)}>
          返回招聘会
        </QxFairCta>
      }
    >
      <div className="qx-sec-h"><span className="t">现场统计</span><span className="hint">由主办方回传，数值不由本机估算</span></div>
      <div className="qx-fair-stat-grid">
        <div className="qx-fair-tile">
          <span className="qx-fair-tile-l">参展单位</span>
          <span className="qx-fair-tile-v">{stats.totalCompanies}</span>
          <span className="qx-fair-tile-m">{companyNote}</span>
        </div>
        <div className="qx-fair-tile">
          <span className="qx-fair-tile-l">提供岗位</span>
          <span className="qx-fair-tile-v">{stats.totalPositions}</span>
          <span className="qx-fair-tile-m">计划招聘 {stats.totalHeadcount.toLocaleString()} 人 · {dataSourceLabel}</span>
        </div>
        <div className="qx-fair-tile">
          <span className="qx-fair-tile-l">到场人次</span>
          <span className="qx-fair-tile-v">{checkinCount != null ? formatMetric(checkinCount) : '—'}</span>
          <span className="qx-fair-tile-m">主办方统计口径</span>
        </div>
      </div>

      {hasServiceStats ? (
        <section className="qx-card">
          <div className="qx-fair-blk-h">服务数据统计<span className="hint">本终端可证明的服务行为 · 不含求职者个人信息</span></div>
          <div className="qx-fair-stat-grid">
            {browseCount != null && (
              <div className="qx-fair-tile"><ScanIcon aria-hidden /><span className="qx-fair-tile-v">{formatMetric(browseCount)}</span><span className="qx-fair-tile-m">信息浏览</span></div>
            )}
            {scanCount != null && (
              <div className="qx-fair-tile"><QrCodeIcon aria-hidden /><span className="qx-fair-tile-v">{formatMetric(scanCount)}</span><span className="qx-fair-tile-m">二维码展示</span></div>
            )}
            {printCount != null && (
              <div className="qx-fair-tile"><PrinterIcon aria-hidden /><span className="qx-fair-tile-v">{formatMetric(printCount)}</span><span className="qx-fair-tile-m">资料打印</span></div>
            )}
            {checkinCount != null && (
              <div className="qx-fair-tile"><UsersIcon aria-hidden /><span className="qx-fair-tile-v">{formatMetric(checkinCount)}</span><span className="qx-fair-tile-m">现场签到</span></div>
            )}
          </div>
        </section>
      ) : (
        <section className="qx-card">
          <div className="qx-fair-blk-h">服务数据统计</div>
          <p className="qx-fair-local-note">暂无统计 · 未接入可证明的服务数据源</p>
        </section>
      )}

      {checkedInCompanies != null && stats.totalCompanies > 0 && (
        <section className="qx-card">
          <div className="qx-fair-blk-h">企业签到进度<span className="hint">{checkedInCompanies} / {stats.totalCompanies} 家企业已签到入场</span></div>
          <div className="qx-fair-progress">
            <span style={{ width: `${Math.round((checkedInCompanies / stats.totalCompanies) * 100)}%` }} />
          </div>
          {stats.zoneBreakdown.length > 0 ? (
            <div className="qx-fair-list" style={{ marginTop: 16 }}>
              {stats.zoneBreakdown.map((zone) => {
                const rate = zone.boothCount > 0
                  ? Math.round((zone.checkedInCount / zone.boothCount) * 100)
                  : 0
                return (
                  <div key={zone.id} className="qx-fair-tile">
                    <span className="qx-fair-tile-l">{zone.zoneName}</span>
                    <div className="qx-fair-progress"><span style={{ width: `${rate}%` }} /></div>
                    <span className="qx-fair-tile-m">{zone.checkedInCount}/{zone.boothCount}</span>
                  </div>
                )
              })}
            </div>
          ) : null}
        </section>
      )}

      {stats.industryDistribution.length > 0 && (
        <section className="qx-card">
          <div className="qx-fair-blk-h">参展企业行业分布<span className="hint">按已录 {stats.totalCompanies} 家企业聚合 · {dataSourceLabel}</span></div>
          {(() => {
            const maxCount = Math.max(...stats.industryDistribution.map((slice) => slice.count), 1)
            return stats.industryDistribution.map((slice) => (
              <div key={slice.label} className="qx-fair-tile">
                <span className="qx-fair-tile-l">{slice.label}</span>
                <div className="qx-fair-progress"><span style={{ width: `${Math.round((slice.count / maxCount) * 100)}%` }} /></div>
                <span className="qx-fair-tile-m">{slice.count} 家</span>
              </div>
            ))
          })()}
        </section>
      )}

      {stats.seekerIntent.length > 0 && (
        <section className="qx-card">
          <div className="qx-fair-blk-h">
            求职意向分布
            <span className="hint">{dataSourceLabel}{stats.expectedAttendance != null ? ` · 预计参会 ${stats.expectedAttendance.toLocaleString()} 人` : ''}</span>
          </div>
          {stats.seekerIntent.map((slice) => (
            <div key={slice.label} className="qx-fair-tile">
              <span className="qx-fair-tile-l">{slice.label}</span>
              <div className="qx-fair-progress"><span style={{ width: `${Math.max(0, Math.min(100, slice.percent))}%` }} /></div>
              <span className="qx-fair-tile-m">{slice.percent}%</span>
            </div>
          ))}
        </section>
      )}

      <p className="qx-fair-local-note">
        {dataSourceLabel}；系统仅记录可证明的服务行为，不记录求职者个人信息；活动办理结果以来源平台和现场为准。
        {stats.lastUpdated ? ` 数据同步时间 ${formatTime(stats.lastUpdated)}。` : ''}
      </p>
    </QxFairShell>
  )
}
