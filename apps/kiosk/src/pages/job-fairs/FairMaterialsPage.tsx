import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { FairMaterialDTO, ExternalJobFairDTO } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import { FAIR_MATERIAL_TYPE_LABELS } from '../../types/fair'
import { FileTextIcon, PrinterIcon } from 'lucide-react'
import { getFairMaterials, getJobFairById } from '../../services/api'
const FAIR_MATERIAL_PAGE_SIZE = 100
// 熔断:坏后端把 totalPages 返回成超大值时,最多拉 50 页就停,避免一体机被拖死。
const MAX_FAIR_MATERIAL_PAGE_LOAD = 50

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

async function loadAllFairMaterials(fairId: string): Promise<FairMaterialDTO[]> {
  const all: FairMaterialDTO[] = []
  let page = 1
  let totalPages = 1
  do {
    const res = await getFairMaterials(fairId, { page, pageSize: FAIR_MATERIAL_PAGE_SIZE })
    const pageData = Array.isArray(res.data) ? res.data : []
    all.push(...pageData)
    totalPages = res.pagination?.totalPages ?? (pageData.length < FAIR_MATERIAL_PAGE_SIZE ? page : page + 1)
    page += 1
  } while (page <= totalPages && page <= MAX_FAIR_MATERIAL_PAGE_LOAD)
  return all
}

export function FairMaterialsPage() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { id }   = useParams<{ id: string }>()
  const fairId   = id ?? ''
  const detailPath = pathname.startsWith('/campus/') ? `/campus/${fairId}` : `/job-fairs/${fairId}`

  const [fair,      setFair]      = useState<ExternalJobFairDTO | null>(null)
  const [materials, setMaterials] = useState<FairMaterialDTO[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([getJobFairById(fairId), loadAllFairMaterials(fairId)])
      .then(([fairRes, nextMaterials]) => {
        if (cancelled) return
        setFair(fairRes.data)
        setMaterials(nextMaterials)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId])

  // 2B 安全收口:打印必须基于真实资料文件 —— 带上后端签名 previewUrl(30min TTL),
  // http 模式下创建真实打印任务;无签名 URL(mock 演示)时按钮降级为不可用。
  const handlePrint = (material: FairMaterialDTO) => {
    if (!material.previewUrl) return
    navigate('/print/confirm', {
      state: {
        file: {
          name: material.name,
          size: formatSize(material.fileSizeKB),
          pages: material.pageCount > 0 ? material.pageCount : null,
          fileUrl: material.previewUrl,
          mimeType: 'application/pdf',
        },
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
            <Button size="md" variant="secondary" className="min-h-[48px]" onClick={() => navigate(detailPath)}>
              返回详情
            </Button>
          }
        />
        <p className="mt-2 text-xs text-gray-400">
          可打印资料免费取用，请按需取用，节约纸张
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
                  disabled={!mat.previewUrl}
                  title={mat.previewUrl ? undefined : '演示数据无真实文件,接入后端后可打印'}
                  onClick={() => handlePrint(mat)}
                >
                  <PrinterIcon className="h-4 w-4" />
                  {mat.previewUrl ? `免费打印（${mat.pageCount > 0 ? `${mat.pageCount} 页` : '页数以文件为准'}）` : '演示数据暂不可打印'}
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
