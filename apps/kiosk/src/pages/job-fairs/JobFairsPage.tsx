// /job-fairs —— 招聘会场次列表（稿 28-jobfair-enhanced.html，screen=list / 084）。
//
// 状态与稿一一对应：ready | loading | empty | favorites-empty | error。
// 顶栏胶囊、h1、返回落点与底部 truth 条由 QxFairWorkbench 按稿面规格表出话，本页不自拟。
//
// 两条不能动的事实边界：
//   ① 服务端总数（total）与本屏渲染数（visible）各说各的，不合并成一个数；
//   ② 关键字 / 状态走服务端查询，地区 / 日期 / 收藏只在已取回集合内筛——页面必须说清楚。

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ExternalJobFairDTO } from '@ai-job-print/shared'
import {
  Building2Icon,
  CalendarIcon,
  PrinterIcon,
  QrCodeIcon,
  SearchIcon,
  StarIcon,
  UsersIcon,
} from 'lucide-react'
import { getJobFairs, getTerminalId } from '../../services/api'
import { recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'
import { useFavorites } from '../../favorites/useFavorites'
import { FairCalendarPopover } from './components/FairCalendarPopover'
import { RegionPicker } from './components/RegionPicker'
import { matchesRegion, type RegionSelection } from '../../lib/regions'
import { fairDateKey } from './fairFormat'
import { evaluateJobSourceTrust, sourceTrustReason } from '../jobs/utils/sourceTrust'
import { SOURCE_APPLY_UNAVAILABLE_REASON } from '../../lib/capabilityReasons'
import { QxFairWorkbench } from './QxFairWorkbench'
import { FairBookingQr, FairListCard, FairSkeletonList } from './components/FairWorkbenchBits'
import { DirState, DirStrip, DirStripItem } from '../../components/qingxu/directory/DirectoryBits'

const ALL_STATUS = ['全部', '即将开始', '进行中', '已结束'] as const
const STATUS_FILTER_MAP: Record<string, string> = { 即将开始: 'upcoming', 进行中: 'ongoing', 已结束: 'ended' }

export function JobFairsPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [region, setRegion] = useState<RegionSelection>({})
  const [statusFilter, setStatusFilter] = useState('全部')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [fairs, setFairs] = useState<ExternalJobFairDTO[]>([])
  /** 服务端按当前 status/keyword 统计的真实条数（不是本页条数）。 */
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [qrFair, setQrFair] = useState<ExternalJobFairDTO | null>(null)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const { getToken } = useAuth()
  const { idsOf, toggle: toggleFavorite } = useFavorites()
  const favoriteSet = idsOf('job_fair')

  /**
   * 来源四要素缺一即不放行：不记录、不出码。
   *
   * 原实现是「要素不全就不写 ExternalJumpLog，但二维码照弹」——日志干净了，
   * 用户手上却拿到了一个本机无法核对来源的链接。扫码离开本机之后没有任何补救，
   * 所以拦截必须在出码之前，并把缺了哪几项写在按钮旁边（见 FairListCard）。
   */
  const bookBlockedReasonOf = (fair: ExternalJobFairDTO): string => {
    const trust = evaluateJobSourceTrust(fair)
    return trust.ok ? '' : sourceTrustReason(trust, SOURCE_APPLY_UNAVAILABLE_REASON)
  }

  const openBookingQr = (fair: ExternalJobFairDTO) => {
    if (!evaluateJobSourceTrust(fair).ok) return
    recordExternalJump(getToken(), 'job_fair', fair.id, 'external_appointment')
    setQrFair(fair)
  }

  // 搜索词防抖后交给服务端全表检索（与岗位页一致），不再只搜当前已加载的一页。
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let cancelled = false
    const terminalId = getTerminalId()
    setLoading(true); setError(false)
    getJobFairs({
      ...(terminalId ? { terminalId } : {}),
      ...(statusFilter === '全部' ? {} : { status: STATUS_FILTER_MAP[statusFilter] }),
      ...(debouncedQuery ? { keyword: debouncedQuery } : {}),
      pageSize: 100,
    })
      .then((res) => {
        if (cancelled) return
        setFairs(res.data)
        setTotal(res.pagination.total)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [retryKey, statusFilter, debouncedQuery])

  // 剩下的三个条件服务端不支持，仍在已取回集合内本地筛选。
  // status 保留本地复筛，保证「卡片上显示的状态」与所选筛选始终一致。
  const visible = useMemo(() => {
    const statusVal = statusFilter === '全部' ? null : STATUS_FILTER_MAP[statusFilter]
    return fairs.filter((f) => {
      if (favoritesOnly && !favoriteSet.has(f.id)) return false
      if (statusVal && f.status !== statusVal) return false
      if (!matchesRegion(f, region)) return false
      if (selectedDate && fairDateKey(f.startTime) !== selectedDate) return false
      return true
    })
  }, [fairs, statusFilter, region, selectedDate, favoritesOnly, favoriteSet])

  const upcomingCount = useMemo(() => visible.filter((f) => f.status === 'upcoming').length, [visible])
  const ongoingCount = useMemo(() => visible.filter((f) => f.status === 'ongoing').length, [visible])

  const uiState = loading
    ? 'loading'
    : error
      ? 'error'
      : visible.length === 0
        ? (favoritesOnly ? 'favorites-empty' : 'empty')
        : 'ready'

  const ctabar = uiState === 'loading'
    ? <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/fairs-service')}>返回招聘会服务</button>
    : uiState === 'error'
      ? (
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/help')}>找工作人员</button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => setRetryKey((k) => k + 1)}>重新加载</button>
        </>
      )
      : (
        <>
          <p className="why">扫码后在来源平台预约或签到；本机不保存结果。</p>
          <button type="button" className="qx-btn narrow" data-variant="ghost" onClick={() => navigate('/job-fairs/checkin')}>查看入场入口</button>
          <button type="button" className="qx-btn narrow" data-variant="primary" onClick={() => navigate('/campus')}>看校园招聘</button>
        </>
      )

  return (
    <QxFairWorkbench screen="list" state={uiState} ctabar={ctabar}>
      {qrFair ? <FairBookingQr fair={qrFair} onClose={() => setQrFair(null)} /> : null}

      {uiState === 'loading' ? (
        <>
          <div className="dw-sec-h"><span className="t">正在取场次名单</span><span className="hint">未返回前不显示条数</span></div>
          <FairSkeletonList rows={3} />
          <p className="dw-why">只显示整体等待，不画阶段进度，也不预估剩余时间。</p>
        </>
      ) : uiState === 'error' ? (
        <>
          <DirState tone="error" testId="fair-list-error" title="场次名单这次没取到">
            请求失败了。本机<b>不显示上一次的缓存场次</b>，避免你按已经结束的时间地点白跑一趟。
          </DirState>
          <DirStrip>
            <DirStripItem icon={UsersIcon} title="岗位信息" desc="岗位和招聘会不是同一个接口" onClick={() => navigate('/jobs')} />
            <DirStripItem icon={Building2Icon} tone="slate" title="企业目录" desc="按用人单位查看在招岗位与来源" onClick={() => navigate('/companies')} />
          </DirStrip>
        </>
      ) : (
        <>
          <div className="dw-qbar">
            <span className="qi"><SearchIcon size={28} aria-hidden /></span>
            <input
              className="dw-qinput"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜场次名称、企业或地点"
              aria-label="搜索招聘会"
            />
          </div>

          <div className="dw-fgrp">
            <span className="fl">场次状态</span>
            <div className="fc">
              {ALL_STATUS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  aria-pressed={statusFilter === s}
                  className={`dw-chip${statusFilter === s ? ' on' : ''}`}
                >
                  {s}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setFavoritesOnly((v) => !v)}
                aria-pressed={favoritesOnly}
                className={`dw-chip${favoritesOnly ? ' on' : ''}`}
              >
                <StarIcon size={20} aria-hidden />
                只看收藏{favoriteSet.size > 0 ? ` · ${favoriteSet.size}` : ''}
              </button>
            </div>
          </div>

          <div className="dw-fgrp">
            <span className="fl">地区与日期</span>
            <div className="fc">
              <RegionPicker value={region} onChange={setRegion} />
              <FairCalendarPopover fairs={fairs} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
            </div>
          </div>
          <p className="dw-filter-note">
            关键字与状态交给服务端查询；地区、日期和收藏只在本次已加载的场次集合内筛选，不代表全库结果。
          </p>

          {uiState === 'favorites-empty' ? (
            <>
              <DirState tone="empty" testId="fair-list-favorites-empty" title="还没有收藏的招聘会">
                收藏只是这台终端的浏览辅助，不代表已预约、已报名或已签到。
              </DirState>
              <DirStrip>
                <DirStripItem icon={CalendarIcon} tone="wheat" title="查看全部场次" desc="取消「只看收藏」回到完整列表" onClick={() => setFavoritesOnly(false)} />
                <DirStripItem icon={QrCodeIcon} title="到场指引" desc="已预约过的场次可以先看当天怎么走" onClick={() => navigate('/job-fairs/checkin')} />
              </DirStrip>
            </>
          ) : uiState === 'empty' ? (
            <>
              <DirState tone="empty" testId="fair-list-empty" title="没有符合当前条件的招聘会">
                主办方还没有发布匹配的场次。本机<b>不会拿往期活动充数</b>，也不会写一个不存在的日期。
              </DirState>
              <DirStrip>
                <DirStripItem icon={QrCodeIcon} tone="wheat" title="到场指引" desc="已经预约过的场次，可以先看到场当天怎么走" onClick={() => navigate('/job-fairs/checkin')} />
                <DirStripItem icon={PrinterIcon} title="先把简历打印好" desc="下次赶上招聘会，材料是现成的" onClick={() => navigate('/print-scan')} />
              </DirStrip>
            </>
          ) : (
            <>
              <p className="dw-rhead">
                <span className="rn">服务端结果 {total} 场</span>
                <span>当前展示 {visible.length} 场</span>
                {upcomingCount > 0 ? <span>即将开始 {upcomingCount}</span> : null}
                {ongoingCount > 0 ? <span>进行中 {ongoingCount}</span> : null}
              </p>
              <div className="dw-rlist qx-grow" data-testid="fair-list">
                {visible.map((fair) => (
                  <FairListCard
                    key={fair.id}
                    fair={fair}
                    favorite={favoriteSet.has(fair.id)}
                    bookBlockedReason={bookBlockedReasonOf(fair)}
                    onToggleFavorite={() => toggleFavorite({ type: 'job_fair', id: fair.id, title: fair.name })}
                    onBook={() => openBookingQr(fair)}
                    onDetail={() => navigate(`/job-fairs/${fair.id}`, { state: { fair } })}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </QxFairWorkbench>
  )
}
