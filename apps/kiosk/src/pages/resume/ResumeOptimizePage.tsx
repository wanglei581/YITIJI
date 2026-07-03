import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import ReactDiffViewer from 'react-diff-viewer-continued'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileDownIcon,
  FlaskConicalIcon,
  InfoIcon,
  PrinterIcon,
  SparklesIcon,
  TargetIcon,
} from 'lucide-react'
import type {
  GeneratedResume,
  ResumeExportFormat,
  ResumeGenerateExportResponse,
  ResumeOptimizeModule,
  ResumeTargetContext,
} from '@ai-job-print/shared'
import { COMPLIANCE_COPY, makePrintParams } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { exportGeneratedResume, getResumeOptimize } from '../../services/api'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { readAiResumeSession } from './aiResumeSession'
import { OptimizedResumeEditor } from './components/OptimizedResumeEditor'
import { ResumeLayoutControls } from './components/ResumeLayoutControls'
import { useResumeLayout } from './hooks/useResumeLayout'

/** 导出格式可选项(Wave1 Task 8):PDF 可直接打印,Word/TXT/Markdown 供下载编辑。 */
const EXPORT_FORMAT_OPTIONS: { value: ResumeExportFormat; label: string }[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Word' },
  { value: 'txt', label: 'TXT' },
  { value: 'md', label: 'Markdown' },
]

function targetSummary(tc?: ResumeTargetContext): string | null {
  if (!tc) return null
  if (tc.skipped) return '通用诊断（未指定方向）'
  const parts = [tc.industry, tc.targetJob, tc.experience, tc.scene].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

type LeaveAction = () => void

export function ResumeOptimizePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = location.state as Record<string, unknown> | null

  const session = useMemo(() => readAiResumeSession(), [])
  const queryTaskId = useMemo(() => new URLSearchParams(location.search).get('taskId') ?? undefined, [location.search])
  const stateTaskId = typeof state?.taskId === 'string' ? state.taskId : undefined
  const taskId = stateTaskId ?? queryTaskId ?? session?.taskId
  const usingSessionTask = !stateTaskId && !queryTaskId && Boolean(session?.taskId)
  const accessToken = (typeof state?.accessToken === 'string' ? state.accessToken : undefined) ?? (usingSessionTask ? session?.accessToken : undefined)
  const file   = state?.file as { name: string; size: string; format: string } | undefined
  const targetContext = state?.targetContext as ResumeTargetContext | undefined
  const summary = targetSummary(targetContext)

  const [modules,  setModules]  = useState<ResumeOptimizeModule[]>([])
  const [optimizedResume, setOptimizedResume] = useState<GeneratedResume | null>(null)
  const [providerName, setProviderName] = useState<string | undefined>(undefined)
  const [loading,  setLoading]  = useState(true)
  const [failMsg,  setFailMsg]  = useState<string | null>(null)

  const [exporting, setExporting] = useState(false)
  const [printNavigating, setPrintNavigating] = useState(false)
  const [exportFormat, setExportFormat] = useState<ResumeExportFormat>('pdf')
  const [exported, setExported] = useState<ResumeGenerateExportResponse | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState<LeaveAction | null>(null)
  const { layout, setLayout, previewClassName, previewStyle } = useResumeLayout()

  useBusyLock(exporting || printNavigating)

  useEffect(() => {
    if (!taskId) {
      // 直接打开 /resume/optimize 且无任务上下文:引导回优化上传入口
      setLoading(false)
      setFailMsg('请先上传简历完成诊断')
      return
    }
    let cancelled = false
    getResumeOptimize(taskId, { token: getToken(), accessToken })
      .then((res) => {
        if (cancelled) return
        setProviderName(res.providerName)
        if (res.status === 'completed') {
          setModules(res.modules ?? [])
          setOptimizedResume(res.optimizedResume ?? null)
          if (!res.optimizedResume && (res.modules ?? []).length === 0) {
            setFailMsg('暂无优化建议，请返回重新解析')
          }
        } else {
          const reason = res.failReason ?? ''
          if (reason.includes('重新上传')) {
            setFailMsg('文件已过期，请重新上传简历')
          } else {
            setFailMsg(reason || '暂无优化建议，请返回重新解析')
          }
        }
      })
      .catch(() => { if (!cancelled) setFailMsg('优化结果读取失败，请返回重新解析') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [taskId, accessToken, getToken])

  const handleSaveAdvice = () => {
    const advice = modules.map((m) => ({ title: m.title, before: m.before, after: m.after }))
    navigate('/profile', {
      state: {
        savedResumeAdvice: { file, suggestions: advice, savedAt: new Date().toISOString() },
      },
    })
  }

  const requestLeave = (action: LeaveAction) => {
    if (isDirty && !exported) {
      setConfirmLeave(() => action)
      return
    }
    action()
  }

  const markEdited = () => {
    setIsDirty(true)
    if (exported) setExported(null)
  }

  const handleResumeChange = (next: GeneratedResume) => {
    markEdited()
    setOptimizedResume(next)
  }

  const handleLayoutChange = (next: typeof layout) => {
    setLayout(next)
    markEdited()
  }

  const handleExport = async () => {
    if (!optimizedResume) return
    setExporting(true)
    setExportError(null)
    try {
      const result = await exportGeneratedResume(optimizedResume, taskId, getToken(), exportFormat, layout)
      setExported(result)
      setIsDirty(false)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : '导出失败，请稍后重试')
    } finally {
      setExporting(false)
    }
  }

  // 切换导出格式后,已导出的旧格式文件不再对应当前选择,需重新导出
  const handleExportFormatChange = (format: ResumeExportFormat) => {
    setExportFormat(format)
    if (exported) setExported(null)
  }

  const handlePrint = () => {
    if (printNavigating || !exported?.printFileUrl || exportFormat !== 'pdf') return
    setPrintNavigating(true)
    navigate('/print/confirm', {
      state: {
        file: {
          name: exported.filename,
          size: exported.sizeBytes >= 1024 * 1024
            ? `${(exported.sizeBytes / 1024 / 1024).toFixed(1)} MB`
            : `${Math.max(1, Math.round(exported.sizeBytes / 1024))} KB`,
          pages: exported.pageCount,
          fileId: exported.fileId,
          fileUrl: exported.printFileUrl,
          mimeType: 'application/pdf',
        },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
      },
    })
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col p-6">
        <PageHeader
          title="优化建议"
          subtitle="基于已有内容优化表达"
          actions={<Button size="sm" variant="secondary" onClick={() => navigate(-1)}>返回报告</Button>}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-50">
            <SparklesIcon className="h-10 w-10 animate-pulse text-primary-600" />
          </div>
          <p className="text-base text-gray-500">正在生成优化建议…</p>
        </div>
      </div>
    )
  }

  if (failMsg) {
    return (
      <div className="flex h-full flex-col p-6">
        <PageHeader
          title="优化建议"
          subtitle="基于已有内容优化表达"
          actions={<Button size="sm" variant="secondary" onClick={() => navigate(-1)}>返回报告</Button>}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <AlertCircleIcon className="h-14 w-14 text-gray-300" />
          <p className="text-base text-gray-500">{failMsg}</p>
          <Button size="lg" onClick={() => navigate('/resume/source?intent=optimize')}>
            重新上传简历
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="优化建议"
        subtitle="基于已有内容优化表达(仅供参考)"
        actions={<Button size="sm" variant="secondary" onClick={() => requestLeave(() => navigate(-1))}>返回报告</Button>}
      />

      {providerName === 'mock' && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <FlaskConicalIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{COMPLIANCE_COPY.KIOSK_RESUME_DEMO_NOTICE}</p>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-gray-50 px-4 py-2.5">
        <InfoIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        <p className="text-xs text-gray-400">
          {COMPLIANCE_COPY.KIOSK_RESUME_OPTIMIZE_DISCLAIMER}页面只展示表达调整参考,不承诺提分或招聘结果。
        </p>
      </div>

      {summary && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-primary-100 bg-primary-50/60 px-4 py-2.5">
          <TargetIcon className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
          <p className="text-sm text-gray-700">
            目标方向：<span className="font-medium text-primary-700">{summary}</span>
          </p>
        </div>
      )}

      <div className={[
        'mt-4 flex flex-1 flex-col gap-4',
        confirmLeave ? 'overflow-hidden' : 'overflow-y-auto',
      ].join(' ')}>
        {modules.length > 0 && (
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">表达调整参考</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{modules.length} 组可对照修改项</p>
                <p className="mt-1 text-xs text-gray-400">基于诊断结果与原文片段生成,不展示无依据的分数提升。</p>
              </div>
            </div>
          </Card>
        )}

        {modules.map((mod, idx) => (
          <Card key={`${mod.title}-${idx}`} className="overflow-hidden p-0">
            <div className="border-b border-gray-200 px-5 py-3">
              <p className="text-sm font-semibold text-gray-800">{mod.title}</p>
            </div>
            <div className="text-xs [overflow-wrap:anywhere] [&_pre]:whitespace-pre-wrap">
                <ReactDiffViewer
                  oldValue={mod.before}
                  newValue={mod.after}
                  splitView={false}
                  disableWordDiff={false}
                  hideLineNumbers={true}
                leftTitle="优化前(摘自原文)"
                rightTitle="建议参考"
                useDarkTheme={false}
              />
            </div>
          </Card>
        ))}

        {optimizedResume && (
          <>
            <ResumeLayoutControls layout={layout} onChange={handleLayoutChange} disabled={exporting} />
            <OptimizedResumeEditor
              resume={optimizedResume}
              onChange={handleResumeChange}
              layout={layout}
              previewClassName={previewClassName}
              previewStyle={previewStyle}
            />
          </>
        )}

        {exportError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{exportError}</p>}

        {exported && (
          <Card className="border-green-100 bg-green-50/60 p-5">
            <p className="flex items-center gap-2 text-base font-semibold text-green-800">
              <CheckCircle2Icon className="h-5 w-5" aria-hidden="true" />
              优化版{EXPORT_FORMAT_OPTIONS.find((o) => o.value === exportFormat)?.label ?? 'PDF'} 已生成
            </p>
            <p className="mt-1 text-sm text-green-700">
              {exported.filename}
              {exported.pageCount > 0 ? ` · ${exported.pageCount} 页` : ''}
              {exported.sizeBytes > 0 ? ` · ${Math.max(1, Math.round(exported.sizeBytes / 1024))} KB` : ''}
            </p>
            {!exported.signedUrl && (
              <p className="mt-1 text-xs text-amber-700">演示模式未生成真实文件,接入后端后可下载或打印。</p>
            )}
            <p className="mt-1 text-xs text-green-700/80">文件短期保留后自动清理,本机不长期保存你的简历。</p>
          </Card>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {optimizedResume && (
          <div>
            <p className="mb-2 text-xs font-semibold text-gray-500">导出格式</p>
            <div className="grid grid-cols-4 gap-2">
              {EXPORT_FORMAT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={exportFormat === option.value}
                  disabled={exporting}
                  onClick={() => handleExportFormatChange(option.value)}
                  className={[
                    'min-h-[48px] rounded-xl border px-2 text-sm font-semibold transition-colors active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
                    exportFormat === option.value
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 bg-white text-gray-600',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {optimizedResume && !exported && (
          <Button
            size="lg"
            className="flex items-center justify-center gap-2"
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            <FileDownIcon className="h-5 w-5" />
            {exporting ? '正在生成文件…' : `确认优化版,导出 ${EXPORT_FORMAT_OPTIONS.find((o) => o.value === exportFormat)?.label ?? 'PDF'}`}
          </Button>
        )}
        {exported && (
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" variant="secondary" disabled={exporting} onClick={() => void handleExport()}>
              重新导出
            </Button>
            {exportFormat === 'pdf' ? (
              <Button
                size="lg"
                className="flex items-center justify-center gap-2"
                disabled={!exported.printFileUrl || printNavigating}
                onClick={handlePrint}
              >
                <PrinterIcon className="h-5 w-5" />
                {printNavigating ? '正在进入打印确认…' : exported.printFileUrl ? '去打印优化版' : '打印链接未就绪'}
              </Button>
            ) : (
              <Button
                size="lg"
                variant="secondary"
                className="flex items-center justify-center gap-2"
                disabled={!exported.signedUrl}
                onClick={() => exported.signedUrl && window.open(exported.signedUrl, '_blank', 'noopener')}
              >
                <FileDownIcon className="h-5 w-5" />
                下载{EXPORT_FORMAT_OPTIONS.find((o) => o.value === exportFormat)?.label}
              </Button>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" variant="secondary" onClick={() => requestLeave(handleSaveAdvice)}>保存优化建议</Button>
          <Button size="lg" variant="secondary" onClick={() => requestLeave(() => navigate('/'))}>返回首页</Button>
        </div>
      </div>

      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/35 px-6">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <p className="text-lg font-bold text-gray-900">离开前确认</p>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              你已经修改了优化版简历。未导出 PDF 前离开，本次编辑内容不会保存。
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button size="lg" variant="secondary" onClick={() => setConfirmLeave(null)}>继续编辑</Button>
              <Button size="lg" onClick={() => {
                const action = confirmLeave
                setConfirmLeave(null)
                action()
              }}>
                确认离开
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
