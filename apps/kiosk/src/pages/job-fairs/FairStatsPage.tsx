// /job-fairs/:id/stats —— 现场统计（稿 28-jobfair-enhanced.html，screen=stats / 093）。
//
// 状态与稿同名：ready | empty | error。
// 稿原话：「全部来自主办方回传的统计接口。本机不做人流统计、不接摄像头、
// 也不按签到推算——没有回传就显示为空，不会拿估算值补上。」
//
// 可空字段（checkedInCompanies / browseCount / scanCount / printCount / checkinCount）
// 一律先过显式 != null 分支再渲染：null 是「未接入」，不是 0。两者对用户完全不同。
// isMockData 为真时整页降级为空态——商用模式不展示模拟统计。

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { FairLiveStatsDTO } from '@ai-job-print/shared'
import {
  BuildingIcon,
  FileTextIcon,
  InfoIcon,
  PrinterIcon,
  QrCodeIcon,
  ScanIcon,
  UsersIcon,
} from 'lucide-react'
import { getFairStats } from '../../services/api'
import { QxFairWorkbench } from './QxFairWorkbench'
import { FairSkeletonList } from './components/FairWorkbenchBits'
import { fmtFairTime } from './fairFormat'
import {
  DirKv,
  DirNote,
  DirState,
  DirStrip,
  DirStripItem,
  DirTiles,
} from '../../components/qingxu/directory/DirectoryBits'

function formatMetric(value: number): string {
  return value.toLocaleString()
}

/**
 * 更新时间按 **Asia/Shanghai** 墙钟显示。
 *
 * 原实现用 `new Date(iso).getHours()`，取的是**浏览器所在时区**的小时。一体机现场
 * 恒为 Asia/Shanghai，看不出差别；但同一页在手机与桌面浏览器上也开放，时区一变
 * 「主办方 10:00 回传的统计」就会显示成别的钟点，而这一页正在宣称自己不加工数值。
 * 全域时间口径统一走 fairFormat（内部是 shared/formatDateTime 的 Asia/Shanghai 渲染）。
 */
function formatClock(iso: string): string {
  return fmtFairTime(iso)
}

export function FairStatsPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const fairId = id ?? ''

  const [stats, setStats] = useState<FairLiveStatsDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getFairStats(fairId)
      .then((res) => {
        if (cancelled) return
        if (res.data) setStats(res.data)
        else setStats(null)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId, retryKey])

  const mockOnly = Boolean(stats?.isMockData)
  const uiState = loading ? 'ready' : error ? 'error' : !stats || mockOnly ? 'empty' : 'ready'

  const ctabar = uiState === 'error'
    ? (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate(`/job-fairs/${fairId}`)}>返回招聘会</button>
        <button type="button" className="qx-btn" data-variant="primary" onClick={() => setRetryKey((k) => k + 1)}>重新加载</button>
      </>
    )
    : uiState === 'empty'
      ? (
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>看参展名单</button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate(`/job-fairs/${fairId}`)}>返回招聘会</button>
        </>
      )
      : (
        <>
          <p className="why">数值由主办方回传，本机不估算、不推算。</p>
          <button type="button" className="qx-btn narrow" data-variant="primary" onClick={() => navigate(`/job-fairs/${fairId}`)}>返回招聘会</button>
        </>
      )

  if (loading) {
    return (
      <QxFairWorkbench screen="stats" state="ready" fairId={fairId}>
        <div className="dw-sec-h"><span className="t">正在取主办方回传的统计</span><span className="hint">未返回前不显示任何数字</span></div>
        <FairSkeletonList rows={2} />
      </QxFairWorkbench>
    )
  }

  if (error) {
    return (
      <QxFairWorkbench screen="stats" state="error" fairId={fairId} ctabar={ctabar}>
        <DirState tone="error" testId="fair-stats-error" title="统计数据没取到">
          请求失败。本机<b>不显示上一次的数字</b>——统计一旦过时就会误导人。
        </DirState>
        <DirStrip>
          <DirStripItem icon={UsersIcon} title="看参展名单" desc="名单是另一个接口，可能还能打开" onClick={() => navigate(`/job-fairs/${fairId}/companies`)} />
          <DirStripItem icon={InfoIcon} tone="slate" title="找工作人员" desc="需要官方数据可以到服务台咨询" onClick={() => navigate('/help')} />
        </DirStrip>
      </QxFairWorkbench>
    )
  }

  if (!stats || mockOnly) {
    return (
      <QxFairWorkbench screen="stats" state="empty" fairId={fairId} ctabar={ctabar}>
        <DirState
          tone="empty"
          testId="fair-stats-empty"
          title={mockOnly ? '真实数据正在接入' : '主办方还没有回传统计'}
        >
          {mockOnly
            ? '该招聘会暂未接入真实来源统计，商用模式不会展示模拟数据。'
            : '统计通常在活动结束后才汇总。'}
          <b>没有数据就空着</b>，本机不按签到人数或名单条数替主办方算一个。
        </DirState>
        <DirStrip>
          <DirStripItem icon={FileTextIcon} title="看活动物料" desc="手册里有时会带官方的总结数据" onClick={() => navigate(`/job-fairs/${fairId}/materials`)} />
          <DirStripItem icon={UsersIcon} tone="wheat" title="看参展名单" desc="数字背后的单位清单在这里" onClick={() => navigate(`/job-fairs/${fairId}/companies`)} />
        </DirStrip>
      </QxFairWorkbench>
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

  const hasServiceStats =
    browseCount != null
    || scanCount != null
    || printCount != null
    || checkinCount != null

  const maxIndustry = stats.industryDistribution.length > 0
    ? Math.max(...stats.industryDistribution.map((slice) => slice.count), 1)
    : 1

  return (
    <QxFairWorkbench
      screen="stats"
      state="ready"
      fairId={fairId}
      subtitle={`${stats.fairName} · ${dataSourceLabel}`}
      ctabar={ctabar}
    >
      <div className="dw-sec-h"><span className="t">现场统计</span><span className="hint">由主办方回传，数值不由本机估算</span></div>
      <DirTiles items={[
        { label: '参展单位', value: formatMetric(stats.totalCompanies), accent: true },
        { label: '提供岗位', value: formatMetric(stats.totalPositions) },
        { label: '计划招聘', value: `${formatMetric(stats.totalHeadcount)} 人` },
        {
          label: '主办方预计参会',
          value: stats.expectedAttendance != null ? `${formatMetric(stats.expectedAttendance)} 人` : '未回传',
        },
      ]} />

      <section className="dw-blk">
        <div className="dw-sec-h"><span className="t">这些数字是怎么来的</span></div>
        <p className="dw-ai-d">
          全部来自<b>主办方回传的统计接口</b>。本机不做人流统计、不接摄像头、也不按签到推算——没有回传就显示为空，不会拿估算值补上。
        </p>
        <DirKv rows={[
          ['数据来源', dataSourceLabel],
          ['统计口径', '主办方回传口径；本机不重新计算'],
          ['更新时间', stats.lastUpdated ? formatClock(stats.lastUpdated) : '主办方未回传更新时间'],
        ]} />
      </section>

      <section className="dw-blk">
        <div className="dw-sec-h">
          <span className="t">本终端服务行为</span>
          <span className="hint">不含求职者个人信息</span>
        </div>
        {hasServiceStats ? (
          <DirTiles items={[
            ...(browseCount != null ? [{ label: '信息浏览', value: <><ScanIcon size={20} aria-hidden /> {formatMetric(browseCount)}</> }] : []),
            ...(scanCount != null ? [{ label: '二维码展示', value: <><QrCodeIcon size={20} aria-hidden /> {formatMetric(scanCount)}</> }] : []),
            ...(printCount != null ? [{ label: '资料打印', value: <><PrinterIcon size={20} aria-hidden /> {formatMetric(printCount)}</> }] : []),
            ...(checkinCount != null ? [{ label: '现场签到', value: <><UsersIcon size={20} aria-hidden /> {formatMetric(checkinCount)}</> }] : []),
          ]} />
        ) : (
          <p className="dw-why">暂无统计 · 未接入可证明的服务数据源。</p>
        )}
      </section>

      {checkedInCompanies != null && stats.totalCompanies > 0 && (
        <section className="dw-blk">
          <div className="dw-sec-h">
            <span className="t">企业签到进度</span>
            <span className="hint">{checkedInCompanies} / {stats.totalCompanies} 家已签到入场</span>
          </div>
          <div className="qxfw-bars">
            <div className="qxfw-bar">
              <span>全场</span>
              <span className="qxfw-track">
                <i style={{ width: `${Math.round((checkedInCompanies / stats.totalCompanies) * 100)}%` }} />
              </span>
              <span className="n">{Math.round((checkedInCompanies / stats.totalCompanies) * 100)}%</span>
            </div>
            {stats.zoneBreakdown.map((zone) => {
              const rate = zone.boothCount > 0 ? Math.round((zone.checkedInCount / zone.boothCount) * 100) : 0
              return (
                <div key={zone.id} className="qxfw-bar">
                  <span>{zone.zoneName}</span>
                  <span className="qxfw-track"><i style={{ width: `${rate}%` }} /></span>
                  <span className="n">{zone.checkedInCount}/{zone.boothCount}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* 参展企业行业分布（真实聚合已录企业；无数据不渲染，不伪造） */}
      {stats.industryDistribution.length > 0 ? (
        <section className="dw-blk">
          <div className="dw-sec-h">
            <span className="t">参展企业行业分布</span>
            <span className="hint">按已录 {stats.totalCompanies} 家企业聚合 · {dataSourceLabel}</span>
          </div>
          <div className="qxfw-bars">
            {stats.industryDistribution.map((slice) => (
              <div key={slice.label} className="qxfw-bar">
                <span>{slice.label}</span>
                <span className="qxfw-track"><i style={{ width: `${Math.round((slice.count / maxIndustry) * 100)}%` }} /></span>
                <span className="n">{slice.count} 家</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* 求职意向分布（机构录入预计值，标注来源口径，非实时） */}
      {stats.seekerIntent.length > 0 ? (
        <section className="dw-blk">
          <div className="dw-sec-h">
            <span className="t">求职意向分布</span>
            <span className="hint">{dataSourceLabel}</span>
          </div>
          <div className="qxfw-bars">
            {stats.seekerIntent.map((slice) => (
              <div key={slice.label} className="qxfw-bar">
                <span>{slice.label}</span>
                <span className="qxfw-track"><i style={{ width: `${Math.max(0, Math.min(100, slice.percent))}%` }} /></span>
                <span className="n">{slice.percent}%</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <DirStrip>
        <DirStripItem icon={UsersIcon} tone="wheat" title="看参展名单" desc="数字背后的单位清单在这里" onClick={() => navigate(`/job-fairs/${fairId}/companies`)} />
        <DirStripItem icon={FileTextIcon} title="看活动物料" desc="主办方的总结材料如果有，也在这里" onClick={() => navigate(`/job-fairs/${fairId}/materials`)} />
        <DirStripItem icon={BuildingIcon} tone="slate" title="返回招聘会" desc="时间、地点与来源三要素" onClick={() => navigate(`/job-fairs/${fairId}`)} />
      </DirStrip>

      <DirNote>
        {dataSourceLabel}；系统仅记录可证明的服务行为，不记录求职者个人信息；活动办理结果以来源平台和现场为准。
      </DirNote>
    </QxFairWorkbench>
  )
}
