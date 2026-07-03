import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { AlertCircleIcon, InfoIcon } from 'lucide-react'
import { API_MODE } from '../../services/api/client'

type ScanType = 'resume' | 'id' | 'document'
type Source = 'flatbed' | 'adf'
type PageMode = 'single' | 'multi'
type Color = 'color' | 'gray' | 'bw'
type Dpi = 300 | 600

interface LocationState {
  scanType?: ScanType
}

interface ToggleOption<T> {
  value: T
  label: string
}

function ToggleGroup<T extends string | number>({
  options,
  value,
  onChange,
  disabledValues,
}: {
  options: ToggleOption<T>[]
  value: T
  onChange: (v: T) => void
  disabledValues?: T[]
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-neutral-200">
      {options.map((opt) => {
        const isDisabled = disabledValues?.includes(opt.value)
        const isActive = value === opt.value
        return (
          <button
            key={String(opt.value)}
            disabled={isDisabled}
            onClick={() => onChange(opt.value)}
            className={[
              'flex-1 py-3 text-sm font-medium transition-colors',
              isDisabled
                ? 'cursor-not-allowed bg-neutral-50 text-neutral-300'
                : isActive
                ? 'bg-primary-600 text-white'
                : 'bg-white text-neutral-600 hover:bg-neutral-50',
            ].join(' ')}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export function ScanSettingsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as LocationState
  const scanType = state.scanType ?? 'document'
  const scanUnavailable = API_MODE === 'http'

  const [source, setSource] = useState<Source>('flatbed')
  const [pageMode, setPageMode] = useState<PageMode>('single')
  const [color, setColor] = useState<Color>('color')
  const [dpi, setDpi] = useState<Dpi>(300)

  const handleSourceChange = (v: Source) => {
    setSource(v)
    if (v === 'adf') setPageMode('multi')
  }

  const handleConfirm = () => {
    if (scanUnavailable) return
    navigate('/scan/progress', {
      state: { scanType, source, pageMode, color, dpi },
    })
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="扫描设置"
        subtitle="请配置扫描参数"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
            上一步
          </Button>
        }
      />

      <div className="mt-6 flex flex-1 flex-col gap-4 overflow-y-auto">
        {/* 扫描来源 */}
        <Card className="p-5">
          <p className="mb-3 text-sm font-medium text-neutral-700">扫描来源</p>
          <ToggleGroup<Source>
            options={[
              { value: 'flatbed', label: '平板' },
              { value: 'adf', label: 'ADF 自动输稿器' },
            ]}
            value={source}
            onChange={handleSourceChange}
          />
          {source === 'flatbed' && (
            <p className="mt-2 text-xs text-neutral-400">请将文件正面朝下放置在扫描仪玻璃上</p>
          )}
          {source === 'adf' && (
            <p className="mt-2 flex items-center gap-2 text-xs text-warning-fg">
              <AlertCircleIcon className="h-3.5 w-3.5 shrink-0" />
              请将文件整齐放入 ADF 进纸口
            </p>
          )}
        </Card>

        {/* 页数模式 */}
        <Card className="p-5">
          <p className="mb-3 text-sm font-medium text-neutral-700">页数模式</p>
          <ToggleGroup<PageMode>
            options={[
              { value: 'single', label: '单页' },
              { value: 'multi', label: '多页' },
            ]}
            value={pageMode}
            onChange={setPageMode}
            disabledValues={source === 'adf' ? ['single'] : undefined}
          />
        </Card>

        {/* 色彩模式 */}
        <Card className="p-5">
          <p className="mb-3 text-sm font-medium text-neutral-700">色彩模式</p>
          <ToggleGroup<Color>
            options={[
              { value: 'color', label: '彩色' },
              { value: 'gray', label: '灰度' },
              { value: 'bw', label: '黑白' },
            ]}
            value={color}
            onChange={setColor}
          />
        </Card>

        {/* 分辨率 */}
        <Card className="p-5">
          <p className="mb-3 text-sm font-medium text-neutral-700">分辨率</p>
          <ToggleGroup<Dpi>
            options={[
              { value: 300, label: '300 DPI' },
              { value: 600, label: '600 DPI' },
            ]}
            value={dpi}
            onChange={setDpi}
          />
          <p className="mt-2 text-xs text-neutral-400">普通文档 300 DPI 即可，照片或图片可选 600 DPI</p>
        </Card>

        {/* 输出格式 + 合规说明 */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-neutral-700">输出格式</p>
            <span className="rounded bg-neutral-100 px-2.5 py-1 text-sm font-medium text-neutral-600">
              PDF
            </span>
          </div>
          <div className="mt-3 flex items-start gap-2">
            <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" />
            <p className="text-xs text-neutral-400">
              {scanUnavailable
                ? '当前生产模式未接入本机扫描 Agent，扫描服务暂不开放。'
                : '扫描由本机服务处理，不依赖网络'}
            </p>
          </div>
        </Card>
      </div>

      <div className="mt-6 flex gap-3">
        <Button variant="secondary" size="lg" className="flex-1" onClick={() => navigate(-1)}>
          返回
        </Button>
        <Button size="lg" className="flex-1" disabled={scanUnavailable} onClick={handleConfirm}>
          {scanUnavailable ? '真机扫描待接入' : '开始扫描'}
        </Button>
      </div>
    </div>
  )
}
