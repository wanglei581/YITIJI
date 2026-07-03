import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { FairMaterialDTO, ExternalJobFairDTO } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import { FAIR_MATERIAL_TYPE_LABELS } from '../../types/fair'
import { FileTextIcon, PrinterIcon } from 'lucide-react'
import { getFairMaterials, getJobFairById } from '../../services/api'

const TYPE_STYLES: Record<string, string> = {
  schedule:     'bg-primary-50 text-primary-600',
  venue_map:    'bg-primary-50 text-primary-600',
  company_list: 'bg-plum-soft text-plum',
  position_list:'bg-success-bg text-success-fg',
  brochure:     'bg-warning-bg text-warning-fg',
  other:        'bg-neutral-100 text-neutral-500',
}

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

  // 2B 安全收口:打印必须基于真实资料文件 —— 带上后端签名 previewUrl(30min TTL),
  // http 模式下创建真实打印任务;无签名 URL(mock 演示)时按钮降级为不可用。
  const handlePrint = async (material: FairMaterialDTO) => {
    if (printingId) return
    setPrintingId(material.id)
    setPrintError(null)
    let latest = material
    try {
      const refreshed = await getFairMaterials(fairId)
      setMaterials(refreshed.data)
      latest = refreshed.data.find((item) => item.id === material.id) ?? material
    } catch {
      setPrintingId(null)
      setPrintError('文件链接刷新失败，请检查网络后重试')
      return
    }
    setPrintingId(null)
    if (!latest.previewUrl) return
    navigate('/print/confirm', {
      state: {
        file: {
          name: latest.name,
          size: formatSize(latest.fileSizeKB),
          pages: latest.pageCount > 0 ? latest.pageCount : null,
          fileUrl: latest.previewUrl,
          mimeType: 'application/pdf',
        },
        params: makePrintParams({
          copies: 1,
          duplex: latest.pageCount > 1 ? 'double' : 'single',
          color: 'bw',
        }),
      },
    })
  }

  if (loading) {
    return <LoadingState className="h-full" />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          title="活动资料"
          subtitle={
            fair
              ? `${fair.name} · ${materials.length} 份资料`
              : `${materials.length} 份资料`
          }
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate(`/job-fairs/${fairId}`)}>
              返回详情
            </Button>
          }
        />
        <p className="mt-2 text-xs text-neutral-400">
          所有资料均可免费打印，请按需取用，节约纸张
        </p>
        {printError && (
          <p className="mt-2 rounded-lg bg-error-bg px-3 py-2 text-xs text-error-fg">
            {printError}
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6">
        {error ? (
          <ErrorState message="加载失败，请稍后重试" className="flex-1" />
        ) : materials.length === 0 ? (
          <EmptyState icon={FileTextIcon} title="暂无可用活动资料" className="flex-1" />
        ) : (
          materials.map((mat) => (
            <Card key={mat.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-neutral-900">{mat.name}</p>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${TYPE_STYLES[mat.type] ?? TYPE_STYLES.other}`}>
                      {FAIR_MATERIAL_TYPE_LABELS[mat.type]}
                    </span>
                  </div>
                  {mat.description && (
                    <p className="mt-1 text-xs text-neutral-500">{mat.description}</p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-neutral-500">
                <span className="flex items-center gap-1">
                  <FileTextIcon className="h-3.5 w-3.5" />
                  {mat.pageCount} 页 · {formatSize(mat.fileSizeKB)}
                </span>
                <span className="flex items-center gap-1">
                  <PrinterIcon className="h-3.5 w-3.5" />
                  已打印 {mat.printCount} 次
                </span>
              </div>
              {mat.allowPrint ? (
                <Button
                  size="md"
                  className="mt-4 flex w-full items-center justify-center gap-2"
                  disabled={!mat.previewUrl || printingId !== null}
                  title={mat.previewUrl ? undefined : '演示数据无真实文件,接入后端后可打印'}
                  onClick={() => handlePrint(mat)}
                >
                  <PrinterIcon className="h-4 w-4" />
                  {printingId === mat.id ? '正在刷新文件链接…' : printingId ? '请稍候…' : mat.previewUrl ? `免费打印（${mat.pageCount > 0 ? `${mat.pageCount} 页` : '页数以文件为准'}）` : '演示数据暂不可打印'}
                </Button>
              ) : (
                <p className="mt-4 text-center text-xs text-neutral-400">该资料暂不开放打印</p>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
