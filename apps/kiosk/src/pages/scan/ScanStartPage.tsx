import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, PageHeader } from '@ai-job-print/ui'
import { CreditCardIcon, FileTextIcon, ScanIcon } from 'lucide-react'

type ScanType = 'resume' | 'id' | 'document'

interface ScanTypeOption {
  type: ScanType
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

const SCAN_TYPES: ScanTypeOption[] = [
  {
    type: 'resume',
    label: '简历扫描',
    description: '扫描纸质简历，用于 AI 识别与优化',
    icon: FileTextIcon,
  },
  {
    type: 'id',
    label: '证件扫描',
    description: '扫描证件原件，生成存档 PDF',
    icon: CreditCardIcon,
  },
  {
    type: 'document',
    label: '普通文档',
    description: '扫描通用文件，生成 PDF 存档',
    icon: ScanIcon,
  },
]

export function ScanStartPage() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<ScanType | null>(null)

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="扫描服务"
        subtitle="请选择扫描类型"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        }
      />

      <div className="mt-6 flex flex-1 flex-col gap-4">
        {SCAN_TYPES.map(({ type, label, description, icon: Icon }) => {
          const isSelected = selected === type
          return (
            <button
              key={type}
              onClick={() => setSelected(type)}
              className={[
                'w-full rounded-xl border-2 p-5 text-left transition-colors',
                isSelected
                  ? 'border-primary-600 bg-primary-50'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50',
              ].join(' ')}
            >
              <div className="flex items-center gap-4">
                <div
                  className={[
                    'flex h-14 w-14 shrink-0 items-center justify-center rounded-xl',
                    isSelected ? 'bg-primary-100' : 'bg-gray-100',
                  ].join(' ')}
                >
                  <Icon
                    className={[
                      'h-7 w-7',
                      isSelected ? 'text-primary-600' : 'text-gray-500',
                    ].join(' ')}
                  />
                </div>
                <div>
                  <p
                    className={[
                      'text-lg font-semibold',
                      isSelected ? 'text-primary-700' : 'text-gray-900',
                    ].join(' ')}
                  >
                    {label}
                  </p>
                  <p className="mt-0.5 text-sm text-gray-500">{description}</p>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-6">
        <Button
          size="lg"
          className="w-full"
          disabled={selected === null}
          onClick={() => navigate('/scan/settings', { state: { scanType: selected } })}
        >
          下一步
        </Button>
      </div>
    </div>
  )
}
