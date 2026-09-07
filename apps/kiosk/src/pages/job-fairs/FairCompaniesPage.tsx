import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { FairCompanyDTO, FairZoneDTO, ExternalJobFairDTO } from '@ai-job-print/shared'
import { AlertTriangleIcon, BuildingIcon, SearchIcon } from 'lucide-react'
import { getFairCompanies, getFairZones, getJobFairById } from '../../services/api'
import {
  QxFairCta,
  QxFairNavRow,
  QxFairShell,
  QxFairSkel,
  QxFairSourceCard,
  QxFairState,
} from './qx/qxFairChrome'

export function FairCompaniesPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const fairId = id ?? ''

  const [fair, setFair] = useState<ExternalJobFairDTO | null>(null)
  const [companies, setCompanies] = useState<FairCompanyDTO[]>([])
  const [zones, setZones] = useState<FairZoneDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  const [zoneFilter, setZoneFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      getJobFairById(fairId),
      getFairCompanies(fairId),
      getFairZones(fairId),
    ])
      .then(([fairRes, companiesRes, zonesRes]) => {
        if (cancelled) return
        setFair(fairRes.data)
        setCompanies(companiesRes.data)
        setZones(zonesRes.data)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId])

  const zoneOptions = useMemo(
    () => [{ id: '', name: '全部' }, ...zones.map((z) => ({ id: z.id, name: z.zoneName }))],
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

  const viewState = loading ? 'loading' : error ? 'error' : companies.length === 0 ? 'empty' : 'list'
  const pill = viewState === 'list'
    ? { tone: 'ok' as const, label: '名单由主办方提供' }
    : viewState === 'error'
      ? { tone: 'bad' as const, label: '参展名单没取到' }
      : viewState === 'empty'
        ? { tone: 'unknown' as const, label: '主办方还没有提供名单' }
        : { tone: 'unknown' as const, label: '正在取参展名单' }

  return (
    <QxFairShell
      title="参展企业"
      subtitle="名单由主办方提供；本机不代收简历，不提供平台内投递。"
      status={pill}
      screen="companies"
      state={viewState}
      ctabar={
        <QxFairCta variant="primary" testId="companies-primary" onClick={() => navigate(`/job-fairs/${fairId}`)}>
          返回招聘会
        </QxFairCta>
      }
    >
      {viewState === 'loading' ? (
        <>
          <div className="qx-sec-h"><span className="t">正在取参展名单</span><span className="hint">未返回前不显示家数</span></div>
          <QxFairSkel rows={3} />
        </>
      ) : viewState === 'error' ? (
        <>
          <QxFairState screen="companies" tone="error" icon={AlertTriangleIcon} title="参展名单没取到">
            请求失败。名单关系到你到现场先去哪几家，<b>取不到就先不显示</b>，不给你一份可能过时的清单。
          </QxFairState>
          <div className="qx-rows">
            <QxFairNavRow icon={BuildingIcon} title="活动物料" description="物料里通常也有一份纸质名单可以打印。" onClick={() => navigate(`/job-fairs/${fairId}/materials`)} testId="companies-materials" />
          </div>
        </>
      ) : viewState === 'empty' ? (
        <>
          <QxFairState screen="companies" tone="empty" icon={BuildingIcon} title="主办方还没有提供参展名单">
            名单通常在开展前几天才发布。本机<b>不会用往期名单或猜测的单位填上去</b>。
          </QxFairState>
          <div className="qx-rows">
            <QxFairNavRow icon={BuildingIcon} title="企业目录" description="平时收录的用人单位，与本场名单是两份数据。" onClick={() => navigate('/companies')} testId="companies-dir" />
            <QxFairNavRow icon={BuildingIcon} title="岗位信息" description="先按岗位看，来源与有效期照样标注。" onClick={() => navigate('/jobs')} testId="companies-jobs" />
          </div>
        </>
      ) : (
        <>
          <div className="qx-sec-h">
            <span className="t">参展企业名单</span>
            <span className="hint">共 {companies.length} 家 · 名单由主办方提供</span>
          </div>
          <div className="qx-fair-qbar">
            <span className="qi"><SearchIcon size={28} aria-hidden /></span>
            <input
              className="qx-fair-qinput"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索企业名称或行业"
              aria-label="搜索参展企业"
            />
          </div>
          <div className="qx-fair-chips" role="group" aria-label="展区筛选">
            {zoneOptions.map((z) => (
              <button
                key={z.id || 'all'}
                type="button"
                onClick={() => setZoneFilter(z.id)}
                className="qx-fair-chip"
                aria-pressed={zoneFilter === z.id}
              >
                {z.name}
              </button>
            ))}
          </div>
          <ul className="qx-fair-list" data-testid="companies-list">
            {filtered.length === 0 ? (
              <li className="qx-card">无匹配企业</li>
            ) : filtered.map((company) => (
              <li key={company.id} className="qx-fair-item">
                <button
                  type="button"
                  className="qx-fair-item-link"
                  onClick={() => navigate(`/job-fairs/${fairId}/companies/${company.id}`, { state: { company } })}
                >
                  <span className="qx-fair-item-ic" data-tone="slate">{company.companyName.slice(0, 1)}</span>
                  <span className="qx-fair-item-tx">
                    <span className="qx-fair-item-t">
                      {company.companyName}
                      {company.scale ? <span className="qx-fair-tag" style={{ marginLeft: 8 }}>{company.scale}</span> : null}
                    </span>
                    <span className="qx-fair-item-sub">
                      {company.boothNumber ? <span>展位号 {company.boothNumber}</span> : null}
                      <span>在招岗位 {company.positions.length}</span>
                    </span>
                  </span>
                  <span className="qx-fair-item-go">查看</span>
                </button>
              </li>
            ))}
          </ul>
          <QxFairSourceCard sourceName={fair?.sourceName} syncTime={fair?.syncTime} externalId={fair?.externalId} />
          <p className="qx-fair-local-note">系统仅展示参展企业信息，如需办理请扫码前往来源平台，系统不参与招聘闭环。</p>
        </>
      )}
    </QxFairShell>
  )
}
