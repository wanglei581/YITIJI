import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Button, PageHeader } from '@ai-job-print/ui'
import type { FairCompanyDTO } from '@ai-job-print/shared'
import { BuildingIcon, InfoIcon } from 'lucide-react'
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
        <p className="text-sm text-gray-400">加载中...</p>
      </div>
    )
  }

  if (error || !company) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <BuildingIcon className="h-12 w-12 text-gray-200" />
        <p className="text-sm text-gray-400">企业数据未找到</p>
        <Button variant="secondary" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>
          返回企业列表
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      {showQr && <QrOverlay companyName={company.companyName} sourceUrl={company.sourceUrl} onClose={() => setShowQr(false)} />}

      {/* Page header */}
      <div className="border-b border-gray-100 bg-white px-6 pt-4 pb-3">
        <PageHeader
          title={company.companyName}
          subtitle={`展位 ${company.boothNumber ?? '—'} · ${company.industry}`}
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>
              返回列表
            </Button>
          }
        />
      </div>

      {/* Cover */}
      <CoverArea company={company} />

      {/* Content */}
      <div className="flex flex-1 flex-col gap-4 px-6 py-5 pb-8">
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
          <p className="font-medium text-gray-700">
            招聘岗位
            <span className="ml-1.5 text-gray-400">
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

        {/* Compliance footer */}
        <div className="flex items-start gap-2 rounded-lg bg-gray-50 px-4 py-3">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
          <p className="text-xs leading-relaxed text-gray-400">
            {company.applyNote}。本系统仅展示招聘会现场企业与岗位信息，不接收简历，不参与招聘闭环。
            如需投递请扫码前往来源平台或现场前往展位咨询。
          </p>
        </div>
      </div>
    </div>
  )
}
