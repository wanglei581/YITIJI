import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import type { FairMaterialDTO, ExternalJobFairDTO } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import { FAIR_MATERIAL_TYPE_LABELS } from '../../types/fair'
import { FileTextIcon, PrinterIcon } from 'lucide-react'
import { getFairMaterials, getJobFairById, prepareFairMaterialPrint } from '../../services/api'
import { API_MODE } from '../../services/api/client'
import { CardHead, ProtoBadge, ProtoNotice, ProtoPage, ProtoStepStrip } from '../jobs-fairs-prototype'

function formatSize(kb: number) {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`
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
    <ProtoPage
      tone="wheat"
      title="活动资料"
      subtitle={fair ? `${fair.name} · ${materials.length} 份资料` : `${materials.length} 份资料`}
      backLabel="返回详情"
      onBack={() => navigate(`/job-fairs/${fairId}`)}
      badge={<ProtoBadge icon={FileTextIcon}>免费打印</ProtoBadge>}
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
            {materials.map((mat) => (
              <div key={mat.id} className="jf-row align-start">
                <span className="jf-company-icon">
                  <FileTextIcon aria-hidden="true" />
                </span>
                <div className="jf-row-main">
                  <div className="jf-row-title">
                    <b>{mat.name}</b>
                    <span className="jf-kind">{FAIR_MATERIAL_TYPE_LABELS[mat.type]}</span>
                  </div>
                  {mat.description && (
                    <p className="mt-2 text-[18px] leading-relaxed text-[var(--muted)]">{mat.description}</p>
                  )}
                  <div className="jf-row-info">
                    <span>
                      <FileTextIcon aria-hidden="true" />
                      {mat.pageCount} 页 · {formatSize(mat.fileSizeKB)}
                    </span>
                    <span>
                      <PrinterIcon aria-hidden="true" />
                      已打印 {mat.printCount} 次
                    </span>
                  </div>
                </div>
                {mat.allowPrint ? (
                  <button
                    type="button"
                    className="jf-btn sm dark"
                    disabled={API_MODE !== 'http' || printingId !== null}
                    title={API_MODE !== 'http' ? '演示模式未生成真实招聘会资料文件，暂不可打印' : undefined}
                    onClick={() => handlePrint(mat)}
                  >
                    <PrinterIcon aria-hidden="true" />
                    {printingId === mat.id ? '准备中' : API_MODE !== 'http' ? '暂不可打印' : '免费打印'}
                  </button>
                ) : (
                  <span className="jf-chip">暂不开放打印</span>
                )}
              </div>
            ))}
          </section>
        )}

      <section className="jf-card accented">
        <CardHead icon={PrinterIcon} title="打印说明" subtitle="按需选择资料，减少重复打印" />
        <ProtoStepStrip
          steps={[
            { title: '选择资料', desc: '查看页数和文件大小' },
            { title: '确认打印', desc: '进入打印确认页设置份数' },
            { title: '现场取件', desc: '按屏幕提示在设备处取件' },
          ]}
        />
      </section>

      <ProtoNotice>资料来自招聘会公开信息或合作机构配置，仅供现场参会准备参考。</ProtoNotice>
    </ProtoPage>
  )
}
