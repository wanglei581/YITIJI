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
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import {
  AlertCircleIcon,
  FileTextIcon,
  LoaderIcon,
  MonitorSmartphoneIcon,
  PrinterIcon,
  QrCodeIcon,
  SparklesIcon,
  UsbIcon,
  XIcon,
} from 'lucide-react'
import { API_MODE } from '../../services/api/client'
import { kioskUploadFile } from '../../services/files/filesApi'
import { useAuth } from '../../auth/useAuth'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'
import { clearPrintMaterialSession, savePrintMaterialSession, type PrintFileState, type PrintMaterialSource } from './printMaterialSession'

type UploadTab = 'file' | 'qr' | 'usb'

type UploadedFile = PrintFileState & { fileId: string; fileUrl: string; fileMd5: string }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function PrintUploadPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { getToken, isLoggedIn } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const source: PrintMaterialSource = searchParams.get('source') === 'resume' ? 'resume' : 'document'
  // PrintScanHomePage 的"照片打印"卡片通过 router state 传 category: 'photo'；
  // 用于控制真实 PII 扫描是否可以按内容类别跳过（见 materials.service.ts 的 contentCategory 网关）。
  const contentCategory = (location.state as { category?: 'photo' } | null)?.category === 'photo' ? 'photo' : undefined
  const isResumePrint = source === 'resume'
  const isDocumentPrint = source === 'document'
  const pageTitle = isDocumentPrint ? '文档打印' : '简历打印'
  const pageSubtitle = isDocumentPrint ? '通用文档、求职材料或图片上传后打印' : '从我的简历或上传一份简历进入打印'

  const initialTab: UploadTab = !isResumePrint && searchParams.get('tab') === 'qr' ? 'qr' : 'file'
  const [tab, setTab] = useState<UploadTab>(initialTab)
  const [file, setFile] = useState<UploadedFile | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [qrBusy, setQrBusy] = useState(false)
  // 上传中或扫码会话进行中:禁止进入待机宣传屏(评审 bug #1)
  useBusyLock(uploading || qrBusy)

  const tabs: { key: UploadTab; label: string; icon: typeof FileTextIcon; disabled?: boolean; note?: string }[] = isResumePrint
    ? [
        { key: 'file', label: '上传简历', icon: MonitorSmartphoneIcon, note: 'PDF/图片' },
      ]
    : [
        { key: 'file', label: '选择文件', icon: MonitorSmartphoneIcon, note: '桌面验证' },
        { key: 'qr',   label: '扫码上传', icon: QrCodeIcon, note: '手机/浏览器' },
        { key: 'usb',  label: 'U盘导入',  icon: UsbIcon, disabled: true, note: '待接入 Agent' },
      ]

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return
    e.target.value = ''

    setUploadError(null)
    setUploading(true)
    clearPrintMaterialSession()
    try {
      const result = await kioskUploadFile(selected, getToken())
      const nextFile: UploadedFile = {
        name:    result.filename,
        size:    formatBytes(result.sizeBytes),
        pages:   null,
        fileId:  result.fileId,
        fileUrl: result.signedUrl,
        fileMd5: result.sha256,
        mimeType: result.mimeType,
      }
      setFile(nextFile)
      savePrintMaterialSession({ file: nextFile, source, contentCategory })
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '上传失败，请重试')
    } finally {
      setUploading(false)
    }
  }

  const handleSelectClick = () => {
    inputRef.current?.click()
  }

  const handleQrUploaded = (uploaded: PhoneUploadedFile) => {
    if (!uploaded.fileUrl) {
      setUploadError('文件签名链接生成失败，请刷新二维码重试')
      return
    }
    setUploadError(null)
    const nextFile: UploadedFile = {
      name: uploaded.name,
      size: uploaded.size,
      pages: null,
      fileId: uploaded.fileId,
      fileUrl: uploaded.fileUrl,
      fileMd5: uploaded.sha256 ?? '',
      mimeType: uploaded.mimeType,
    }
    setFile(nextFile)
    savePrintMaterialSession({ file: nextFile, source, contentCategory })
  }

  const handleNext = () => {
    if (!file) return
    savePrintMaterialSession({ file, source, contentCategory })
    navigate('/print/material-check', { state: { file, source } })
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title={pageTitle}
        subtitle={pageSubtitle}
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        }
      />

      {source === 'resume' && (
        <Card className="mt-6 border-primary-100 bg-primary-50/60 p-5">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-primary-600 shadow-sm">
              <PrinterIcon className="h-7 w-7" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold text-neutral-900">先查看账号里的简历记录</p>
              <p className="mt-1 text-sm leading-relaxed text-neutral-600">
                已生成的简历可继续查看并打印；诊断类记录可查看报告或继续优化。已有电子简历也可以在下方上传后直接打印。
              </p>
            </div>
            <Button
              size="lg"
              className="h-14 shrink-0 px-6"
              onClick={() => {
                if (isLoggedIn) {
                  navigate('/me/resumes')
                } else {
                  navigate('/login', { state: { from: '/print/upload?source=resume' } })
                }
              }}
            >
              <SparklesIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />
              查看我的简历记录
            </Button>
          </div>
        </Card>
      )}

      {/* Tab bar */}
      <div className="mt-6 flex gap-2">
        {tabs.map(({ key, label, icon: Icon, disabled, note }) => (
          <button
            key={key}
            disabled={disabled}
            onClick={() => { if (!disabled) { setTab(key); setFile(null); setUploadError(null) } }}
            className={[
              'flex flex-1 min-h-[56px] items-center justify-center gap-2 rounded-lg border py-4 text-sm font-medium transition-colors',
              disabled ? 'cursor-not-allowed border-neutral-100 bg-neutral-50 text-neutral-300' :
              tab === key
                ? 'border-primary-600 bg-primary-50 text-primary-600'
                : 'border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300 hover:text-neutral-700',
            ].join(' ')}
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
            {note && <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium">{note}</span>}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-4 flex flex-1 flex-col">
        {tab === 'file' && (
          <div className="flex flex-1 flex-col gap-3">
            {/* A2 mode banner */}
            {API_MODE === 'http' && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning-fg">
                <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>桌面浏览器验证模式 — 生产 Kiosk 将切换为 Agent 文件中转（A1）</span>
              </div>
            )}

            {/* Hidden file input — A2 桌面验证路径 */}
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="sr-only"
              onChange={handleFileChange}
            />

            {/* Upload error */}
            {uploadError && (
              <div className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-3 py-2 text-sm text-error-fg">
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
                  <p className="truncate font-medium text-neutral-900">{file.name}</p>
                  <p className="mt-0.5 text-sm text-neutral-500">{file.size} · 页数待识别</p>
                </div>
                <button
                  onClick={() => { setFile(null); setUploadError(null); clearPrintMaterialSession() }}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-neutral-100"
                >
                  <XIcon className="h-4 w-4 text-neutral-400" />
                </button>
              </Card>
            ) : (
              <button
                onClick={handleSelectClick}
                disabled={uploading}
                className="flex flex-1 w-full flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-neutral-300 bg-white hover:border-primary-400 hover:bg-primary-50 transition-colors min-h-[200px] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploading ? (
                  <>
                    <LoaderIcon className="h-10 w-10 animate-spin text-primary-400" />
                    <p className="text-base font-medium text-neutral-600">上传中…</p>
                  </>
                ) : (
                  <>
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100">
                      <FileTextIcon className="h-8 w-8 text-neutral-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-medium text-neutral-700">{source === 'resume' ? '点击选择简历文件' : '点击选择文件'}</p>
                      <p className="mt-1.5 text-sm text-neutral-400">
                        {source === 'resume'
                          ? '支持 PDF、图片格式，适合已有电子简历直接打印'
                          : '支持 PDF、图片格式，上传后将先做材料检查'}
                      </p>
                    </div>
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {tab === 'qr' && (
          <div className="flex flex-1 flex-col gap-3">
            {uploadError && (
              <div className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-3 py-2 text-sm text-error-fg">
                <AlertCircleIcon className="h-4 w-4 shrink-0" />
                {uploadError}
              </div>
            )}
            {file && (
              <Card className="flex items-center gap-4 p-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                  <FileTextIcon className="h-6 w-6 text-primary-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-neutral-900">{file.name}</p>
                  <p className="mt-0.5 text-sm text-neutral-500">{file.size} · 已确认，可点击下方"下一步"</p>
                </div>
                <button
                  onClick={() => { setFile(null); setUploadError(null); clearPrintMaterialSession() }}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-neutral-100"
                >
                  <XIcon className="h-4 w-4 text-neutral-400" />
                </button>
              </Card>
            )}
            <UploadSessionQrPanel
              purpose="print_doc"
              title="手机扫码上传"
              description="手机或其他联网设备打开链接上传文件；一体机上确认后自动填入本次打印任务。"
              confirmLabel="确认使用这份文件"
              onUploaded={handleQrUploaded}
              onBusyChange={setQrBusy}
            />
          </div>
        )}

        {tab === 'usb' && (
          <Card className="flex h-full flex-col items-center justify-center gap-6 p-8">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-neutral-100">
              <UsbIcon className="h-10 w-10 text-neutral-400" />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium text-neutral-800">请插入 U 盘</p>
              <p className="mt-2 text-sm text-neutral-500">
                连接后系统将自动读取 U 盘内文件，
                <br />
                请确保文件格式为 PDF 或图片
              </p>
            </div>
            <p className="text-sm text-neutral-400">（U 盘导入通过 Terminal Agent 中转，开发中）</p>
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
