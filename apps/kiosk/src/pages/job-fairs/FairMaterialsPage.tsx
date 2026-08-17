import { useEffect, useState } from 'react'

import { useNavigate, useParams } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import type { FairMaterialDTO, ExternalJobFairDTO } from '@ai-job-print/shared'
import type { FairMaterialType } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import { FAIR_MATERIAL_TYPE_LABELS } from '../../types/fair'
import { BriefcaseIcon, CalendarIcon, FileTextIcon, MapIcon, MapPinIcon, NewspaperIcon, PrinterIcon } from 'lucide-react'
import { getFairMaterials, getJobFairById, prepareFairMaterialPrint } from '../../services/api'
import { DEMO_MODE_NO_REAL_FILE_REASON } from '../../lib/capabilityReasons'
import { API_MODE } from '../../services/api/client'
import { FusionBadge, FusionNotice, FusionSectionHead, FusionSourceMeta, FusionStepStrip, KioskPageFrame } from '../jobs/components/W4Presentation'

function formatSize(kb: number) {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`
}

/** Material type → CSS variant class */
const MTYPE_CLASS: Record<FairMaterialType, string> = {
  schedule:      'sch',
  venue_map:     'map',
  company_list:  'co',
  position_list: 'pos',
  brochure:      'bro',
  other:         'bro',
}

/** Material type → icon component */
function MaterialIcon({ type }: { type: FairMaterialType }) {
  switch (type) {
    case 'schedule':      return <CalendarIcon aria-hidden="true" />
    case 'venue_map':     return <MapIcon aria-hidden="true" />
    case 'company_list':  return <NewspaperIcon aria-hidden="true" />
    case 'position_list': return <BriefcaseIcon aria-hidden="true" />
    case 'brochure':      return <FileTextIcon aria-hidden="true" />
    default:              return <MapPinIcon aria-hidden="true" />
  }
}

export function FairMaterialsPage() {
  const navigate = useNavigate()
  const { id }   = useParams<{ id: string }>()
  const fairId   = id ?? ''

  const [fair,      setFair]      = useState<ExternalJobFairDTO | null>(null)
  const [materials, setMaterials] = useState<FairMaterialDTO[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(false)
  const [printingId, setPrintingId] = useState<string | null>(null)
  const [printError, setPrintError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([getJobFairById(fairId), getFairMaterials(fairId)])
      .then(([fairRes, matsRes]) => {
        if (cancelled) return
        setFair(fairRes.data)
        setMaterials(matsRes.data)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId])

  // 打印时由后端按需把 FairMaterial 转为短期 FileObject，只消费内部 HMAC printFileUrl。
  const handlePrint = async (material: FairMaterialDTO) => {
    if (printingId) return
    setPrintingId(material.id)
    setPrintError(null)
    try {
      const printable = await prepareFairMaterialPrint(fairId, material.id)
      if (!printable.printFileUrl) throw new Error('打印链接未就绪')
      navigate('/print/confirm', {
        state: {
          file: {
            name: printable.filename,
            size: formatSize(Math.max(1, Math.round(printable.sizeBytes / 1024))),
            pages: printable.pageCount > 0 ? printable.pageCount : null,
            fileId: printable.fileId,
            fileUrl: printable.printFileUrl,
            mimeType: printable.mimeType,
          },
          params: makePrintParams({
            copies: 1,
            duplex: printable.pageCount > 1 ? 'double' : 'single',
            color: 'bw',
          }),
        },
      })
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : '打印文件准备失败，请稍后重试')
    } finally {
      setPrintingId(null)
    }
  }

  if (loading) {
    return <LoadingState className="h-full" />
  }

  return (
    <KioskPageFrame
      tone="wheat"
      title="活动资料"
      subtitle={fair ? `${fair.name} · ${materials.length} 份资料` : `${materials.length} 份资料`}
      backLabel="返回详情"
      onBack={() => navigate(`/job-fairs/${fairId}`)}
      badge={<FusionBadge icon={FileTextIcon}>活动资料</FusionBadge>}
      actionBar={
        <>
          <button type="button" className="jf-btn ghost" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>
            参会企业
          </button>
          <div className="jf-spacer" />
          <button type="button" className="jf-btn dark" onClick={() => navigate(`/job-fairs/${fairId}`)}>
            查看招聘会
          </button>
        </>
      }
    >
        {printError && (
          <p className="rounded-lg bg-error-bg px-5 py-4 text-[18px] text-error-fg">
            {printError}
          </p>
        )}

        {error ? (
          <ErrorState message="加载失败，请稍后重试" className="flex-1" />
        ) : materials.length === 0 ? (
          <EmptyState icon={FileTextIcon} title="暂无可用活动资料" className="flex-1" />
        ) : (
          <section className="jf-list">
            {materials.map((mat) => {
              const isPreparingThis = printingId === mat.id
              const canPrint = mat.allowPrint && API_MODE === 'http' && !printingId
              const printLabel = isPreparingThis
                ? '正在准备打印文件…'
                : API_MODE !== 'http'
                  ? '暂不可打印'
                  : `打印(${mat.pageCount} 页)`

              return (
                <div
                  key={mat.id}
                  className={`jf-row align-start${!mat.allowPrint ? ' off' : ''}`}
                >
                  <span className="jf-company-icon">
                    <MaterialIcon type={mat.type} />
                  </span>
                  <div className="jf-row-main">
                    <div className="jf-row-title">
                      <b>{mat.name}</b>
                      <span className={`jf-mtype ${MTYPE_CLASS[mat.type]}`}>
                        {FAIR_MATERIAL_TYPE_LABELS[mat.type]}
                      </span>
                    </div>
                    {mat.description && (
                      <p className="mt-1.5 text-[17px] leading-snug text-[var(--muted)]">{mat.description}</p>
                    )}
                    <div className="jf-row-info">
                      <span>
                        <FileTextIcon aria-hidden="true" />
                        {mat.pageCount} 页 · {formatSize(mat.fileSizeKB)}
                      </span>
                      {/*
                        2026-08-11（CLAUDE.md §9）：原为「已打印 {mat.printCount} 次」。
                        FairMaterial.printCount 全后端**没有出纸完成后递增的写路径**
                        （资料转打印文件时只更新桥接记录 fair-material-print-bridge.service.ts:82），
                        故恒为 0——对求职者显示「已打印 0 次」既不实也无决策价值，直接移除。
                        恢复条件：打印完成回调中递增该字段后，方可重新展示。
                      */}
                    </div>
                  </div>
                  {mat.allowPrint ? (
                    <div className="flex-none self-center text-right">
                      {/* printingId 是瞬时态（保留原生 disabled）；演示模式没有后端是能力门禁，
                          改 aria-disabled + 常显原因 —— 原来只写在 title 里，触屏读不到。 */}
                      <button
                        type="button"
                        className="jf-btn sm ghost"
                        disabled={printingId !== null}
                        aria-disabled={API_MODE !== 'http' || undefined}
                        aria-describedby={API_MODE !== 'http' ? `fair-material-blocked-${mat.id}` : undefined}
                        onClick={() => { if (canPrint) handlePrint(mat) }}
                      >
                        {printLabel}
                      </button>
                      {API_MODE !== 'http' ? (
                        <span id={`fair-material-blocked-${mat.id}`} className="jf-blocked-reason">
                          {DEMO_MODE_NO_REAL_FILE_REASON}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="flex-none self-center text-[18px] text-[var(--muted)]">
                      该资料暂不开放打印
                    </span>
                  )}
                </div>
              )
            })}
          </section>
        )}

      <section className="jf-card accented">
        <FusionSectionHead icon={PrinterIcon} title="如何打印" subtitle="三步完成" />
        <FusionStepStrip
          steps={[
            { title: '选择一份资料', desc: '点击对应资料的「打印」' },
            { title: '确认打印参数', desc: '黑白 / 双面等参数已按推荐预设' },
            { title: '取纸', desc: '在出纸口领取，注意保管个人物品' },
          ]}
        />
      </section>

      {fair && (
        <FusionSourceMeta
          sourceName={fair.sourceName}
          syncTime={fair.syncTime ?? fair.startTime}
          externalId={fair.externalId}
        />
      )}

      <FusionNotice>
        资料由主办方 / 机构上传；标记为可打印的资料可在本机打印，费用以下单时报价为准，实际页数以文件为准。
      </FusionNotice>
    </KioskPageFrame>
  )
}
