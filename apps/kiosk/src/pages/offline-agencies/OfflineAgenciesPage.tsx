import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorState, LoadingState } from '@ai-job-print/ui'
import { BuildingIcon, ClockIcon, MapPinIcon, SearchIcon, ShieldCheckIcon } from 'lucide-react'
import {
  getOfflineAgencies,
  type OfflineAgencyDTO,
  type OfflineAgencyListResult,
} from '../../services/api/offlineAgencies'
import { FusionBadge, FusionNotice, KioskPageFrame } from '../jobs/components/W4Presentation'

const PAGE_SIZE = 10

const DISTRICTS = ['全部', '城东区', '城南区', '城北区', '高新区']
const SERVICES = ['全部', '岗位推荐', '用工咨询', '劳务派遣']

// ── 统计带 ──────────────────────────────────────────────────
function StatsBand({ stats }: { stats: OfflineAgencyListResult['stats'] }) {
  return (
    <div className="oa-stats-band">
      <BuildingIcon aria-hidden="true" />
      <div className="oa-stats-cells">
        <div>
          <div className="oa-n">{stats.totalAgencies}</div>
          <div className="oa-t">合作机构</div>
        </div>
        <div>
          <div className="oa-n">{stats.openAgencies}</div>
          <div className="oa-t">今日服务</div>
        </div>
        <div>
          <div className="oa-n">{stats.totalJobs}</div>
          <div className="oa-t">在招岗位</div>
        </div>
        <div>
          <div className="oa-n">{stats.districts}</div>
          <div className="oa-t">覆盖区域</div>
        </div>
      </div>
    </div>
  )
}

// ── 机构卡片 ─────────────────────────────────────────────────
function AgencyRow({ agency }: { agency: OfflineAgencyDTO }) {
  const isOpen = agency.status === 'open'
  return (
    <article className="jf-row oa-agency-row" aria-label={agency.name}>
      <span className="oa-ag-logo" aria-hidden="true">
        <BuildingIcon />
      </span>
      <div className="jf-row-main">
        <div className="jf-row-title">
          <b>{agency.name}</b>
          <span className={`oa-st ${isOpen ? 'open' : 'rest'}`}>
            <i className="oa-dot" aria-hidden="true" />
            {isOpen ? agency.statusLabel : agency.statusLabel || '机构临时休息 · 以门店公告为准'}
          </span>
        </div>
        <div className="jf-row-info">
          <span>
            <MapPinIcon aria-hidden="true" />
            {agency.address}
            {agency.distanceKm !== undefined ? ` · 距本机约${agency.distanceKm}km(直线)` : ''}
          </span>
          <span>
            <ClockIcon aria-hidden="true" />
            {agency.hours}
          </span>
        </div>
        <div className="jf-row-sub">
          {agency.services.map((svc) => (
            <span key={svc} className="jf-chip">{svc}</span>
          ))}
          <span className="jf-chip src">来源机构编号 {agency.orgCode}</span>
          <span className="jf-chip ok">岗位信息已审核</span>
        </div>
      </div>
      <div className="oa-r-aside">
        <div className="oa-jobs-n">{agency.jobCount}</div>
        <div className="oa-jobs-t">在招岗位</div>
        <div className="oa-jobs-t">岗位咨询请到店办理</div>
      </div>
    </article>
  )
}

// ── 空态 ─────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="jf-notice" style={{ justifyContent: 'center', padding: '48px 20px', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <BuildingIcon style={{ width: 56, height: 56, opacity: 0.3 }} aria-hidden="true" />
      <b style={{ fontSize: 22, color: 'var(--ink)' }}>暂无线下招聘机构信息</b>
      <span style={{ fontSize: 18 }}>尝试调整筛选条件，或稍后再查看</span>
    </div>
  )
}

// ── 主页面 ───────────────────────────────────────────────────
export function OfflineAgenciesPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<OfflineAgencyListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [district, setDistrict] = useState('全部')
  const [service, setService] = useState('全部')
  const [page, setPage] = useState(1)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getOfflineAgencies({
      district: district === '全部' ? undefined : district,
      service: service === '全部' ? undefined : service,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((res) => { if (!cancelled) { setData(res); setLoading(false) } })
      .catch(() => {
        if (cancelled) return
        setError('后端服务未连接，请检查 API 服务（VITE_API_MODE=http 需后端在线）')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [district, service, page, retryKey])

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  return (
    <KioskPageFrame
      tone="clay"
      title="线下招聘机构"
      subtitle="合作人力资源机构门店 · 岗位咨询与应聘到店办理"
      backLabel="返回岗位信息"
      onBack={() => navigate('/jobs')}
      badge={<FusionBadge icon={ShieldCheckIcon}>机构资质核验后收录</FusionBadge>}
    >
      {/* 区域筛选 */}
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
        <button type="button" className="oa-search-btn">
          <SearchIcon aria-hidden="true" />
          搜索机构名称
        </button>
      </div>

      {/* 服务类型筛选 */}
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

      {loading ? (
        <LoadingState className="flex-1" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setRetryKey((k) => k + 1)} className="flex-1" />
      ) : !data ? null : (
        <>
          {/* 统计带 */}
          <StatsBand stats={data.stats} />

          {/* 列表元信息 */}
          <div className="jf-list-meta">
            <span>共 <b>{data.total}</b> 家合作机构 · 机构资质核验后收录</span>
            <span style={{ marginLeft: 'auto', fontSize: 18, color: 'var(--muted)' }}>
              按直线距离由近到远 · 服务时间由机构提供，节假日可能调整
            </span>
          </div>

          {/* 机构列表 */}
          {data.items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="jf-list">
              {data.items.map((agency) => (
                <AgencyRow key={agency.id} agency={agency} />
              ))}
            </div>
          )}

          {/* 分页 */}
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

          {/* 合规提示 */}
          <FusionNotice>
            线下机构岗位的咨询与应聘请前往机构门店办理；本终端不代收简历、不代收任何费用，机构服务项目与收费以门店依法公示为准，请勿支付押金或未公示费用。
          </FusionNotice>
        </>
      )}
    </KioskPageFrame>
  )
}

export default OfflineAgenciesPage
