import { useNavigate, useLocation } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import { makePrintParams } from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  CheckCircleIcon,
  CheckIcon,
  FileTextIcon,
  FolderIcon,
  HomeIcon,
  PrinterIcon,
  RotateCcwIcon,
  SparklesIcon,
} from 'lucide-react'

type ScanType = 'resume' | 'id' | 'document'

interface ScannedFile {
  fileId: string
  fileUrl: string
  name: string
  size: string
  pages: number | null
  format: 'PDF'
  mimeType?: string
}

interface ScanResultState {
  scanType?: ScanType
  source?: string
  pageMode?: string
  color?: string
  dpi?: number
  success?: boolean
  reason?: string
  file?: ScannedFile
}

const CONTROL_FIELDS = new Set(['success', 'reason', 'simulateFailure', 'failReason', 'file'])

const SCAN_TYPE_LABELS: Record<ScanType, string> = {
  resume: '简历扫描',
  id: '证件扫描',
  document: '普通文档',
}

export function ScanResultPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as ScanResultState
  const { scanType = 'document', success = true, reason, file } = state

  const handleRetry = () => {
    const retryState = Object.fromEntries(
      Object.entries(state).filter(([k]) => !CONTROL_FIELDS.has(k)),
    )
    navigate('/scan/settings', { state: retryState })
  }

  const handlePrint = () => {
    if (!file) return
    navigate('/print/confirm', {
      state: {
        file: { fileId: file.fileId, fileUrl: file.fileUrl, name: file.name, size: file.size, pages: file.pages, mimeType: file.mimeType },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
      },
    })
  }

  const handleSave = () => {
    if (!file) return
    navigate('/me/documents')
  }

  const handleResumeAI = () => {
    if (!file) return
    navigate('/resume/parse', {
      state: {
        source: 'scan',
        // ResumeParsePage 只读顶层 state.fileId 发起解析请求，file 内的 fileId/fileUrl
        // 仅用于展示；与 ResumeSourcePage 的既有上传流程保持同一 state 契约。
        fileId: file.fileId,
        file: { fileId: file.fileId, fileUrl: file.fileUrl, name: file.name, size: file.size, format: file.format },
      },
    })
  }

  if (!success) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-canvas p-8 text-neutral-900">
        <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-error-bg">
          <AlertCircleIcon className="h-14 w-14 text-error-fg" />
        </div>
        <h1 className="text-3xl font-bold">扫描失败</h1>
        <p className="mt-3 max-w-xl text-center text-lg text-neutral-500">{reason ?? '扫描任务未能完成，请重试或联系工作人员'}</p>
        <div className="mt-8 flex w-full max-w-lg gap-3">
          <Button variant="secondary" size="lg" className="h-14 flex-1 text-lg" onClick={() => navigate('/')}>
            返回首页
          </Button>
          <Button size="lg" className="h-14 flex-1 text-lg" onClick={handleRetry}>
            重试扫描
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-canvas px-6 py-5 text-neutral-900">
      <header className="flex h-[72px] shrink-0 items-center justify-between rounded-lg bg-dark px-6 text-surface shadow-sm">
        <div>
          <b className="block text-[21px] font-bold">就业服务大厅 · 01号机</b>
          <span className="mt-1 block text-sm text-neutral-100">AI求职打印服务终端</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-base text-neutral-100">2026年7月17日 10:30</span>
          <span className="inline-flex h-10 items-center gap-2 rounded-full bg-success-bg px-4 text-base font-semibold text-success-fg">
            <span className="h-2.5 w-2.5 rounded-full bg-current" />
            扫描仪就绪
          </span>
        </div>
      </header>

      <div className="mt-5 flex shrink-0 items-center justify-between gap-5">
        <div>
          <h1 className="font-serif text-[42px] font-black leading-tight tracking-normal">扫描完成</h1>
          <p className="mt-1 text-xl text-neutral-500">文件已生成，请核对页数与清晰度，选择下一步操作</p>
        </div>
        <span className="inline-flex h-11 items-center gap-2 rounded-full bg-success-bg px-4 text-lg font-semibold text-success-fg">
          <CheckCircleIcon className="h-5 w-5" />
          扫描已完成
        </span>
      </div>

      <div className="mt-5 grid grid-cols-[auto_1fr_auto_1fr_auto_1fr_auto] items-center gap-3 rounded-lg border border-neutral-200 bg-surface px-5 py-4">
        {['选择类型', '扫描指引', '扫描中', '完成'].map((label, index) => (
          <div key={label} className="contents">
            <div className="flex items-center gap-2 text-lg font-semibold text-primary-700">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-primary-600 text-base font-bold text-surface">
                <CheckIcon className="h-5 w-5" />
              </span>
              <span>{label}</span>
            </div>
            {index < 3 && <div className="h-px bg-primary-600" />}
          </div>
        ))}
      </div>

      <main className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
        <section className="rounded-lg border border-primary-200 bg-surface p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-50 text-primary-700">
              <FileTextIcon className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-[26px] font-bold">扫描结果</h2>
              <p className="text-base text-neutral-500">{SCAN_TYPE_LABELS[scanType]} · 如不满意可返回重新扫描</p>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <div className="flex flex-col items-center gap-2">
              <div className="flex gap-4">
                {[0, 1].map((item) => (
                  <div key={item} className="flex aspect-[210/297] w-[132px] flex-col gap-1.5 rounded-md border border-neutral-200 bg-white p-3 shadow-sm">
                    <i className="h-2 w-1/2 rounded-full bg-neutral-800/70" />
                    <i className="h-1.5 w-4/5 rounded-full bg-neutral-200" />
                    <i className="h-5 rounded bg-primary-50 ring-1 ring-primary-200" />
                    <i className="h-1.5 w-4/5 rounded-full bg-neutral-200" />
                    <i className="h-1.5 w-3/5 rounded-full bg-neutral-200" />
                    <i className="h-4 rounded bg-warning-bg" />
                    <i className="h-1.5 w-4/5 rounded-full bg-neutral-200" />
                  </div>
                ))}
              </div>
              <span className="text-[15px] text-neutral-500">页面预览示意 · 以实际文件为准</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3 break-all text-[27px] font-bold">
                <FileTextIcon className="h-8 w-8 shrink-0 text-primary-700" />
                {file?.name ?? 'scan-result.pdf'}
              </div>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <span className="rounded-full bg-neutral-50 px-3.5 py-1.5 text-base font-semibold text-neutral-600">{file?.size ?? '待确认'}</span>
                <span className="rounded-full bg-success-bg px-3.5 py-1.5 text-base font-semibold text-success-fg">{file?.format ?? 'PDF'}</span>
                <span className="rounded-full bg-neutral-50 px-3.5 py-1.5 text-base font-semibold text-neutral-600">{file?.pages != null ? `${file.pages} 页` : 'A4 幅面 · 页数以文件为准'}</span>
                <span className="rounded-full bg-warning-bg px-3.5 py-1.5 text-base font-semibold text-warning-fg">未保存前设有效期</span>
              </div>
              <p className="mt-3 text-[17px] leading-relaxed text-neutral-500">
                文件当前为临时保存；选择「保存到我的文档」后可长期查看，未选择去向的文件在本次服务结束后自动清理。
              </p>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-primary-200 bg-surface p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-50 text-primary-700">
              <SparklesIcon className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-[26px] font-bold">选择下一步操作</h2>
              <p className="text-base text-neutral-500">简历扫描推荐直接进入 AI 简历识别</p>
            </div>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-4">
            <button
              type="button"
              disabled={scanType !== 'resume' || !file}
              onClick={handleResumeAI}
              className="flex items-center gap-5 rounded-lg border-2 border-primary-300 bg-primary-50 p-5 text-left disabled:opacity-45"
            >
              <span className="grid h-[68px] w-[68px] shrink-0 place-items-center rounded-[16px] bg-primary-600 text-surface">
                <SparklesIcon className="h-9 w-9" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-2xl font-bold">AI 简历识别</b>
                <span className="mt-1 block text-[17px] leading-relaxed text-neutral-500">识别扫描件内容，进入简历诊断与优化</span>
              </span>
              <span className="rounded-full border border-primary-200 bg-surface px-3.5 py-1.5 text-[15px] font-semibold text-primary-700">简历类型推荐</span>
            </button>
            <button type="button" disabled={!file} onClick={handlePrint} className="flex items-center gap-5 rounded-lg border-2 border-neutral-200 bg-canvas p-5 text-left disabled:opacity-45">
              <span className="grid h-[68px] w-[68px] shrink-0 place-items-center rounded-[16px] border border-neutral-200 bg-surface text-primary-700">
                <PrinterIcon className="h-9 w-9" />
              </span>
              <span><b className="block text-2xl font-bold">直接打印</b><span className="mt-1 block text-[17px] leading-relaxed text-neutral-500">按默认参数（黑白单面 1 份）进入确认打印，可再修改</span></span>
            </button>
            <button type="button" disabled={!file} onClick={handleSave} className="flex items-center gap-5 rounded-lg border-2 border-neutral-200 bg-canvas p-5 text-left disabled:opacity-45">
              <span className="grid h-[68px] w-[68px] shrink-0 place-items-center rounded-[16px] border border-neutral-200 bg-surface text-primary-700">
                <FolderIcon className="h-9 w-9" />
              </span>
              <span><b className="block text-2xl font-bold">保存到我的文档</b><span className="mt-1 block text-[17px] leading-relaxed text-neutral-500">当前为临时保存；登录并保存后可长期管理</span></span>
            </button>
            <button type="button" onClick={() => navigate('/')} className="flex items-center gap-5 rounded-lg border-2 border-neutral-200 bg-canvas p-5 text-left">
              <span className="grid h-[68px] w-[68px] shrink-0 place-items-center rounded-[16px] border border-neutral-200 bg-surface text-primary-700">
                <HomeIcon className="h-9 w-9" />
              </span>
              <span><b className="block text-2xl font-bold">返回首页</b><span className="mt-1 block text-[17px] leading-relaxed text-neutral-500">结束本次扫描，回到功能大厅</span></span>
            </button>
          </div>
        </section>
      </main>

      <div className="mt-5 flex h-[76px] shrink-0 items-center gap-4 border-t border-neutral-200 bg-canvas pt-4">
        <Button variant="secondary" size="lg" className="h-14 px-7 text-lg" onClick={handleRetry}>
          <RotateCcwIcon className="mr-2 h-5 w-5" />
          重新扫描
        </Button>
        <span className="flex-1" />
        <span className="text-lg text-neutral-500">请选择上方任一操作继续；未保存去向的文件将在本次服务结束后清理</span>
      </div>
    </div>
  )
}
