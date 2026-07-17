import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import type { FairCompanyDTO, FairZoneDTO, ExternalJobFairDTO } from '@ai-job-print/shared'
import { COMPANY_SCALE_SHORT } from '../../types/fair'
import { BuildingIcon, BriefcaseIcon, ChevronRightIcon, MapPinIcon, QrCodeIcon, SearchIcon } from 'lucide-react'
import { getFairCompanies, getFairZones, getJobFairById } from '../../services/api'
import { ProtoBadge, ProtoNotice, ProtoPage } from '../jobs-fairs-prototype'

const CHECKIN_LABELS = {
  checked_in: '已签到',
  pending:    '未签到',
  absent:     '缺席',
}

export function FairCompaniesPage() {
  const navigate = useNavigate()
  const { id }   = useParams<{ id: string }>()
  const fairId   = id ?? ''

  const [fair,      setFair]      = useState<ExternalJobFairDTO | null>(null)
  const [companies, setCompanies] = useState<FairCompanyDTO[]>([])
  const [zones,     setZones]     = useState<FairZoneDTO[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(false)

  const [search,     setSearch]     = useState('')
  const [zoneFilter, setZoneFilter] = useState('全部')

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

  const zoneOptions = useMemo(() => ['全部', ...zones.map((z) => z.zoneName)], [zones])

  const filtered = useMemo(() => {
    const q    = search.trim().toLowerCase()
    const zone = zoneFilter === '全部' ? null : zoneFilter
    return companies.filter((c) => {
      const matchZone   = zone === null || c.zoneName === zone
      const matchSearch = !q || c.companyName.toLowerCase().includes(q) || c.industry.toLowerCase().includes(q)
      return matchZone && matchSearch
    })
  }, [companies, search, zoneFilter])

  if (loading) {
    return <LoadingState className="h-full" />
  }

  if (error) {
    return (
      <ErrorState
        message="加载失败，请稍后重试"
        onRetry={() => navigate(`/job-fairs/${fairId}`)}
        className="h-full"
      />
    )
  }

  if (companies.length === 0) {
    return <EmptyState icon={BuildingIcon} title="暂无企业数据" className="h-full" />
  }

  return (
    <ProtoPage
      tone="wheat"
      title="参会企业"
      subtitle={fair ? `${fair.name} · ${companies.length} 家企业` : `${companies.length} 家企业`}
      backLabel="返回详情"
      onBack={() => navigate(`/job-fairs/${fairId}`)}
      badge={<ProtoBadge icon={BuildingIcon}>{filtered.length} 家匹配</ProtoBadge>}
      actionBar={
        <>
          <button type="button" className="jf-btn ghost" onClick={() => navigate(`/job-fairs/${fairId}/map`)}>
            场馆导览
          </button>
          <div className="jf-spacer" />
          <button type="button" className="jf-btn dark" onClick={() => navigate(`/job-fairs/${fairId}`)}>
            查看招聘会
          </button>
        </>
      }
    >
        <div className="jf-searchbox">
          <SearchIcon aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索企业名称或行业"
          />
        </div>
        <div className="jf-filter-bar">
          {zoneOptions.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoneFilter(z)}
              className={`jf-f-chip sm ${zoneFilter === z ? 'on' : ''}`}
            >
              {z}
            </button>
          ))}
        </div>

      <section className="jf-list">
        {filtered.length === 0 ? (
          <div className="jf-card compact text-center text-[var(--muted)]">无匹配企业</div>
        ) : (
          filtered.map((company) => (
            <button
              key={company.id}
              type="button"
              className="jf-row align-start"
              onClick={() => navigate(`/job-fairs/${fairId}/companies/${company.id}`, { state: { company } })}
            >
              <span className="jf-company-icon">{company.companyName.slice(0, 1)}</span>
              <span className="jf-row-main">
                <span className="jf-row-title">
                  <b>{company.companyName}</b>
                  <span className="jf-kind">{company.industry}</span>
                  <span className={`jf-chip ${company.checkinStatus === 'checked_in' ? 'ok' : company.checkinStatus === 'pending' ? 'warn' : ''}`}>
                    {CHECKIN_LABELS[company.checkinStatus]}
                  </span>
                </span>
                <span className="jf-row-info">
                  <span>{COMPANY_SCALE_SHORT[company.scale]}</span>
                  {company.boothNumber && (
                    <span>
                      <MapPinIcon aria-hidden="true" />
                      展位 {company.boothNumber}
                    </span>
                  )}
                  {company.positions.length > 0 && (
                    <span>
                      <BriefcaseIcon aria-hidden="true" />
                      招聘 {company.positions.reduce((s, p) => s + p.headcount, 0)} 人 · {company.positions.length} 岗
                    </span>
                  )}
                </span>
                {company.description && (
                  <span className="mt-2 block line-clamp-2 text-[18px] leading-relaxed text-[var(--muted)]">
                    {company.description}
                  </span>
                )}
                <span className="jf-row-sub">
                  <span className="jf-chip">
                    展区 <b>{company.zoneName ?? '未分区'}</b>
                  </span>
                  <span className="jf-chip src">
                    <QrCodeIcon aria-hidden="true" />
                    扫码查看
                  </span>
                </span>
              </span>
              <span className="jf-btn sm ghost">
                查看详情
              </span>
              <ChevronRightIcon className="jf-arrow" aria-hidden="true" />
            </button>
          ))
        )}
      </section>

      <ProtoNotice>
        系统仅展示参展企业信息，如需办理请扫码前往来源平台，系统不参与招聘闭环。
      </ProtoNotice>
    </ProtoPage>
  )
}
