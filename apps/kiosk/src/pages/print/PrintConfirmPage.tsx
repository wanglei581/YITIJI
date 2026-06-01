import { useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { FileTextIcon, InfoIcon, LoaderIcon } from 'lucide-react'
import type { PrintJobParams } from '@ai-job-print/shared'
import { API_MODE } from '../../services/api/client'
import { createPrintJob } from '../../services/print/printJobsApi'

interface PrintFile {
  name:     string
  size:     string
  pages:    number
  fileUrl?: string
}

interface LocationState {
  file: PrintFile
  params: PrintJobParams
}

const PRICE_BW = 0.2
const PRICE_COLOR = 0.5

const DUPLEX_LABEL: Record<string, string> = {
  simplex: '单面',
  duplex_long_edge: '双面（长边翻转）',
  duplex_short_edge: '双面（短边翻转）',
}

const ORIENTATION_LABEL: Record<string, string> = {
  auto: '自动',
  portrait: '纵向',
  landscape: '横向',
}

const QUALITY_LABEL: Record<string, string> = {
  draft: '草稿',
  standard: '标准',
  high: '高质量',
}

const DEFAULT_PARAMS: PrintJobParams = {
  copies: 1,
  colorMode: 'black_white',
  duplex: 'simplex',
  paperSize: 'A4',
  pageRange: 'all',
  orientation: 'auto',
  quality: 'standard',
  scale: 'fit',
  pagesPerSheet: 1,
}

export function PrintConfirmPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null
  const file = state?.file ?? { name: '未知文件', size: '-', pages: 1 }
  const params = state?.params ?? DEFAULT_PARAMS
  const [submitting, setSubmitting] = useState(false)

  const { totalFaces, sheetsUsed, paperSaved } = useMemo(() => {
    const facesPerCopy = Math.ceil(file.pages / params.pagesPerSheet)
    const tf = facesPerCopy * params.copies
    const su = params.duplex === 'simplex' ? tf : Math.ceil(tf / 2)
    return { totalFaces: tf, sheetsUsed: su, paperSaved: tf - su }
  }, [file.pages, params])

  const pricePerFace = params.colorMode === 'color' ? PRICE_COLOR : PRICE_BW
  const totalPrice = (totalFaces * pricePerFace).toFixed(2)

  const summaryRows = [
    { label: '文件名称', value: file.name },
    { label: '文件页数', value: `${file.pages} 页` },
    { label: '纸张规格', value: 'A4（210 × 297 mm）' },
    { label: '打印份数', value: `${params.copies} 份` },
    { label: '色彩模式', value: params.colorMode === 'color' ? '彩色' : '黑白' },
    { label: '单双面', value: DUPLEX_LABEL[params.duplex] ?? params.duplex },
    { label: '页面方向', value: ORIENTATION_LABEL[params.orientation] ?? params.orientation },
    { label: '打印质量', value: QUALITY_LABEL[params.quality] ?? params.quality },
    { label: '缩放方式', value: params.scale === 'fit' ? '适合页面' : '实际大小' },
    { label: '每张页数', value: `${params.pagesPerSheet} 页/张` },
    {
      label: '页面范围',
      value: params.pageRange ?? '全部页面',
    },
  ]

  const handleConfirm = async () => {
    // http mode + real fileUrl → submit a real print job, get a taskId for polling
    if (API_MODE === 'http' && file.fileUrl) {
      setSubmitting(true)
      try {
        const { taskId } = await createPrintJob({
          fileUrl:  file.fileUrl,
          fileName: file.name,
          params,
        })
        navigate('/print/progress', { state: { ...location.state, file, params, taskId } })
      } catch {
        // API unreachable — fall through to frontend simulation
        navigate('/print/progress', { state: { ...location.state, file, params } })
      } finally {
        setSubmitting(false)
      }
      return
    }
    // mock mode or no fileUrl → frontend simulation
    navigate('/print/progress', { state: { ...location.state, file, params } })
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="确认打印"
        subtitle="核对以下参数，确认无误后开始打印"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
            返回修改
          </Button>
        }
      />

      <div className="mt-6 flex flex-1 flex-col gap-4 overflow-y-auto">
        {/* File info */}
        <Card className="flex items-center gap-4 p-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50">
            <FileTextIcon className="h-6 w-6 text-primary-600" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-gray-900">{file.name}</p>
            <p className="mt-0.5 text-sm text-gray-500">{file.size}</p>
          </div>
        </Card>

        {/* Parameter summary */}
        <Card className="overflow-hidden p-0">
          <table className="w-full">
            <tbody>
              {summaryRows.map(({ label, value }, i) => (
                <tr key={label} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="border-b border-gray-100 px-5 py-3.5 text-sm text-gray-500">
                    {label}
                  </td>
                  <td className="border-b border-gray-100 px-5 py-3.5 text-right text-sm font-medium text-gray-900">
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Usage + cost */}
        <Card className="p-5">
          <div className="grid grid-cols-2 gap-y-2.5 text-sm">
            <span className="text-gray-500">总打印面</span>
            <span className="text-right font-medium text-gray-900">{totalFaces} 面</span>
            <span className="text-gray-500">预计用纸</span>
            <span className="text-right font-medium text-gray-900">{sheetsUsed} 张</span>
          </div>

          {paperSaved > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
              <InfoIcon className="h-4 w-4 shrink-0" />
              双面打印比单面节省 {paperSaved} 张纸
            </div>
          )}

          <div className="mt-4 flex items-baseline justify-between border-t border-gray-100 pt-4">
            <div>
              <p className="text-sm text-gray-700 font-medium">预计费用</p>
              <p className="mt-0.5 text-xs text-gray-400">
                ¥{pricePerFace.toFixed(1)}/面（{params.colorMode === 'color' ? '彩色' : '黑白'}）× {totalFaces} 面
              </p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-gray-900">¥{totalPrice}</span>
              <p className="mt-0.5 text-xs text-gray-400">实际以机器计费为准</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Bottom action */}
      <div className="mt-6 flex gap-3">
        <Button variant="secondary" size="lg" className="flex-1" disabled={submitting} onClick={() => navigate(-1)}>
          返回修改
        </Button>
        <Button size="lg" className="flex-1" disabled={submitting} onClick={() => void handleConfirm()}>
          {submitting ? (
            <span className="flex items-center gap-2">
              <LoaderIcon className="h-4 w-4 animate-spin" />
              提交中…
            </span>
          ) : (
            '按以上设置打印'
          )}
        </Button>
      </div>
    </div>
  )
}
