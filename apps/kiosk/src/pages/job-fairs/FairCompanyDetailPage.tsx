import { useEffect, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import type { FairCompanyDTO } from '@ai-job-print/shared'
import { COMPANY_SCALE_LABELS } from '../../types/fair'
import {
  BriefcaseIcon,
  BuildingIcon,
  InfoIcon,
  MapPinIcon,
  QrCodeIcon,
  SmartphoneIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react'
import { getFairCompanyById } from '../../services/api'

// ─── QR overlay ───────────────────────────────────────────────────────────────

function QrOverlay({ companyName, onClose }: { companyName: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="relative w-80 rounded-2xl bg-white p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100"
        >
          <XIcon className="h-5 w-5" />
        </button>
        <p className="text-center text-base font-semibold text-gray-800">来源平台二维码</p>
        <p className="mt-1 text-center text-xs text-gray-400">{companyName}</p>
        <div className="mx-auto mt-5 flex h-44 w-44 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50">
          <div className="flex flex-col items-center gap-2 text-gray-300">
            <QrCodeIcon className="h-16 w-16" />
            <span className="text-xs">二维码由来源平台生成</span>
          </div>
        </div>
        <div className="mt-5 flex items-start gap-2">
          <SmartphoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
          <p className="text-xs leading-relaxed text-gray-500">
            请使用手机扫描二维码，前往来源平台查看岗位详情。本系统不接收简历，不参与招聘闭环。
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FairCompanyDetailPage() {
  const navigate  = useNavigate()
  const { id, companyId } = useParams<{ id: string; companyId: string }>()
  const location  = useLocation()
  const fairId    = id ?? ''

  const stateCompany  = (location.state as { company?: FairCompanyDTO } | null)?.company
  const hasStateMatch = stateCompany?.id === companyId

  const [company, setCompany] = useState<FairCompanyDTO | null>(hasStateMatch ? stateCompany! : null)
  const [loading, setLoading] = useState(!hasStateMatch)
  const [error,   setError]   = useState(false)
  const [showQr,  setShowQr]  = useState(false)

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

  const totalHeadcount = company.positions.reduce((s, p) => s + p.headcount, 0)

  return (
    <div className="flex h-full flex-col">
      {showQr && (
        <QrOverlay companyName={company.companyName} onClose={() => setShowQr(false)} />
      )}

      <div className="px-6 pt-6">
        <PageHeader
          title={company.companyName}
          subtitle={`${company.industry} · ${COMPANY_SCALE_LABELS[company.scale]}`}
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>
              返回列表
            </Button>
          }
        />
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        {/* 基本信息 */}
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-700">
            {company.boothNumber && (
              <span className="flex items-center gap-1.5">
                <MapPinIcon className="h-4 w-4 text-gray-400" />
                展位 {company.boothNumber}
                {company.zoneName && <span className="text-gray-400">（{company.zoneName}）</span>}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <UsersIcon className="h-4 w-4 text-gray-400" />
              招聘 {totalHeadcount} 人 · {company.positions.length} 个岗位
            </span>
          </div>
          {company.description && (
            <p className="mt-3 text-sm leading-relaxed text-gray-600">{company.description}</p>
          )}
        </Card>

        {/* 招聘岗位（展示用） */}
        <div>
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <BriefcaseIcon className="h-4 w-4 text-gray-400" />
            招聘岗位（{company.positions.length} 个）
          </h3>
          <div className="space-y-3">
            {company.positions.map((pos) => (
              <Card key={pos.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-900">{pos.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span>招聘 {pos.headcount} 人</span>
                      {pos.salary && (
                        <>
                          <span className="text-gray-300">·</span>
                          <span className="text-green-600">{pos.salary}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {pos.requirements && (
                  <p className="mt-2 text-xs leading-relaxed text-gray-500">{pos.requirements}</p>
                )}
              </Card>
            ))}
          </div>
        </div>

        {/* 合规说明 */}
        <div className="flex items-start gap-2 rounded-lg bg-gray-50 px-4 py-3">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
          <p className="text-xs leading-relaxed text-gray-400">
            {company.applyNote}。本系统仅展示岗位信息，不接收简历，不参与招聘闭环。
          </p>
        </div>
      </div>

      <div className="px-6 pb-6 pt-2">
        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" onClick={() => setShowQr(true)} className="flex items-center gap-2">
            <QrCodeIcon className="h-4 w-4" />
            扫码查看来源平台
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => navigate(`/job-fairs/${fairId}/companies`)}
          >
            查看其他企业
          </Button>
        </div>
      </div>
    </div>
  )
}
