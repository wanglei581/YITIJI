import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ErrorState, LoadingState } from '@ai-job-print/ui'
import { BuildingIcon, ClockIcon, MapPinIcon, SearchIcon, ShieldCheckIcon } from 'lucide-react'
import {
  getOfflineAgencies,
  type OfflineAgencyDTO,
  type OfflineAgencyListResult,
} from '../../services/api/offlineAgencies'
import { FusionBadge, FusionNotice, KioskPageFrame } from '../jobs/components/W4Presentation'

const PAGE_SIZE = 10

const DISTRICTS = ['全部', '高新区', '城东区', '城南区', '城北区']
const SERVICES = ['全部', '岗位推荐', '用工咨询', '劳务派遣']

function StatsBand({ stats }: { stats: OfflineAgencyListResult['stats'] }) {
  const cells = [
    { n: stats.totalAgencies, t: '合作机构' },
    { n: stats.openAgencies, t: '今日开放' },
    { n: stats.totalJobs, t: '岗位总数' },
    { n: stats.districts, t: '覆盖区域' },
  ]
  return (
    <div className="oa-stats-band" aria-label="机构概览">
      <div className="oa-stats-cells">
        {cells.map((cell) => (
          <div key={cell.t}>
            <div className="oa-n">{cell.n}</div>
            <div className="oa-t">{cell.t}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AgencyRow({ agency }: { agency: OfflineAgencyDTO }) {
  const isOpen = agency.status === 'open'
  const services = Array.isArray(agency.services) ? agency.services : []
  return (
    <Link to={`/offline-agencies/${agency.id}`} className="jf-row oa-agency-row" aria-label={agency.name}>
      <span className="oa-ag-logo" aria-hidden="true">
        <BuildingIcon />
      </span>
      <div className="jf-row-main">
        <div className="jf-row-title">
          <b>{agency.name}</b>
          <span className={`oa-st ${isOpen ? 'open' : 'rest'}`}>
            <i className="oa-dot" aria-hidden="true" />
            {agency.statusLabel ?? null}
          </span>
        </div>
        <div className="jf-row-info">
          <span>
            <MapPinIcon aria-hidden="true" />
            {agency.address}
          </span>
          <span>
            <ClockIcon aria-hidden="true" />
            {agency.hours || '服务时间以机构公示为准'}
          </span>
        </div>
        <div className="jf-row-sub">
          {services.map((svc) => (
            <span key={svc} className="jf-chip">{svc}</span>
          ))}
          <span className="jf-chip src">来源编号 {agency.orgCode}</span>
          <span className="jf-chip ok">资质核验已通过</span>
        </div>
      </div>
      <div className="oa-r-aside" aria-label={`${agency.jobCount} 个岗位`}>
        <div className="oa-jobs-n">{agency.jobCount}</div>
        <div className="oa-jobs-t">岗位</div>
      </div>
    </Link>
  )
}

function EmptyState() {
  return (
    <div className="oa-empty" role="status">
      <BuildingIcon aria-hidden="true" />
      <b>暂无线下招聘机构信息</b>
      <span>可切换区域或服务类型再试；机构需完成资质核验后才会展示。</span>
    </div>
  )
}

export function OfflineAgenciesPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<OfflineAgencyListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [district, setDistrict] = useState('全部')
  const [service, setService] = useState('全部')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      getOfflineAgencies({
        district: district === '全部' ? undefined : district,
        service: service === '全部' ? undefined : service,
        keyword: keyword.trim() || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
        .then((res) => {
          if (cancelled) return
          setData(res)
          setLoading(false)
        })
        .catch(() => {
          if (cancelled) return
          setError('机构列表暂时无法加载，请稍后重试')
          setLoading(false)
        })
    }, keyword.trim() ? 280 : 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [district, service, keyword, page, retryKey])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 0
  const syncHint = useMemo(() => data?.stats.lastSyncLabel || '已同步', [data])

  return (
    <KioskPageFrame
      tone="clay"
      title="线下招聘机构"
      subtitle="合作人力资源机构门店 · 岗位咨询与应聘到店办理"
      backLabel="返回岗位信息"
      onBack={() => navigate('/jobs')}
      badge={<FusionBadge icon={ShieldCheckIcon}>机构资质核验后收录</FusionBadge>}
    >
      <div className="oa-filter-stack">
        <div className="jf-filter-bar">
          <span className="jf-filter-label">区域</span>
          {DISTRICTS.map((d) => (
            <button
              key={d}
              type="button"
              className={`jf-f-chip${district === d ? ' on' : ''}`}
              onClick={() => { setDistrict(d); setPage(1) }}
            >
              {d}
            </button>
          ))}
          <label className="jf-searchbox" style={{ maxWidth: 360 }}>
            <SearchIcon aria-hidden="true" />
            <input
              value={keyword}
              onChange={(event) => { setKeyword(event.target.value); setPage(1) }}
              placeholder="搜索机构名称"
              aria-label="搜索机构名称"
            />
          </label>
        </div>

        <div className="jf-filter-bar">
          <span className="jf-filter-label">服务</span>
          {SERVICES.map((s) => (
            <button
              key={s}
              type="button"
              className={`jf-f-chip${service === s ? ' on' : ''}`}
              onClick={() => { setService(s); setPage(1) }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingState className="flex-1" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setRetryKey((k) => k + 1)} className="flex-1" />
      ) : !data ? null : (
        <div className="oa-list-shell">
          <StatsBand stats={data.stats} />

          <div className="jf-list-meta">
            <span>
              共 <b>{data.total}</b> 家合作机构 · {syncHint}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 18, color: 'var(--muted)' }}>
              到店咨询办理 · 本终端不代收简历
            </span>
          </div>

          {data.items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="jf-list">
              {data.items.map((agency) => (
                <AgencyRow key={agency.id} agency={agency} />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="jf-pager">
              <button
                type="button"
                className="jf-btn ghost sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </button>
              <span className="jf-page-ind">{page} / {totalPages}</span>
              <button
                type="button"
                className="jf-btn ghost sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          )}

          <FusionNotice>
            线下机构岗位的咨询与应聘请前往机构门店办理；本终端不代收简历、不代收任何费用，机构服务项目与收费以门店依法公示为准，请勿支付押金或未公示费用。
          </FusionNotice>
        </div>
      )}
    </KioskPageFrame>
  )
}

export default OfflineAgenciesPage
