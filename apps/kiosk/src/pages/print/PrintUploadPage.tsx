import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import {
  FileTextIcon,
  MonitorSmartphoneIcon,
  QrCodeIcon,
  UsbIcon,
  XIcon,
} from 'lucide-react'

type UploadTab = 'file' | 'qr' | 'usb'

interface MockFile {
  name: string
  size: string
  pages: number
}

const MOCK_FILE: MockFile = { name: '求职申请材料.pdf', size: '512 KB', pages: 4 }

export function PrintUploadPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<UploadTab>('file')
  const [file, setFile] = useState<MockFile | null>(null)

  const tabs: { key: UploadTab; label: string; icon: typeof FileTextIcon }[] = [
    { key: 'file', label: '本机上传', icon: MonitorSmartphoneIcon },
    { key: 'qr',   label: '扫码上传', icon: QrCodeIcon },
    { key: 'usb',  label: 'U盘导入',  icon: UsbIcon },
  ]

  const handleNext = () => {
    if (!file) return
    navigate('/print/preview', { state: { file } })
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="打印服务"
        subtitle="选择文件上传方式"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        }
      />

      {/* Tab bar */}
      <div className="mt-6 flex gap-2">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={[
              'flex flex-1 items-center justify-center gap-2 rounded-lg border py-3 text-sm font-medium transition-colors',
              tab === key
                ? 'border-primary-600 bg-primary-50 text-primary-600'
                : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700',
            ].join(' ')}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-4 flex-1">
        {tab === 'file' && (
          <div className="flex h-full flex-col gap-4">
            {file ? (
              <Card className="flex items-center gap-4 p-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                  <FileTextIcon className="h-6 w-6 text-primary-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-gray-900">{file.name}</p>
                  <p className="mt-0.5 text-sm text-gray-500">{file.size} · {file.pages} 页</p>
                </div>
                <button
                  onClick={() => setFile(null)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-gray-100"
                >
                  <XIcon className="h-4 w-4 text-gray-400" />
                </button>
              </Card>
            ) : (
              <button
                onClick={() => setFile(MOCK_FILE)}
                className="flex h-48 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 bg-white hover:border-primary-400 hover:bg-primary-50 transition-colors"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
                  <FileTextIcon className="h-7 w-7 text-gray-400" />
                </div>
                <div className="text-center">
                  <p className="text-base font-medium text-gray-700">点击选择文件</p>
                  <p className="mt-1 text-sm text-gray-400">支持 PDF、Word、图片格式</p>
                </div>
              </button>
            )}
          </div>
        )}

        {tab === 'qr' && (
          <Card className="flex h-full flex-col items-center justify-center gap-6 p-8">
            <div className="flex h-48 w-48 items-center justify-center rounded-xl bg-gray-100">
              <QrCodeIcon className="h-24 w-24 text-gray-300" />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium text-gray-800">请用手机扫码上传</p>
              <p className="mt-2 text-sm text-gray-500">
                扫描二维码后在手机端选择文件，
                <br />
                上传完成后此处将自动显示文件
              </p>
            </div>
            <Button variant="secondary" size="lg" onClick={() => setFile(MOCK_FILE)}>
              模拟接收文件
            </Button>
          </Card>
        )}

        {tab === 'usb' && (
          <Card className="flex h-full flex-col items-center justify-center gap-6 p-8">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
              <UsbIcon className="h-10 w-10 text-gray-400" />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium text-gray-800">请插入 U 盘</p>
              <p className="mt-2 text-sm text-gray-500">
                连接后系统将自动读取 U 盘内文件，
                <br />
                请确保文件格式为 PDF 或图片
              </p>
            </div>
            <Button variant="secondary" size="lg" onClick={() => setFile(MOCK_FILE)}>
              模拟读取 U 盘
            </Button>
          </Card>
        )}
      </div>

      {/* Bottom action */}
      <div className="mt-6 flex gap-3">
        <Button variant="secondary" size="lg" className="flex-1" onClick={() => navigate('/')}>
          取消
        </Button>
        <Button
          size="lg"
          className="flex-1"
          disabled={!file}
          onClick={handleNext}
        >
          下一步
        </Button>
      </div>
    </div>
  )
}
