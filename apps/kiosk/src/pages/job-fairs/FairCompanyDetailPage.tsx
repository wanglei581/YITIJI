import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import type { FairCompanyDTO } from '@ai-job-print/shared'
import { BuildingIcon, ExternalLinkIcon, QrCodeIcon } from 'lucide-react'
import { getFairCompanyById, prepareFairCompanyPrint } from '../../services/api'
import { API_MODE } from '../../services/api/client'
import { recordExternalJump } from '../../services/api/activity'
import { SOURCE_APPLY_UNAVAILABLE_REASON } from '../../lib/capabilityReasons'
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
  type ViewMode,
} from './components/FairCompanyDetailSections'
import { FusionBadge, FusionNotice, KioskPageFrame } from '../jobs/components/W4Presentation'

function formatSize(bytes: number): string {
  const kb = Math.max(1, Math.round(bytes / 1024))
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`
}

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
  const [printing,   setPrinting]   = useState<'profile' | 'positions' | null>(null)
  const [printError, setPrintError] = useState<string | null>(null)
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
  // 打印文件由后端按库内展示数据实时渲染成短期 FileObject，前端只消费真实的
  // fileId / printFileUrl / pageCount；不再自造没有 fileUrl 的假 PrintFile
  // （那会让 PrintPreviewPage 判定 unavailable，点了永远不出纸）。
  // 这里原来算了 returnUrl / returnLabel 传给 `/print/preview`，但打印链路
  // 从头到尾没有消费点：`PrintPreviewPage` 的 LocationState 只有
  // {file, materialCheck?, source?}，且它往下游只显式转发这几个键，
  // 所以这两个值连传都传不过去。删掉，不留「返回路径已经接好了」的假象。
  // mock 模式没有后端渲染能力，按钮如实置灰，而不是点了没反应
  const printBackendReady = API_MODE === 'http'

  const runPrint = async (variant: 'profile' | 'positions') => {
    if (!company || printing) return
    setPrinting(variant)
    setPrintError(null)
    try {
      const printable = await prepareFairCompanyPrint(fairId, company.id, variant)
      if (!printable.printFileUrl) throw new Error('打印链接未就绪')
      navigate('/print/preview', {
        state: {
          file: {
            name:     printable.filename,
            size:     formatSize(printable.sizeBytes),
            pages:    printable.pageCount > 0 ? printable.pageCount : null,
            fileId:   printable.fileId,
            fileUrl:  printable.printFileUrl,
            mimeType: printable.mimeType,
          },
        },
      })
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : '打印文件准备失败，请稍后重试')
    } finally {
      setPrinting(null)
    }
  }

  const handlePrintProfile   = () => { void runPrint('profile') }
  const handlePrintPositions = () => { void runPrint('positions') }

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
    <KioskPageFrame
      tone="wheat"
      title={company.companyName}
      subtitle={`展位 ${company.boothNumber ?? '—'} · ${company.industry}`}
      backLabel="返回列表"
      onBack={() => navigate(`/job-fairs/${fairId}/companies`)}
      badge={<FusionBadge icon={BuildingIcon}>{company.positions.length} 个岗位</FusionBadge>}
      actionBar={
        <>
          <button type="button" className="jf-btn ghost" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>
            返回列表
          </button>
          {isValidSourceUrl(company.sourceUrl) ? null : (
            <span id="fair-company-bar-blocked" className="jf-action-note">
              {SOURCE_APPLY_UNAVAILABLE_REASON}
            </span>
          )}
          <div className="jf-spacer" />
          {/* 能力门禁：aria-disabled + 上面那句常显原因。原生 disabled 会让读屏跳过按钮，
              触屏又没有 hover，用户就完全拿不到「为什么灰」。放行由 openApplyQr 内部
              的 `if (!company || !isValidSourceUrl(company.sourceUrl)) return` 兜底。 */}
          <button
            type="button"
            className="jf-btn primary"
            aria-disabled={!isValidSourceUrl(company.sourceUrl) || undefined}
            aria-describedby={isValidSourceUrl(company.sourceUrl) ? undefined : 'fair-company-bar-blocked'}
            onClick={openApplyQr}
          >
            <QrCodeIcon aria-hidden="true" />
            扫码投递
          </button>
          <button
            type="button"
            className="jf-btn dark"
            aria-disabled={!isValidSourceUrl(company.sourceUrl) || undefined}
            aria-describedby={isValidSourceUrl(company.sourceUrl) ? undefined : 'fair-company-bar-blocked'}
            onClick={openApplyQr}
          >
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

        {printError && (
          <p className="rounded-lg bg-error-bg px-5 py-4 text-[18px] text-error-fg">{printError}</p>
        )}

        <ActionBar
          sourceCanApply={isValidSourceUrl(company.sourceUrl)}
          onScanQr={openApplyQr}
          onOpenSource={openApplyQr}
          onPrintProfile={handlePrintProfile}
          onPrintPositions={handlePrintPositions}
          printing={printing}
          canPrintProfile={printBackendReady}
          canPrintPositions={printBackendReady && company.positions.length > 0}
          printDisabledHint={
            !printBackendReady
              ? '演示模式未接入后端，无法生成真实企业资料文件'
              : '该企业暂无可打印的岗位信息'
          }
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

        <FusionNotice>
          {company.applyNote}。本系统仅展示招聘会现场企业与岗位信息，不接收简历，不参与招聘闭环。
          如需投递请扫码前往来源平台或现场前往展位咨询。
        </FusionNotice>
    </KioskPageFrame>
  )
}
