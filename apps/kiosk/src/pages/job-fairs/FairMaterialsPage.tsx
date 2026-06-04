import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { FairMaterialDTO, ExternalJobFairDTO } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import { FAIR_MATERIAL_TYPE_LABELS } from '../../types/fair'
import { FileTextIcon, PrinterIcon } from 'lucide-react'
import { getFairMaterials, getJobFairById } from '../../services/api'

const TYPE_STYLES: Record<string, string> = {
  schedule:     'bg-blue-50 text-blue-600',
  venue_map:    'bg-teal-50 text-teal-600',
  company_list: 'bg-purple-50 text-purple-600',
  position_list:'bg-green-50 text-green-600',
  brochure:     'bg-orange-50 text-orange-600',
  other:        'bg-gray-100 text-gray-500',
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

  const handlePrint = (material: FairMaterialDTO) => {
    navigate('/print/confirm', {
      state: {
        file: { name: material.name, size: formatSize(material.fileSizeKB), pages: material.pageCount },
        params: makePrintParams({
          copies: 1,
          duplex: material.pageCount > 1 ? 'double' : 'single',
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
        <p className="mt-2 text-xs text-gray-400">
          所有资料均可免费打印，请按需取用，节约纸张
        </p>
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
                    <p className="font-semibold text-gray-900">{mat.name}</p>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${TYPE_STYLES[mat.type] ?? TYPE_STYLES.other}`}>
                      {FAIR_MATERIAL_TYPE_LABELS[mat.type]}
                    </span>
                  </div>
                  {mat.description && (
                    <p className="mt-1 text-xs text-gray-500">{mat.description}</p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-500">
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
                  onClick={() => handlePrint(mat)}
                >
                  <PrinterIcon className="h-4 w-4" />
                  免费打印（{mat.pageCount} 页）
                </Button>
              ) : (
                <p className="mt-4 text-center text-xs text-gray-400">该资料暂不开放打印</p>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
