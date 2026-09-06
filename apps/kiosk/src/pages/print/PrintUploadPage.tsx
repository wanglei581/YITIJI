// ============================================================
// PrintUploadPage — W7
//
// "本机上传" tab now calls POST /api/v1/files/kiosk-upload (A2 mode).
//
// A2 桌面浏览器验证模式 — 设计约束说明：
//   CLAUDE.md §17 要求 Kiosk 生产模式不弹系统文件对话框。
//   "选择文件" tab 用 <input type="file"> 仅作为桌面 Chrome/Edge 下的 E2E 链路验证。
//   "U盘导入" tab 是 A1 生产路径：Terminal Agent 通过 /local/usb/* 本地网桥枚举可移动磁盘
//   （不下发绝对路径，只给一次性 safeId）→ Kiosk 轮询展示文件列表 → 用户选取后一次性消费。
//   该本地网桥的 Windows CIM/PowerShell 检测分支仅在 win32 环境生效，
//   未完成 Windows 真机验收前不得据代码已合入宣称"U 盘导入已完成"。
//
// signedUrl 由后端 kiosk-upload 返回（5-min TTL）；
// PrintConfirmPage 创建打印任务时后端会重新签发 30-min TTL（B1 方案）。
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { Button, Card } from '@ai-job-print/ui'
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
import {
  FILE_NAME_BUDGET_CARD,
  FILE_NAME_BUDGET_COMPACT,
  truncateFileNameMiddle,
} from '../../lib/fileName'
import { kioskUploadFile } from '../../services/files/filesApi'
import { userMessageOf } from '../../services/api/userErrorMessage'
import {
  getUsbStatus,
  isUsbImportConfigured,
  listUsbFiles,
  uploadUsbFile,
  type UsbFileListItem,
  type UsbStatus,
} from '../../services/files/usbImportApi'
import { useAuth } from '../../auth/useAuth'
import { getMyPrintOrders } from '../../services/api/memberPrintOrders'
import {
  UploadSessionQrPanel,
  type PhoneUploadedFile,
} from '../upload/components/UploadSessionQrPanel'
import {
  clearPrintMaterialSession,
  savePrintMaterialSession,
  type PrintFileState,
  type PrintMaterialContentCategory,
  type PrintMaterialSource,
} from './printMaterialSession'
import { PrintPageFrame, PrintPrototypeHeader } from './PrintPrototypeLayout'
import type { MemberPrintOrderItem } from '@ai-job-print/shared'

type UploadTab = 'file' | 'qr' | 'usb'

/**
 * 打印上传的**实际生效**大小上限(MB)。
 *
 * 服务端 file-validation.ts:validateUpload 对 multipart 代理上传取
 * `min(PURPOSE_POLICY.print_doc.maxBytes = 20MB, PROXY_MAX_BYTES = 15MB)` = 15MB,
 * kiosk-upload 与 U 盘导入都走这条 proxy 路径。
 *
 * 2026-08-17 走查:本页原先写「不超过 20MB」,而 16.9MB 文件上传后被拒并提示
 * 「文件超出上限(15MB)」——先告诉用户 20MB 再按 15MB 拒收。这里改为单一常量,
 * 并由 services/api 的 verify:file-display-truth 门禁对着服务端策略核对,不再手抄。
 */
export const PRINT_UPLOAD_MAX_MB = 15

type UploadedFile = PrintFileState & { fileId: string; fileUrl: string; fileMd5: string }

// 单位换算按「四舍五入后是否还落在本档」判定,不能只比原始字节数。
// 反例(2026-08-17 走查):1 048 500 B < 1MiB 走 KB 档,(1048500/1024).toFixed(0) = "1024",
// 显示成「1024 KB」——用户看到一个本该进位成 1.0 MB 的数。B→KB 边界同理。
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '大小未知'
  const KB = 1024
  const MB = KB * 1024
  if (bytes < KB) return `${Math.round(bytes)} B`
  const kb = bytes / KB
  if (kb < 1024 && Math.round(kb) < 1024) return `${Math.round(kb)} KB`
  return `${(bytes / MB).toFixed(1)} MB`
}

// 入口卡片（"照片打印" vs "文档打印"）只能表达用户点了哪个入口，不能证明用户最终选中的
// 文件真的是图片——用户仍可能在"照片打印"入口里通过拖拽或系统文件对话框选中 PDF。
// 这里以实际上传结果的 mimeType 为准做二次校验，只有入口信号 + 真实 mimeType 都指向
// 图片时，才把 contentCategory=photo 传给后端；否则传 undefined。
//
// 安全说明（CR-2 修复后已更新）：contentCategory=photo 曾经能让后端 pii_scan 跳过真实扫描
// （materials.service.ts 的 canSkipAsPhoto），但该跳过口子已被彻底移除——contentCategory
// 现在对是否执行真实扫描没有任何影响，pii_scan 对任意文件都会真实抽取。这里继续做
// mimeType 二次校验只是为了让 contentCategory 这个审计字段本身更准确，不再是"防绕过"意义
// 上的双重防御。
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function resolveContentCategory(
  entryContentCategory: PrintMaterialContentCategory | undefined,
  mimeType: string | undefined
): PrintMaterialContentCategory | undefined {
  if (entryContentCategory !== 'photo') return undefined
  if (!mimeType || !IMAGE_MIME_TYPES.has(mimeType)) return undefined
  return 'photo'
}

export function PrintUploadPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { getToken, isLoggedIn } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const source: PrintMaterialSource =
    searchParams.get('source') === 'resume' ? 'resume' : 'document'
  const isResumePrint = source === 'resume'
  const isDocumentPrint = source === 'document'

  // 入口直达（2026-08-19）。此前本页标题恒为「文档打印」：用户在 /print-scan 点的是
  // 「手机扫码上传」或「照片打印」，落地却看到别人的名字，还要在 2×2 网格里把刚才
  // 已经选过的通道再选一遍。
  //
  // 判据是入口声明了哪一维（详见 docs/reviews/2026-08-19-kiosk-entry-directness-review.md）：
  //   只声明任务（文档打印）→ 保留通道选择器，用户确实还没决定文件从哪来；
  //   只声明通道（手机扫码上传）→ 直达该面板，不再问第二遍。
  //
  // **不能用 `tab` 参数判断**：文档打印与照片打印也带 `tab=file`，按 tab 收会把它们
  // 正常的通道选择一起干掉。因此另立 `mode`，语义是「入口已经把通道定死了」。
  //
  // 默认视图（不带 mode）必须保持原样：fusion-w2-print.spec.ts:403-411 访问不带 tab 的
  // 本页并要求四个通道按钮同时可见、还会点「扫描原件」；fusion-w6 钉死不带 query 时
  // 页面上要能看到「文档打印」。所以本次是纯增量，只有深链走新行为。
  // 三个通道型入口（首页快捷区的「本机上传 / 手机扫码传 / U 盘」与打印扫描 Hub 的
  // 「手机扫码上传」）都只声明了通道，因此一律直达；标题按通道切，不再统称「文档打印」。
  const isTransferMode = isDocumentPrint && searchParams.get('mode') === 'transfer'
  // 「照片打印」原本只用 router state 传 category，刷新或收藏就丢；改为同时接受 query。
  const isPhotoEntry =
    (location.state as { category?: 'photo' } | null)?.category === 'photo' ||
    searchParams.get('category') === 'photo'
  // 仅作为 pii_scan 任务的审计字段随请求持久化，不再驱动是否跳过真实扫描
  // （materials.service.ts 已移除 contentCategory 跳过口子，所有图片一律真实扫描）。
  const contentCategory = isPhotoEntry ? 'photo' : undefined

  // 简历打印与文档打印共用三种上传通道；?tab= 决定初始通道。
  const requestedTab = searchParams.get('tab')
  const entryTab: UploadTab =
    requestedTab === 'qr' || requestedTab === 'usb' ? requestedTab : 'file'

  const TRANSFER_COPY: Record<UploadTab, { title: string; subtitle: string }> = {
    file: { title: '本机上传', subtitle: '在这台机器上选择文件，传完可以直接接着打印' },
    qr: { title: '手机扫码上传', subtitle: '把手机里的文件传到这台机器，传完可以直接接着打印' },
    usb: { title: 'U盘导入', subtitle: '从 U 盘里选文件传到这台机器，传完可以直接接着打印' },
  }

  const pageTitle = !isDocumentPrint
    ? '简历打印'
    : isTransferMode
      ? TRANSFER_COPY[entryTab].title
      : isPhotoEntry
        ? '照片打印'
        : '文档打印'
  const pageSubtitle = !isDocumentPrint
    ? '从我的简历或上传一份简历进入打印'
    : isTransferMode
      ? TRANSFER_COPY[entryTab].subtitle
      : isPhotoEntry
        ? '照片上传后设参数打印，与文档打印同一条流程'
        : '通用文档、求职材料或图片上传后打印'

  const initialTab: UploadTab = entryTab
  const [tab, setTab] = useState<UploadTab>(initialTab)
  const [file, setFile] = useState<UploadedFile | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [qrBusy, setQrBusy] = useState(false)
  const [usbConfigured] = useState(() => isUsbImportConfigured())
  const [usbStatus, setUsbStatus] = useState<UsbStatus | null>(null)
  const [usbFiles, setUsbFiles] = useState<UsbFileListItem[] | null>(null)
  const [usbError, setUsbError] = useState<string | null>(null)
  const [usbUploading, setUsbUploading] = useState(false)
  const [recentFiles, setRecentFiles] = useState<MemberPrintOrderItem[]>([])
  // 上传中或扫码会话进行中:禁止进入待机宣传屏(评审 bug #1)
  useBusyLock(uploading || qrBusy || usbUploading)

  const tabs: {
    key: UploadTab
    label: string
    icon: typeof FileTextIcon
    disabled?: boolean
    note?: string
  }[] = [
    {
      key: 'file',
      label: isResumePrint ? '上传简历' : '选择文件',
      icon: MonitorSmartphoneIcon,
      note: isResumePrint ? 'PDF/图片' : '桌面验证',
    },
    { key: 'qr', label: '扫码上传', icon: QrCodeIcon, note: '手机/浏览器' },
    {
      key: 'usb',
      label: 'U盘导入',
      icon: UsbIcon,
      disabled: !usbConfigured,
      note: usbConfigured ? undefined : '本机未配置',
    },
  ]

  // U 盘状态轮询:仅在 usb tab 激活、本机已配置令牌、且尚未选定文件时才轮询,
  // 避免在其它 tab 停留时对 Agent 发起无意义请求。
  // 上传进行中也必须暂停轮询:每次 /local/usb/files 都会整体重建一次性 safeId
  // 注册表,若上传期间继续轮询,正在消费的 safeId 会被下一轮刷新作废(410 竞态)。
  useEffect(() => {
    if (tab !== 'usb' || !usbConfigured || file || usbUploading) return undefined
    let cancelled = false

    const poll = async () => {
      try {
        const status = await getUsbStatus()
        if (cancelled) return
        setUsbStatus(status)
        setUsbError(null)
        if (status.present) {
          const list = await listUsbFiles()
          if (cancelled) return
          setUsbFiles(list.files)
        } else {
          setUsbFiles(null)
        }
      } catch (err) {
        if (cancelled) return
        setUsbStatus(null)
        setUsbFiles(null)
        setUsbError(
          userMessageOf(err, 'U 盘状态查询失败，请确认终端服务正在运行后重试')
        )
      }
    }

    // 自调度 setTimeout 而非 setInterval:上一轮 poll 完成后才排下一轮,
    // Agent 响应慢时不会产生并发轮询叠加。
    let timer: number | undefined
    const loop = async () => {
      await poll()
      if (!cancelled) timer = window.setTimeout(() => void loop(), 2000)
    }
    void loop()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [tab, usbConfigured, file, usbUploading])

  useEffect(() => {
    if (!isLoggedIn) {
      setRecentFiles([])
      return
    }
    const token = getToken()
    if (!token) return
    let alive = true
    void getMyPrintOrders(token, { pageSize: 3 })
      .then((response) => {
        if (alive) setRecentFiles(response.items)
      })
      .catch(() => {
        if (alive) setRecentFiles([])
      })
    return () => {
      alive = false
    }
  }, [getToken, isLoggedIn])

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
        name: result.filename,
        size: formatBytes(result.sizeBytes),
        pages: null,
        fileId: result.fileId,
        fileUrl: result.signedUrl,
        fileMd5: result.sha256,
        mimeType: result.mimeType,
      }
      setFile(nextFile)
      savePrintMaterialSession({
        file: nextFile,
        source,
        contentCategory: resolveContentCategory(contentCategory, nextFile.mimeType),
      })
    } catch (err) {
      setUploadError(userMessageOf(err, '上传失败，请重试'))
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
    savePrintMaterialSession({
      file: nextFile,
      source,
      contentCategory: resolveContentCategory(contentCategory, nextFile.mimeType),
    })
  }

  const handleUsbFileSelect = async (safeId: string) => {
    if (usbUploading) return
    setUsbUploading(true)
    setUsbError(null)
    try {
      const result = await uploadUsbFile(safeId)
      const nextFile: UploadedFile = {
        name: result.filename,
        size: formatBytes(result.sizeBytes),
        pages: null,
        fileId: result.fileId,
        fileUrl: result.fileUrl ?? '',
        fileMd5: result.sha256,
        mimeType: result.mimeType,
      }
      setFile(nextFile)
      savePrintMaterialSession({
        file: nextFile,
        source,
        contentCategory: resolveContentCategory(contentCategory, nextFile.mimeType),
      })
    } catch (err) {
      setUsbError(userMessageOf(err, 'U 盘文件导入失败，请重试'))
      // 该 safeId 在 Agent 侧多半已因一次性消费失效,刷新列表让用户重选。
      setUsbFiles(null)
      setUsbStatus(null)
    } finally {
      setUsbUploading(false)
    }
  }

  const handleNext = () => {
    if (!file) return
    savePrintMaterialSession({
      file,
      source,
      contentCategory: resolveContentCategory(contentCategory, file.mimeType),
    })
    navigate('/print/material-check', { state: { file, source } })
  }

  return (
    <PrintPageFrame className="p-6">
      <div className="flex min-h-full flex-col" data-w2-page="print-upload">
        <PrintPrototypeHeader
          title={pageTitle}
          subtitle={pageSubtitle}
          step={1}
          backLabel={isTransferMode ? '返回打印扫描' : '返回首页'}
          onBack={() => navigate(isTransferMode ? '/print-scan' : '/')}
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

        {/* 直达模式：入口已经把通道定死了，不再摆等权网格。
            其余通道降级为一行次要链接 —— 用户仍然换得了，只是不必先答一遍已经答过的问题。 */}
        {/* 有文件后这一行就撤掉：换通道的时机在传文件之前。
            传完再让人点「改用 U 盘」只会静默丢掉已传的文件，用户到下一步才发现是空的；
            要重来有文件卡自带的 × 按钮，那条路径会一并清掉服务端会话。
            刻意不用 window.confirm 兜底 —— CLAUDE.md §17 禁止一体机出现系统级弹窗，
            全 kiosk 也无此先例。 */}
        {isTransferMode && !file && (
          <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-500">
            <span>也可以改用：</span>
            {tabs
              .filter(({ key }) => key !== tab)
              .map(({ key, label, disabled, note }) => (
                <button
                  key={key}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return
                    setTab(key)
                    setUploadError(null)
                  }}
                  className={[
                    // 次要链接也要够得着：一体机上任何可点区域不小于 48px。
                    'min-h-[48px] rounded px-2 font-medium underline underline-offset-4',
                    disabled
                      ? 'cursor-not-allowed text-neutral-300 no-underline'
                      : 'text-primary-600 hover:text-primary-700',
                  ].join(' ')}
                >
                  {label}
                  {disabled && note ? `（${note}）` : ''}
                </button>
              ))}
          </div>
        )}

        {/* Tab bar。
            直达模式下**整块不渲染**，而不是加 `hidden` 类 —— 后者被
            .w2-print-upload-source-grid 自己的 display:grid 盖掉，实测真机上网格照样可见，
            而静态门禁看不出这个差别（类名在源码里就算数）。 */}
        {!isTransferMode && (
        <div className="w2-print-upload-source-grid mt-6 grid grid-cols-2 gap-3">
          {tabs.map(({ key, label, icon: Icon, disabled, note }) => (
            <button
              key={key}
              disabled={disabled}
              onClick={() => {
                if (!disabled) {
                  setTab(key)
                  setFile(null)
                  setUploadError(null)
                }
              }}
              className={[
                'flex min-h-[72px] items-center justify-center gap-2 rounded-lg border py-4 text-sm font-medium transition-colors',
                disabled
                  ? 'cursor-not-allowed border-neutral-100 bg-neutral-50 text-neutral-300'
                  : tab === key
                    ? 'border-primary-600 bg-primary-50 text-primary-600'
                    : 'border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300 hover:text-neutral-700',
              ].join(' ')}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
              {note && (
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium">
                  {note}
                </span>
              )}
            </button>
          ))}
          {!isResumePrint && (
            <button
              type="button"
              onClick={() => navigate('/scan/start')}
              className="flex min-h-[72px] items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white py-4 text-sm font-medium text-neutral-500 transition-colors hover:border-primary-400 hover:text-primary-700"
            >
              <PrinterIcon className="h-5 w-5" />
              <span>扫描原件</span>
            </button>
          )}
        </div>
        )}

        {recentFiles.length > 0 && (
          <section
            className="mt-4 rounded-lg border border-neutral-200 bg-white p-4"
            aria-label="最近打印文件"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-neutral-900">最近文件</h2>
              <span className="text-xs text-neutral-500">最近 3 份</span>
            </div>
            <div className="grid gap-2">
              {recentFiles.map((item) => (
                <div
                  key={item.id}
                  className="flex min-h-[56px] items-center gap-3 rounded-lg bg-neutral-50 px-3"
                >
                  <FileTextIcon className="h-5 w-5 shrink-0 text-primary-600" />
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900"
                    title={item.fileName ?? '打印文件'}
                  >
                    {truncateFileNameMiddle(item.fileName ?? '打印文件', {
                      maxLength: FILE_NAME_BUDGET_COMPACT,
                    })}
                  </span>
                  <span className="text-xs text-neutral-500">{item.status}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tab content */}
        <div className="mt-4 flex flex-1 flex-col">
          {tab === 'file' && (
            <div className="flex flex-1 flex-col gap-3">
              {/* Hidden file input — A2 桌面验证路径 */}
              <input
                ref={inputRef}
                type="file"
                accept={contentCategory === 'photo' ? '.jpg,.jpeg,.png' : '.pdf,.jpg,.jpeg,.png'}
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
                    <p className="truncate font-medium text-neutral-900" title={file.name}>
                      {truncateFileNameMiddle(file.name, { maxLength: FILE_NAME_BUDGET_CARD })}
                    </p>
                    <p className="mt-0.5 text-sm text-neutral-500">{file.size} · 页数待识别</p>
                  </div>
                  <button
                    onClick={() => {
                      setFile(null)
                      setUploadError(null)
                      clearPrintMaterialSession()
                    }}
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
                        <p className="text-lg font-medium text-neutral-700">
                          {source === 'resume' ? '点击选择简历文件' : '点击选择文件'}
                        </p>
                        <p className="mt-1.5 text-sm text-neutral-400">
                          {source === 'resume'
                            ? `支持 PDF、JPG、PNG，单份不超过 ${PRINT_UPLOAD_MAX_MB}MB，适合已有电子简历直接打印`
                            : `支持 PDF、JPG、PNG，单份不超过 ${PRINT_UPLOAD_MAX_MB}MB，上传后将先做材料检查`}
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
                    <p className="truncate font-medium text-neutral-900" title={file.name}>
                      {truncateFileNameMiddle(file.name, { maxLength: FILE_NAME_BUDGET_CARD })}
                    </p>
                    <p className="mt-0.5 text-sm text-neutral-500">
                      {file.size} · 已确认，可点击下方"下一步"
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setFile(null)
                      setUploadError(null)
                      clearPrintMaterialSession()
                    }}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-neutral-100"
                  >
                    <XIcon className="h-4 w-4 text-neutral-400" />
                  </button>
                </Card>
              )}
              <UploadSessionQrPanel
                purpose="print_doc"
                title="手机扫码上传"
                description={
                  isResumePrint
                    ? '手机扫码上传简历（PDF/图片）；一体机确认后进入打印材料检查。'
                    : '手机或其他联网设备打开链接上传文件；一体机上确认后自动填入本次打印任务。'
                }
                confirmLabel="确认使用这份文件"
                onUploaded={handleQrUploaded}
                onBusyChange={setQrBusy}
              />
            </div>
          )}

          {tab === 'usb' && (
            <div className="flex flex-1 flex-col gap-3">
              {usbError && (
                <div className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-3 py-2 text-sm text-error-fg">
                  <AlertCircleIcon className="h-4 w-4 shrink-0" />
                  {usbError}
                </div>
              )}

              {file ? (
                <Card className="flex items-center gap-4 p-5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                    <FileTextIcon className="h-6 w-6 text-primary-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-neutral-900" title={file.name}>
                      {truncateFileNameMiddle(file.name, { maxLength: FILE_NAME_BUDGET_CARD })}
                    </p>
                    <p className="mt-0.5 text-sm text-neutral-500">{file.size} · 已从 U 盘导入</p>
                  </div>
                  <button
                    onClick={() => {
                      setFile(null)
                      setUploadError(null)
                      clearPrintMaterialSession()
                    }}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-neutral-100"
                  >
                    <XIcon className="h-4 w-4 text-neutral-400" />
                  </button>
                </Card>
              ) : usbStatus?.present ? (
                usbFiles === null ? (
                  <Card className="flex h-full flex-col items-center justify-center gap-4 p-8">
                    <LoaderIcon className="h-8 w-8 animate-spin text-primary-400" />
                    <p className="text-sm text-neutral-500">正在读取 U 盘文件列表…</p>
                  </Card>
                ) : usbFiles.length === 0 ? (
                  <Card className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                    <UsbIcon className="h-10 w-10 text-neutral-400" />
                    <p className="text-base font-medium text-neutral-700">未检测到可导入的文件</p>
                    <p className="text-sm text-neutral-500">
                      仅支持 PDF、JPG、PNG 格式，且不超过 {PRINT_UPLOAD_MAX_MB}MB
                    </p>
                  </Card>
                ) : (
                  <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
                    {usbFiles.map((f) => (
                      <button
                        key={f.safeId}
                        disabled={usbUploading}
                        onClick={() => handleUsbFileSelect(f.safeId)}
                        className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white p-4 text-left transition-colors hover:border-primary-400 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <FileTextIcon className="h-6 w-6 shrink-0 text-primary-600" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-neutral-900" title={f.filename}>
                            {truncateFileNameMiddle(f.filename, { maxLength: FILE_NAME_BUDGET_CARD })}
                          </p>
                          <p className="text-sm text-neutral-500">{formatBytes(f.sizeBytes)}</p>
                        </div>
                        {usbUploading && (
                          <LoaderIcon className="h-5 w-5 shrink-0 animate-spin text-primary-400" />
                        )}
                      </button>
                    ))}
                  </div>
                )
              ) : (
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
                </Card>
              )}
            </div>
          )}
        </div>

        {/* Bottom action */}
        <div className="print-upload-footer mt-6 flex gap-3">
          <Button
            variant="secondary"
            size="lg"
            className="flex-1"
            onClick={() => navigate(isTransferMode ? '/print-scan' : '/')}
          >
            {isTransferMode ? '返回打印扫描' : '取消'}
          </Button>
          <Button size="lg" className="flex-1" disabled={!file || uploading} onClick={handleNext}>
            {/* 搬运本身不产出打印件，主按钮要说清下一步到底是什么，而不是一个没有指向的「下一步」。
                刻意不做「传完自动跳走」：重新进本页会 file=null，用户会被迫再传一次。 */}
            {isTransferMode ? '继续文档打印' : '下一步'}
          </Button>
        </div>
      </div>
    </PrintPageFrame>
  )
}
