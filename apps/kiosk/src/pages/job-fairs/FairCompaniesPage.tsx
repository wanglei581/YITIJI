// /job-fairs/:id/companies —— 参展企业名单（稿 28-jobfair-enhanced.html，screen=companies / 087）。
//
// 状态与稿同名：list | loading | empty | error。
// 稿的边界：「名单以主办方回传为准；本机不代收简历，也不在平台内投递。」
// 因此这一页只做浏览与筛选，出口是企业详情（那里才有来源投递入口）。
//
// 三条请求**各自失败、各自表态**，不用 Promise.all 把它们绑成一个结局：
//   · /companies 失败 → 整页 error（名单是这一页的主体，没有它没得看）
//   · /zones     失败 → 名单照常显示，只有「所在展区」筛选不可用并给重试
//   · /job-fairs/:id 失败 → 名单照常显示，副标题与来源三要素退回到不声称
// 原来三条绑在一起：展区接口 500 会让一份**已经取回来的**完整名单整页消失，
// 屏幕上说「参展名单没取到」——而它其实就在内存里。

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { FairCompanyDTO, FairZoneDTO, ExternalJobFairDTO } from '@ai-job-print/shared'
import { BriefcaseIcon, BuildingIcon, FileTextIcon, SearchIcon, UsersIcon } from 'lucide-react'
import { getFairCompanies, getFairZones, getJobFairById } from '../../services/api'
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

const BOUNDARY = '名单以主办方回传为准；本机不代收简历，也不在平台内投递。'

export function FairCompaniesPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const fairId = id ?? ''

  const [fair, setFair] = useState<ExternalJobFairDTO | null>(null)
  const [companies, setCompanies] = useState<FairCompanyDTO[]>([])
  const [zones, setZones] = useState<FairZoneDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  /** 展区接口单独失败：名单仍然可看，只有筛选这一格降级。 */
  const [zonesFailed, setZonesFailed] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  /** 只重试展区那一条，不把整页推回 loading（名单已经在屏幕上了）。 */
  const [zonesRetryKey, setZonesRetryKey] = useState(0)

  const [search, setSearch] = useState('')
  const [zoneFilter, setZoneFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    // 名单是主体：只有它失败才算整页失败。
    Promise.all([
      getFairCompanies(fairId),
      // 场次详情只喂副标题与来源三要素，取不到不该连累名单。
      getJobFairById(fairId).then((r) => r.data).catch(() => null),
    ])
      .then(([companiesRes, fairData]) => {
        if (cancelled) return
        setCompanies(companiesRes.data)
        setFair(fairData)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId, retryKey])

  // 展区单独一条：失败只影响筛选区，不进整页状态机。
  useEffect(() => {
    let cancelled = false
    setZonesFailed(false)
    getFairZones(fairId)
      .then((res) => { if (!cancelled) setZones(res.data) })
      .catch(() => {
        if (cancelled) return
        setZones([])
        setZonesFailed(true)
        // 展区取不到时已选的展区条件无从校验，清掉，避免筛出一个空名单
        // 却让人以为「这个展区真的没有企业」。
        setZoneFilter('')
      })
    return () => { cancelled = true }
  }, [fairId, retryKey, zonesRetryKey])

  const zoneOptions = useMemo(
    () => [{ id: '', name: '全部展区' }, ...zones.map((z) => ({ id: z.id, name: z.zoneName }))],
    [zones],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return companies.filter((c) => {
      const matchZone = !zoneFilter || c.zoneId === zoneFilter
      const matchSearch = !q || c.companyName.toLowerCase().includes(q) || c.industry.toLowerCase().includes(q)
      return matchZone && matchSearch
    })
  }, [companies, search, zoneFilter])

  const uiState = loading ? 'loading' : error ? 'error' : companies.length === 0 ? 'empty' : 'list'

  const ctabar = uiState === 'error'
    ? (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/help')}>找工作人员</button>
        <button type="button" className="qx-btn" data-variant="primary" onClick={() => setRetryKey((k) => k + 1)}>重新加载</button>
      </>
    )
    : uiState === 'empty'
      ? (
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate(`/job-fairs/${fairId}/materials`)}>看看活动物料</button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate(`/job-fairs/${fairId}`)}>返回招聘会</button>
        </>
      )
      : uiState === 'loading'
        ? <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate(`/job-fairs/${fairId}`)}>返回招聘会</button>
        : (
          <>
            <p className="why">{BOUNDARY}</p>
            <button type="button" className="qx-btn narrow" data-variant="ghost" onClick={() => navigate(`/job-fairs/${fairId}/map`)}>展位分布</button>
            <button type="button" className="qx-btn narrow" data-variant="primary" onClick={() => navigate(`/job-fairs/${fairId}`)}>返回招聘会</button>
          </>
        )

  return (
    <QxFairWorkbench
      screen="companies"
      state={uiState}
      fairId={fairId}
      subtitle={fair ? `${fair.name} · ${BOUNDARY}` : undefined}
      ctabar={ctabar}
    >
      {uiState === 'loading' ? (
        <>
          <div className="dw-sec-h"><span className="t">正在取参展名单</span><span className="hint">未返回前不显示家数</span></div>
          <FairSkeletonList rows={3} />
        </>
      ) : uiState === 'error' ? (
        <>
          <DirState tone="error" testId="fair-companies-error" title="参展名单没取到">
            请求失败。名单关系到你到现场先去哪几家，<b>取不到就先不显示</b>，不给你一份可能过时的清单。
          </DirState>
          <DirStrip>
            <DirStripItem icon={FileTextIcon} title="活动物料" desc="物料里通常也有一份纸质名单可以打印" onClick={() => navigate(`/job-fairs/${fairId}/materials`)} />
            <DirStripItem icon={BuildingIcon} tone="wheat" title="返回招聘会" desc="时间地点仍然可以查看" onClick={() => navigate(`/job-fairs/${fairId}`)} />
          </DirStrip>
        </>
      ) : uiState === 'empty' ? (
        <>
          <DirState tone="empty" testId="fair-companies-empty" title="主办方还没有提供参展名单">
            名单通常在开展前几天才发布。本机<b>不会用往期名单或猜测的单位填上去</b>。
          </DirState>
          <DirStrip>
            <DirStripItem icon={BuildingIcon} tone="slate" title="企业目录" desc="平时收录的用人单位，与本场名单是两份数据" onClick={() => navigate('/companies')} />
            <DirStripItem icon={UsersIcon} title="岗位信息" desc="先按岗位看，来源与有效期照样标注" onClick={() => navigate('/jobs')} />
          </DirStrip>
        </>
      ) : (
        <>
          <div className="dw-qbar">
            <span className="qi"><SearchIcon size={28} aria-hidden /></span>
            <input
              className="dw-qinput"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索企业名称或行业"
              aria-label="搜索参展企业"
            />
          </div>
          {/* 展区筛选单独降级：这一格取不到，不代表名单取不到。 */}
          <div className="dw-fgrp">
            <span className="fl">所在展区</span>
            <div className="fc">
              {zonesFailed ? (
                <>
                  <span className="dw-why" data-testid="fair-companies-zones-failed">
                    展区筛选这次没取到，名单不受影响；也可能主办方本来就没分展区。
                  </span>
                  <button
                    type="button"
                    className="dw-chip"
                    data-testid="fair-companies-zones-retry"
                    onClick={() => setZonesRetryKey((k) => k + 1)}
                  >
                    重试展区筛选
                  </button>
                </>
              ) : (
                zoneOptions.map((z) => (
                  <button
                    key={z.id || 'all'}
                    type="button"
                    onClick={() => setZoneFilter(z.id)}
                    aria-pressed={zoneFilter === z.id}
                    className={`dw-chip${zoneFilter === z.id ? ' on' : ''}`}
                  >
                    {z.name}
                  </button>
                ))
              )}
            </div>
          </div>

          <p className="dw-rhead">
            <span className="rn">参展企业名单</span>
            <span>共 {companies.length} 家 · 当前筛出 {filtered.length} 家</span>
            <span className="rsp">名单由主办方提供</span>
          </p>

          <div className="dw-rlist qx-grow" data-testid="fair-companies-list">
            {filtered.length === 0 ? (
              <DirState tone="empty" testId="fair-companies-filtered-empty" title="当前筛选条件下没有企业">
                名单里有 {companies.length} 家，但没有一家同时满足你选的展区和关键字。换个条件再看。
              </DirState>
            ) : (
              filtered.map((company) => (
                <button
                  key={company.id}
                  type="button"
                  className="dw-row solid"
                  onClick={() => navigate(`/job-fairs/${fairId}/companies/${company.id}`, { state: { company } })}
                >
                  <span className="dw-row-ic slate"><BuildingIcon size={26} aria-hidden /></span>
                  <span className="dw-row-main">
                    <span className="dw-row-t">
                      {company.companyName}
                      {/* 规模原样显示来源文本。来源没给就不出这个标签——不写「中型」之类的猜测。 */}
                      {company.scale ? <span className="dw-tag slate">{company.scale}</span> : null}
                    </span>
                    <span className="dw-row-sub">
                      {company.boothNumber ? <span>展位号 {company.boothNumber}</span> : null}
                      <span>{company.industry}</span>
                      {company.positions.length > 0 ? (
                        <span>
                          <BriefcaseIcon size={19} aria-hidden />
                          在招岗位 {company.positions.length} 个 · 计划 {company.positions.reduce((s, p) => s + p.headcount, 0)} 人
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="dw-row-go" aria-hidden>›</span>
                </button>
              ))
            )}
          </div>

          {fair ? (
            <DirKv rows={[
              ['来源机构', fair.sourceName],
              ['同步时间', fair.syncTime ? fmtFairSyncDate(fair.syncTime) : '同步时间未知'],
              ['外部编号', fair.externalId],
            ]} />
          ) : null}

          <DirNote>{BOUNDARY}</DirNote>
        </>
      )}
    </QxFairWorkbench>
  )
}
