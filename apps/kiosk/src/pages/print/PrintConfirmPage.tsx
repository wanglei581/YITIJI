import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { FileTextIcon } from 'lucide-react'

interface PrintFile {
  name: string
  size: string
  pages: number
}

interface LocationState {
  file: PrintFile
  copies: number
  duplex: string
  color: string
}

const PRICE_BW = 0.2
const PRICE_COLOR = 0.5

export function PrintConfirmPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null
  const file = state?.file ?? { name: '未知文件', size: '-', pages: 1 }
  const copies = state?.copies ?? 1
  const duplex = state?.duplex ?? 'single'
  const color = state?.color ?? 'bw'

  const pricePerSheet = color === 'color' ? PRICE_COLOR : PRICE_BW
  // 按纸张（张）计费：双面打印时多页共用一张纸
  const chargedSheets = duplex === 'duplex'
    ? Math.ceil(file.pages / 2) * copies
    : file.pages * copies
  const totalPrice = (chargedSheets * pricePerSheet).toFixed(2)

  const rows = [
    { label: '文件名称', value: file.name },
    { label: '文件页数', value: `${file.pages} 页` },
    { label: '打印份数', value: `${copies} 份` },
    { label: '打印面', value: duplex === 'duplex' ? '双面打印' : '单面打印' },
    { label: '色彩模式', value: color === 'color' ? '彩色' : '黑白' },
    { label: '纸张规格', value: 'A4' },
  ]

  const handleConfirm = () => {
    navigate('/print/progress', { state })
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="确认打印"
        subtitle="请核对以下信息后提交"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
            上一步
          </Button>
        }
      />

      <div className="mt-6 flex flex-1 flex-col gap-4 overflow-y-auto">
        {/* File info */}
        <Card className="flex items-center gap-4 p-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50">
            <FileTextIcon className="h-6 w-6 text-primary-600" />
          </div>
          <div>
            <p className="font-medium text-gray-900">{file.name}</p>
            <p className="mt-0.5 text-sm text-gray-500">{file.size}</p>
          </div>
        </Card>

        {/* Order summary */}
        <Card className="p-0 overflow-hidden">
          <table className="w-full">
            <tbody>
              {rows.map(({ label, value }, i) => (
                <tr key={label} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="border-b border-gray-100 px-5 py-3.5 text-sm text-gray-500">{label}</td>
                  <td className="border-b border-gray-100 px-5 py-3.5 text-sm font-medium text-gray-900 text-right">
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Price */}
        <Card className="p-5">
          <div className="flex items-baseline justify-between">
            <p className="text-sm text-gray-500">预计费用</p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-gray-900">¥{totalPrice}</span>
              <span className="text-sm text-gray-400">（实际以机器计费为准）</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Bottom action */}
      <div className="mt-6 flex gap-3">
        <Button variant="secondary" size="lg" className="flex-1" onClick={() => navigate(-1)}>
          返回修改
        </Button>
        <Button size="lg" className="flex-1" onClick={handleConfirm}>
          确认打印
        </Button>
      </div>
    </div>
  )
}
