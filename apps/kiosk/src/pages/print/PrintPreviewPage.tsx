import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { FileTextIcon, MinusIcon, PlusIcon } from 'lucide-react'

interface PrintFile {
  name: string
  size: string
  pages: number
}

interface LocationState {
  file: PrintFile
}

function ToggleGroup({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={[
            'flex-1 py-3 text-sm font-medium transition-colors',
            value === opt.value
              ? 'bg-primary-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function PrintPreviewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { file } = (location.state as LocationState) ?? { file: { name: '未知文件', size: '-', pages: 1 } }

  const [copies, setCopies] = useState(1)
  const [duplex, setDuplex] = useState('single')
  const [color, setColor] = useState('bw')

  const handleNext = () => {
    navigate('/print/confirm', { state: { file, copies, duplex, color } })
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="打印预览"
        subtitle="确认文件和打印参数"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
            上一步
          </Button>
        }
      />

      <div className="mt-6 flex flex-1 gap-6 overflow-hidden">
        {/* File preview — static placeholder */}
        <div className="flex w-64 shrink-0 flex-col gap-3">
          <div className="flex aspect-[3/4] w-full items-center justify-center rounded-xl border border-gray-200 bg-gray-50 shadow-sm">
            <div className="flex flex-col items-center gap-3 text-center">
              <FileTextIcon className="h-16 w-16 text-gray-300" />
              <p className="px-4 text-xs text-gray-400 break-all leading-relaxed">{file.name}</p>
            </div>
          </div>
          <p className="text-center text-sm text-gray-500">
            共 {file.pages} 页 · {file.size}
          </p>
        </div>

        {/* Print parameters */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
          {/* Copies */}
          <Card className="p-5">
            <p className="mb-3 text-sm font-medium text-gray-700">打印份数</p>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setCopies(Math.max(1, copies - 1))}
                className="flex h-12 w-12 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
                disabled={copies <= 1}
              >
                <MinusIcon className="h-5 w-5 text-gray-600" />
              </button>
              <span className="w-16 text-center text-2xl font-bold text-gray-900">{copies}</span>
              <button
                onClick={() => setCopies(Math.min(99, copies + 1))}
                className="flex h-12 w-12 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50"
              >
                <PlusIcon className="h-5 w-5 text-gray-600" />
              </button>
            </div>
          </Card>

          {/* Paper */}
          <Card className="p-5">
            <p className="mb-3 text-sm font-medium text-gray-700">纸张规格</p>
            <div className="flex h-12 items-center rounded-lg border border-gray-200 bg-gray-50 px-4 text-sm text-gray-500">
              A4（210×297mm）
            </div>
          </Card>

          {/* Duplex */}
          <Card className="p-5">
            <p className="mb-3 text-sm font-medium text-gray-700">打印面</p>
            <ToggleGroup
              options={[
                { label: '单面打印', value: 'single' },
                { label: '双面打印', value: 'duplex' },
              ]}
              value={duplex}
              onChange={setDuplex}
            />
          </Card>

          {/* Color */}
          <Card className="p-5">
            <p className="mb-3 text-sm font-medium text-gray-700">打印色彩</p>
            <ToggleGroup
              options={[
                { label: '黑白', value: 'bw' },
                { label: '彩色', value: 'color' },
              ]}
              value={color}
              onChange={setColor}
            />
          </Card>
        </div>
      </div>

      {/* Bottom action */}
      <div className="mt-6 flex gap-3">
        <Button variant="secondary" size="lg" className="flex-1" onClick={() => navigate(-1)}>
          返回
        </Button>
        <Button size="lg" className="flex-1" onClick={handleNext}>
          确认参数
        </Button>
      </div>
    </div>
  )
}
