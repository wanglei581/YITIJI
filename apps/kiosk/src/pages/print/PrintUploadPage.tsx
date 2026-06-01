// ============================================================
// PrintUploadPage — W7
//
// "本机上传" tab now calls POST /api/v1/files/kiosk-upload (A2 mode).
//
// A2 桌面浏览器验证模式 — 设计约束说明：
//   CLAUDE.md §17 要求 Kiosk 生产模式不弹系统文件对话框。
//   当前使用 <input type="file"> 仅作为桌面 Chrome/Edge 下的 E2E 链路验证。
//   生产 Kiosk 切换为 A1：Terminal Agent 监听本地/U 盘目录 → 推送文件列表 → Kiosk 轮询选取。
//
// signedUrl 由后端 kiosk-upload 返回（5-min TTL）；
// PrintConfirmPage 创建打印任务时后端会重新签发 30-min TTL（B1 方案）。
// ============================================================

import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import {
  AlertCircleIcon,
  FileTextIcon,
  LoaderIcon,
  MonitorSmartphoneIcon,
  QrCodeIcon,
  UsbIcon,
  XIcon,
} from 'lucide-react'
import { API_MODE } from '../../services/api/client'
import { kioskUploadFile } from '../../services/files/filesApi'

type UploadTab = 'file' | 'qr' | 'usb'

interface UploadedFile {
  name:    string
  size:    string
  pages:   number
  fileUrl: string
  fileMd5: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function PrintUploadPage() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState<UploadTab>('file')
  const [file, setFile] = useState<UploadedFile | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const tabs: { key: UploadTab; label: string; icon: typeof FileTextIcon }[] = [
    { key: 'file', label: '本机上传', icon: MonitorSmartphoneIcon },
    { key: 'qr',   label: '扫码上传', icon: QrCodeIcon },
    { key: 'usb',  label: 'U盘导入',  icon: UsbIcon },
  ]

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return
    e.target.value = ''

    setUploadError(null)
    setUploading(true)
    try {
      const result = await kioskUploadFile(selected)
      setFile({
        name:    result.filename,
        size:    formatBytes(result.sizeBytes),
        pages:   1,
        fileUrl: result.signedUrl,
        fileMd5: result.sha256,
      })
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '上传失败，请重试')
    } finally {
      setUploading(false)
    }
  }

  const handleSelectClick = () => {
    inputRef.current?.click()
  }

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
            onClick={() => { setTab(key); setFile(null); setUploadError(null) }}
            className={[
              'flex flex-1 min-h-[56px] items-center justify-center gap-2 rounded-lg border py-4 text-sm font-medium transition-colors',
              tab === key
                ? 'border-primary-600 bg-primary-50 text-primary-600'
                : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700',
            ].join(' ')}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-4 flex flex-1 flex-col">
        {tab === 'file' && (
          <div className="flex flex-1 flex-col gap-3">
            {/* A2 mode banner */}
            {API_MODE === 'http' && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>桌面浏览器验证模式 — 生产 Kiosk 将切换为 Agent 文件中转（A1）</span>
              </div>
            )}

            {/* Hidden file input — A2 桌面验证路径 */}
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              className="sr-only"
              onChange={handleFileChange}
            />

            {/* Upload error */}
            {uploadError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircleIcon className="h-4 w-4 shrink-0" />
                {uploadError}
              </div>
            )}

            {file ? (
              <Card className="flex items-center gap-4 p-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                  <FileTextIcon className="h-6 w-6 text-primary-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-gray-900">{file.name}</p>
                  <p className="mt-0.5 text-sm text-gray-500">{file.size}</p>
                </div>
                <button
                  onClick={() => { setFile(null); setUploadError(null) }}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-gray-100"
                >
                  <XIcon className="h-4 w-4 text-gray-400" />
                </button>
              </Card>
            ) : (
              <button
                onClick={handleSelectClick}
                disabled={uploading}
                className="flex flex-1 w-full flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-gray-300 bg-white hover:border-primary-400 hover:bg-primary-50 transition-colors min-h-[200px] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploading ? (
                  <>
                    <LoaderIcon className="h-10 w-10 animate-spin text-primary-400" />
                    <p className="text-base font-medium text-gray-600">上传中…</p>
                  </>
                ) : (
                  <>
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                      <FileTextIcon className="h-8 w-8 text-gray-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-medium text-gray-700">点击选择文件</p>
                      <p className="mt-1.5 text-sm text-gray-400">支持 PDF、Word、图片格式，最大 10MB</p>
                    </div>
                  </>
                )}
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
            <p className="text-sm text-gray-400">（扫码上传功能开发中）</p>
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
            <p className="text-sm text-gray-400">（U 盘导入通过 Terminal Agent 中转，开发中）</p>
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
          disabled={!file || uploading}
          onClick={handleNext}
        >
          下一步
        </Button>
      </div>
    </div>
  )
}
