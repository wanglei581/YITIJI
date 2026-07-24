import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { EmptyState, LoadingState } from '@ai-job-print/ui'
import type { FairLiveStatsDTO } from '@ai-job-print/shared'
import {
  ActivityIcon,
  BriefcaseIcon,
  BuildingIcon,
  PrinterIcon,
  QrCodeIcon,
  ScanIcon,
  TrendingUpIcon,
  UsersIcon,
} from 'lucide-react'
import { getFairStats } from '../../services/api'
import { FusionBadge, FusionNotice, FusionSectionHead, KioskPageFrame } from '../jobs/components/W4Presentation'

function BigStat({
  label,
  value,
  note,
  icon: Icon,
  accent,
}: {
  label: string
  value: string | number
  note?: string
  icon: React.ElementType
  accent: string
}) {
  void accent
  return (
    <div className="jf-stat-card">
      <div className="k">
        <Icon aria-hidden="true" />
        {label}
      </div>
      <div className="v">{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  )
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

  if (loading) {
    return <LoadingState className="h-full" />
  }

  if (error || !stats) {
    return <EmptyState icon={ActivityIcon} title="暂无真实统计数据" className="h-full" />
  }

  if (stats.isMockData) {
    return (
      <EmptyState
        icon={ActivityIcon}
        title="真实数据正在接入"
        description="该招聘会暂未接入真实来源统计，商用模式不会展示模拟数据"
        className="h-full"
      />
    )
  }

  const checkinRate = stats.totalCompanies > 0
    ? Math.round((stats.checkedInCompanies / stats.totalCompanies) * 100)
    : 0

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <KioskPageFrame
      tone="wheat"
      title="现场数据"
      subtitle={`${stats.fairName} · 更新于 ${formatTime(stats.lastUpdated)}`}
      backLabel="返回详情"
      onBack={() => navigate(`/job-fairs/${fairId}`)}
      badge={<FusionBadge icon={ActivityIcon}>准实时数据</FusionBadge>}
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
        <div className="jf-stat-grid">
          <BigStat
            label="参展企业"
            value={stats.totalCompanies}
            note={`已签到 ${stats.checkedInCompanies} 家 · 主办方同步`}
            icon={BuildingIcon}
            accent="bg-primary-50 text-primary-600"
          />
          <BigStat
            label="招聘岗位"
            value={stats.totalPositions}
            note={`计划招聘 ${stats.totalHeadcount.toLocaleString()} 人 · 主办方提供`}
            icon={BriefcaseIcon}
            accent="bg-success-bg text-success-fg"
          />
        </div>

        <section className="jf-card accented">
          <FusionSectionHead icon={TrendingUpIcon} title="服务数据统计" subtitle="本终端服务行为统计 · 不含求职者个人信息" />
          <div className="jf-service4">
            <div className="jf-sv">
              <ScanIcon aria-hidden="true" />
              <b>{stats.browseCount}</b>
              <span>信息浏览</span>
            </div>
            <div className="jf-sv">
              <QrCodeIcon aria-hidden="true" />
              <b>{stats.scanCount}</b>
              <span>二维码展示</span>
            </div>
            <div className="jf-sv">
              <PrinterIcon aria-hidden="true" />
              <b>{stats.printCount}</b>
              <span>资料打印</span>
            </div>
            <div className="jf-sv">
              <UsersIcon aria-hidden="true" />
              <b>{stats.checkinCount}</b>
              <span>外部跳转</span>
            </div>
          </div>
        </section>

        <section className="jf-card">
          <div className="mb-4 flex items-center justify-between">
            <div className="jf-card-head mb-0">
              <span className="jf-g-icon">
                <BuildingIcon aria-hidden="true" />
              </span>
              <div>
                <h2>企业签到进度</h2>
                <div className="sub">{stats.checkedInCompanies} / {stats.totalCompanies} 家企业已签到入场</div>
              </div>
            </div>
            <span className="text-[32px] font-bold text-[var(--teal-deep)]">{checkinRate}%</span>
          </div>
          <div className="jf-progress">
            <div className="jf-progress-fill" style={{ width: `${checkinRate}%` }} />
          </div>

          {stats.zoneBreakdown.length > 0 && (
            <div className="jf-zone-rows mt-5">
              {stats.zoneBreakdown.map((zone) => {
                const rate = zone.boothCount > 0
                  ? Math.round((zone.checkedInCount / zone.boothCount) * 100)
                  : 0
                return (
                  <div key={zone.id} className="jf-zone-row">
                    <span>{zone.zoneName}</span>
                    <div className="jf-progress">
                      <div className="jf-progress-fill" style={{ width: `${rate}%` }} />
                    </div>
                    <span className="n">{zone.checkedInCount}/{zone.boothCount}</span>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* 参展企业行业分布（真实聚合已录企业，柱状图；无数据不渲染，不伪造） */}
        {stats.industryDistribution.length > 0 && (
          <section className="jf-card">
            <FusionSectionHead icon={BuildingIcon} title="参展企业行业分布" subtitle={`按已录 ${stats.totalCompanies} 家企业聚合`} />
            <div className="jf-bar-rows">
              {(() => {
                const maxCount = Math.max(...stats.industryDistribution.map((slice) => slice.count), 1)
                return stats.industryDistribution.map((slice) => (
                  <div key={slice.label} className="jf-bar-row">
                    <span>{slice.label}</span>
                    <div className="jf-progress">
                      <div className="jf-progress-fill" style={{ width: `${Math.round((slice.count / maxCount) * 100)}%` }} />
                    </div>
                    <span className="n">{slice.count} 家</span>
                  </div>
                ))
              })()}
            </div>
          </section>
        )}

        {/* 求职意向分布（机构录入预计值，横向占比；标注来源口径，非实时） */}
        {stats.seekerIntent.length > 0 && (
          <section className="jf-card">
            <FusionSectionHead
              icon={UsersIcon}
              title="求职意向分布"
              subtitle={`${stats.dataSourceLabel}${stats.expectedAttendance != null ? ` · 预计参会 ${stats.expectedAttendance.toLocaleString()} 人` : ''}`}
            />
            <div className="jf-bar-rows">
              {stats.seekerIntent.map((slice) => (
                <div key={slice.label} className="jf-bar-row">
                  <span>{slice.label}</span>
                  <div className="jf-progress">
                    <div className="jf-progress-fill" style={{ width: `${Math.max(0, Math.min(100, slice.percent))}%` }} />
                  </div>
                  <span className="n">{slice.percent}%</span>
                </div>
              ))}
            </div>
          </section>
        )}

      <FusionNotice>系统仅记录服务数据，不记录求职者个人信息；活动办理结果以来源平台和现场为准。</FusionNotice>
    </KioskPageFrame>
  )
}
