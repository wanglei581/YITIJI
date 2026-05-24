import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, PageHeader } from '@ai-job-print/ui'
import { FolderOpenIcon, ScanIcon, UploadIcon } from 'lucide-react'

type Source = 'upload' | 'scan' | 'my-docs'

interface SourceOption {
  type: Source
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  directAction?: boolean
}

const SOURCES: SourceOption[] = [
  {
    type: 'upload',
    label: '上传电子简历',
    description: '支持 PDF、Word、图片格式',
    icon: UploadIcon,
  },
  {
    type: 'scan',
    label: '扫描纸质简历',
    description: '使用扫描仪将纸质简历数字化',
    icon: ScanIcon,
    directAction: true,
  },
  {
    type: 'my-docs',
    label: '从我的文档选择',
    description: '使用已上传或扫描过的文件',
    icon: FolderOpenIcon,
  },
]

const MOCK_FILE = {
  name: '我的简历.pdf',
  size: '312 KB',
  format: 'PDF',
}

export function ResumeSourcePage() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<Source | null>(null)

  const handleSelect = (option: SourceOption) => {
    if (option.directAction) {
      navigate('/scan/start', { state: { scanType: 'resume' } })
      return
    }
    setSelected(option.type)
  }

  const handleNext = () => {
    if (!selected) return
    navigate('/resume/parse', {
      state: { source: selected, file: MOCK_FILE },
    })
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="AI 简历服务"
        subtitle="请选择简历来源"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        }
      />

      <div className="mt-6 flex flex-1 flex-col gap-4">
        {SOURCES.map((option) => {
          const isSelected = selected === option.type
          const Icon = option.icon
          return (
            <button
              key={option.type}
              onClick={() => handleSelect(option)}
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
                    {option.label}
                  </p>
                  <p className="mt-0.5 text-sm text-gray-500">{option.description}</p>
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
          onClick={handleNext}
        >
          下一步
        </Button>
      </div>
    </div>
  )
}
