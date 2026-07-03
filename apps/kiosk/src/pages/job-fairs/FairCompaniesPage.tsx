import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { FairCompanyDTO, FairZoneDTO, ExternalJobFairDTO } from '@ai-job-print/shared'
import { COMPANY_SCALE_SHORT } from '../../types/fair'
import { BuildingIcon, BriefcaseIcon, MapPinIcon, SearchIcon } from 'lucide-react'
import { getFairCompanies, getFairZones, getJobFairById } from '../../services/api'

const CHECKIN_STYLES = {
  checked_in: 'bg-success-bg text-success-fg',
  pending:    'bg-warning-bg text-warning-fg',
  absent:     'bg-neutral-100 text-neutral-400',
}
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
    <div className="flex h-full flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          title="参会企业"
          subtitle={fair ? `${fair.name} · ${companies.length} 家企业` : `${companies.length} 家企业`}
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate(`/job-fairs/${fairId}`)}>
              返回详情
            </Button>
          }
        />
        <div className="relative mt-4">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索企业名称或行业..."
            className="w-full rounded-xl border border-neutral-200 bg-white py-3 pl-10 pr-4 text-sm text-neutral-700 placeholder-neutral-400 focus:border-primary-400 focus:outline-none"
          />
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {zoneOptions.map((z) => (
            <button
              key={z}
              onClick={() => setZoneFilter(z)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                zoneFilter === z
                  ? 'bg-primary-600 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              {z}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6">
        {filtered.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <p className="text-sm text-neutral-400">无匹配企业</p>
          </div>
        ) : (
          filtered.map((company) => (
            <Card key={company.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-neutral-900">{company.companyName}</p>
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                      {COMPANY_SCALE_SHORT[company.scale]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-500">{company.industry}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${CHECKIN_STYLES[company.checkinStatus]}`}>
                  {CHECKIN_LABELS[company.checkinStatus]}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                {company.boothNumber && (
                  <span className="flex items-center gap-1">
                    <MapPinIcon className="h-3.5 w-3.5" />
                    展位 {company.boothNumber}
                  </span>
                )}
                {company.positions.length > 0 && (
                  <span className="flex items-center gap-1">
                    <BriefcaseIcon className="h-3.5 w-3.5" />
                    招聘 {company.positions.reduce((s, p) => s + p.headcount, 0)} 人 · {company.positions.length} 岗
                  </span>
                )}
              </div>
              {company.description && (
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-neutral-400">
                  {company.description}
                </p>
              )}
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  onClick={() => navigate(`/job-fairs/${fairId}/companies/${company.id}`, { state: { company } })}
                >
                  查看详情 / 扫码查看来源平台
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      <p className="px-6 pb-4 text-xs text-neutral-400">
        系统仅展示参展企业信息，如需办理请扫码前往来源平台，系统不参与招聘闭环。
      </p>
    </div>
  )
}
