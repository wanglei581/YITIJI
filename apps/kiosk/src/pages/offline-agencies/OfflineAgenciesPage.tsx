import { type FormEvent, useEffect, useState } from 'react'
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

// ── 机构卡片 ─────────────────────────────────────────────────
function AgencyRow({ agency }: { agency: OfflineAgencyDTO }) {
  return (
    <article className="jf-row oa-agency-row" aria-label={agency.name}>
      <span className="oa-ag-logo" aria-hidden="true">
        <BuildingIcon />
      </span>
      <div className="jf-row-main">
        <div className="jf-row-title">
          <b>{agency.name}</b>
          <span className="oa-st rest">
            机构信息已发布
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
          {agency.services.map((svc) => (
            <span key={svc} className="jf-chip">{svc}</span>
          ))}
          {agency.services.length === 0 && <span className="jf-chip">服务项目以机构公示为准</span>}
          {agency.orgCode && <span className="jf-chip src">来源机构编号 {agency.orgCode}</span>}
        </div>
      </div>
      <div className="oa-r-aside">
        <div className="oa-jobs-t">到店咨询</div>
        <div className="oa-jobs-t">岗位咨询请到店办理</div>
        <div className="oa-jobs-t">服务时间以机构公示为准</div>
      </div>
    </article>
  )
}

// ── 空态 ─────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="oa-empty" role="status">
      <BuildingIcon aria-hidden="true" />
      <b>暂无线下招聘机构信息</b>
      <span>尝试调整筛选条件，或稍后再查看</span>
    </div>
  )
}

// ── 主页面 ───────────────────────────────────────────────────
export function OfflineAgenciesPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<OfflineAgencyListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getOfflineAgencies({
      keyword: keyword || undefined,
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
  }, [keyword, page, retryKey])

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextKeyword = searchInput.trim()
    setPage(1)
    if (nextKeyword === keyword) {
      setRetryKey((value) => value + 1)
      return
    }
    setKeyword(nextKeyword)
  }

  const clearSearch = () => {
    setSearchInput('')
    setKeyword('')
    setPage(1)
  }

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0

  return (
    <KioskPageFrame
      tone="clay"
      title="线下招聘机构"
      subtitle="合作人力资源机构门店 · 岗位咨询与应聘到店办理"
      backLabel="返回岗位信息"
      onBack={() => navigate('/jobs')}
      badge={<FusionBadge icon={ShieldCheckIcon}>机构资质核验后收录</FusionBadge>}
    >
      {/* 机构搜索：只使用后端已有 keyword 能力，不虚构区域选项。 */}
      <div className="jf-filter-bar">
        <span className="jf-filter-label">区域</span>
        <span className="jf-f-chip on">全部区域</span>
        <form className="oa-search-btn flex-wrap" role="search" onSubmit={handleSearch}>
          <SearchIcon aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索机构名称"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="输入机构名称"
            className="min-h-12 w-[230px] min-w-[140px] flex-1 bg-transparent text-[21px] outline-none placeholder:text-[var(--muted)]"
          />
          {keyword && (
            <button type="button" className="jf-btn ghost sm" onClick={clearSearch}>
              清除搜索
            </button>
          )}
          <button type="submit" className="jf-btn dark sm">搜索</button>
        </form>
      </div>

      {loading ? (
        <LoadingState className="flex-1" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setRetryKey((k) => k + 1)} className="flex-1" />
      ) : !data ? null : (
        <>
          {/* 列表元信息 */}
          <div className="jf-list-meta">
            <span>
              共 <b>{data.total}</b> 家合作机构 · 机构资质核验后收录
              {keyword && <> · 当前搜索“{keyword}”</>}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 18, color: 'var(--muted)' }}>
              服务项目与时间由机构提供，以机构公示为准
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
