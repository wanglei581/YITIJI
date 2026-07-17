import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import type { FairCompanyDTO } from '@ai-job-print/shared'
import { BuildingIcon, ExternalLinkIcon, QrCodeIcon } from 'lucide-react'
import { getFairCompanyById } from '../../services/api'
import { recordExternalJump } from '../../services/api/activity'
import { isValidSourceUrl } from '../../lib/url'
import { useAuth } from '../../auth/useAuth'
import {
  ActionBar,
  CompanyInfoCard,
  CoverArea,
  FilterBar,
  PositionListView,
  PositionPosterView,
  QrOverlay,
  type Filters,
  type PrintFile,
  type ViewMode,
} from './components/FairCompanyDetailSections'
import { ProtoBadge, ProtoNotice, ProtoPage } from '../jobs-fairs-prototype'

// ─── Main page ────────────────────────────────────────────────────────────────

export function FairCompanyDetailPage() {
  const navigate = useNavigate()
  const { id, companyId } = useParams<{ id: string; companyId: string }>()
  const location = useLocation()
  const { getToken } = useAuth()
  const fairId   = id ?? ''

  const stateCompany  = (location.state as { company?: FairCompanyDTO } | null)?.company
  const hasStateMatch = stateCompany?.id === companyId

  const [company,  setCompany]  = useState<FairCompanyDTO | null>(hasStateMatch ? stateCompany! : null)
  const [loading,  setLoading]  = useState(!hasStateMatch)
  const [error,    setError]    = useState(false)
  const [showQr,   setShowQr]   = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [filters,  setFilters]  = useState<Filters>({
    location:     '不限',
    education:    '不限',
    experience:   '不限',
    positionType: '不限',
  })

  useEffect(() => {
    if (hasStateMatch) return
    let cancelled = false
    getFairCompanyById(fairId, companyId!)
      .then((res) => {
        if (cancelled) return
        if (res.data) setCompany(res.data)
        else setError(true)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId, companyId, hasStateMatch])

  const filteredPositions = useMemo(() => {
    if (!company) return []
    return company.positions.filter((pos) => {
      const okLocation    = filters.location === '不限' || pos.location === filters.location
      const okEducation   = filters.education === '不限' || !pos.education || pos.education === filters.education
      const okExperience  = filters.experience === '不限' || !pos.experience || pos.experience === filters.experience
      const okType        = filters.positionType === '不限' || pos.positionType === filters.positionType
      return okLocation && okEducation && okExperience && okType
    })
  }, [company, filters])

  const handleFilter = (patch: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...patch }))
  const clearFilters = () => setFilters({ location: '不限', education: '不限', experience: '不限', positionType: '不限' })
  const isFiltered   = Object.values(filters).some((v) => v !== '不限')

  // ── Print handlers ─────────────────────────────────────────────────────────
  const returnUrl   = company ? `/job-fairs/${fairId}/companies/${companyId}` : undefined
  const returnLabel = company?.companyName

  const handlePrintProfile = () => {
    if (!company) return
    const file: PrintFile = {
      name:  `${company.companyName}_企业资料.pdf`,
      size:  '约 120 KB',
      pages: 1 + Math.ceil(company.positions.length / 8),
    }
    navigate('/print/preview', { state: { file, returnUrl, returnLabel } })
  }

  const handlePrintPositions = () => {
    if (!company) return
    const file: PrintFile = {
      name:  `${company.companyName}_岗位清单.pdf`,
      size:  `约 ${Math.max(40, company.positions.length * 15)} KB`,
      pages: Math.max(1, Math.ceil(company.positions.length / 4)),
    }
    navigate('/print/preview', { state: { file, returnUrl, returnLabel } })
  }

  const openApplyQr = () => {
    if (!company || !isValidSourceUrl(company.sourceUrl)) return
    recordExternalJump(getToken(), 'fair_company', company.id, 'external_apply')
    setShowQr(true)
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-neutral-400">加载中...</p>
      </div>
    )
  }

  if (error || !company) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <BuildingIcon className="h-12 w-12 text-neutral-200" />
        <p className="text-sm text-neutral-400">企业数据未找到</p>
        <button type="button" className="jf-btn sm ghost" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>
          返回企业列表
        </button>
      </div>
    )
  }

  return (
    <ProtoPage
      tone="wheat"
      title={company.companyName}
      subtitle={`展位 ${company.boothNumber ?? '—'} · ${company.industry}`}
      backLabel="返回列表"
      onBack={() => navigate(`/job-fairs/${fairId}/companies`)}
      badge={<ProtoBadge icon={BuildingIcon}>{company.positions.length} 个岗位</ProtoBadge>}
      actionBar={
        <>
          <button type="button" className="jf-btn ghost" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>
            返回列表
          </button>
          <div className="jf-spacer" />
          <button type="button" className="jf-btn primary" disabled={!isValidSourceUrl(company.sourceUrl)} onClick={openApplyQr}>
            <QrCodeIcon aria-hidden="true" />
            扫码投递
          </button>
          <button type="button" className="jf-btn dark" disabled={!isValidSourceUrl(company.sourceUrl)} onClick={openApplyQr}>
            <ExternalLinkIcon aria-hidden="true" />
            去来源平台投递
          </button>
        </>
      }
    >
      {showQr && <QrOverlay companyName={company.companyName} sourceUrl={company.sourceUrl} onClose={() => setShowQr(false)} />}

      {/* Cover */}
      <CoverArea company={company} />

      {/* Content */}
        <CompanyInfoCard company={company} />
        <ActionBar
          sourceCanApply={isValidSourceUrl(company.sourceUrl)}
          onScanQr={openApplyQr}
          onOpenSource={openApplyQr}
          onPrintProfile={handlePrintProfile}
          onPrintPositions={handlePrintPositions}
        />

        <FilterBar
          positions={company.positions}
          filters={filters}
          viewMode={viewMode}
          onFilter={handleFilter}
          onViewMode={setViewMode}
        />

        <div className="flex items-center justify-between text-sm">
          <p className="font-medium text-neutral-700">
            招聘岗位
            <span className="ml-1.5 text-neutral-400">
              ({filteredPositions.length} / {company.positions.length})
            </span>
          </p>
          {isFiltered && (
            <button onClick={clearFilters} className="text-xs text-primary-600 hover:underline">
              清除筛选
            </button>
          )}
        </div>

        {viewMode === 'list' ? (
          <PositionListView positions={filteredPositions} companyName={company.companyName} />
        ) : (
          <PositionPosterView positions={filteredPositions} companyName={company.companyName} industry={company.industry} />
        )}

        <ProtoNotice>
          {company.applyNote}。本系统仅展示招聘会现场企业与岗位信息，不接收简历，不参与招聘闭环。
          如需投递请扫码前往来源平台或现场前往展位咨询。
        </ProtoNotice>
    </ProtoPage>
  )
}
