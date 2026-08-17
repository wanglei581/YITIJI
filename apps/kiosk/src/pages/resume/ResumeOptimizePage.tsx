import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, KioskActionBar, KioskPageFrame, KioskPageHeader, Stepper } from '@ai-job-print/ui'
import type { StepperStep } from '@ai-job-print/ui'
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  EyeIcon,
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
  ResumeTemplate,
  ResumeTargetContext,
} from '@ai-job-print/shared'
import { COMPLIANCE_COPY, makePrintParams } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { adjustResumeLayoutDraft, exportGeneratedResume, getResumeOptimize } from '../../services/api'
import type { ResumeLayoutAdjustAction } from '../../services/api'
import { getResumeTemplates } from '../../services/api/jobMaterials'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { FilePreviewDialog } from '../../components/FilePreviewDialog'
import { readAiResumeSession } from './aiResumeSession'
import { OptimizedResumeEditor } from './components/OptimizedResumeEditor'
import { ResumeLayoutControls } from './components/ResumeLayoutControls'
import { useResumeLayout } from './hooks/useResumeLayout'
import './resume-authoring-lightflow.css'
import './resume-fusion-youth.css'

/** 导出格式可选项 */
const EXPORT_FORMAT_OPTIONS: { value: ResumeExportFormat; label: string }[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Word' },
  { value: 'txt', label: 'TXT' },
  { value: 'md', label: 'Markdown' },
]

const OPTIMIZE_STEPS: StepperStep[] = [
  { title: '上传与方向' },
  { title: 'AI 解析' },
  { title: '诊断报告' },
  { title: '优化打印' },
]

/** 从 title 推断建议类型，用于概览条 chip 标签 */
function countModuleTypes(modules: ResumeOptimizeModule[]) {
  let strong = 0, quantify = 0, trim = 0
  modules.forEach((m) => {
    const t = m.title.toLowerCase()
    if (t.includes('量化') || t.includes('数据') || t.includes('成果')) quantify++
    else if (t.includes('冗余') || t.includes('精简') || t.includes('删')) trim++
    else strong++
  })
  return { strong, quantify, trim }
}

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
  const [previewOpen, setPreviewOpen] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [resumeTemplates, setResumeTemplates] = useState<ResumeTemplate[]>([])
  /**
   * 模板列表**读取失败**，与「模板列表为空」是两件事，屏幕上必须长得不一样。
   * 原实现 `.catch(() => setResumeTemplates([]))` 把拿不到数据渲染成没有数据，
   * 属交付章程门槛①「不撒谎」的直接违反（`interface-handoff.md` §4A 硬线）。
   */
  const [templatesError, setTemplatesError] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState<LeaveAction | null>(null)
  const [adjusting, setAdjusting] = useState<ResumeLayoutAdjustAction | null>(null)
  const [lastResumeBeforeAiAdjust, setLastResumeBeforeAiAdjust] = useState<GeneratedResume | null>(null)
  const [adjustWarnings, setAdjustWarnings] = useState<string[]>([])
  const [adjustError, setAdjustError] = useState<string | null>(null)
  const { layout, setLayout, previewClassName, previewStyle } = useResumeLayout()
  const aiAdjustDisabled = loading || exporting || !optimizedResume || Boolean(adjusting)
  const selectedTemplate = useMemo(
    () => resumeTemplates.find((template) => template.id === selectedTemplateId) ?? null,
    [resumeTemplates, selectedTemplateId],
  )

  useBusyLock(exporting || printNavigating || Boolean(adjusting))

  useEffect(() => {
    let cancelled = false
    getResumeTemplates()
      .then((templates) => {
        if (cancelled) return
        setTemplatesError(false)
        setResumeTemplates(templates)
        setSelectedTemplateId((current) => {
          if (current && templates.some((template) => template.id === current)) return current
          return templates[0]?.id ?? ''
        })
      })
      .catch(() => {
        if (cancelled) return
        // 失败就说失败：不把读取失败伪装成「没有可选模板」。
        setTemplatesError(true)
        setResumeTemplates([])
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!taskId) {
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

  // 不做「保存」动作：优化结果在生成时已由服务端落库
  // （AiResumeResult kind='optimize'，见 services/api/src/ai/ai.service.ts），
  // 此处只带用户去看真实那份记录。
  //
  // 原实现 navigate('/profile', { state: { savedResumeAdvice } }) 把建议塞进
  // ProfilePage 的内存 useState（ProfilePage.tsx:46-53），刷新即丢，
  // 却提示「优化建议已加入本次记录」—— 用户以为存下了，实际没有。
  // 属 CLAUDE.md §9「不伪造能力」违规，已移除。
  const handleViewRecord = () => {
    navigate('/me/ai-records')
  }

  const requestLeave = (action: LeaveAction) => {
    if (isDirty && !exported) { setConfirmLeave(() => action); return }
    action()
  }

  const markEdited = () => {
    setIsDirty(true)
    setPreviewOpen(false)
    if (exported) setExported(null)
  }

  const handleResumeChange = (next: GeneratedResume) => {
    markEdited(); setLastResumeBeforeAiAdjust(null); setAdjustWarnings([]); setAdjustError(null); setOptimizedResume(next)
  }

  const handleLayoutChange = (next: typeof layout) => { setLayout(next); markEdited() }

  const handleExport = async () => {
    if (!optimizedResume) return
    setExporting(true); setExportError(null); setPreviewOpen(false)
    try {
      const result = await exportGeneratedResume(optimizedResume, taskId, getToken(), exportFormat, layout, selectedTemplateId || undefined)
      setExported(result); setIsDirty(false)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : '导出失败，请稍后重试')
    } finally { setExporting(false) }
  }

  const handleAiAdjust = async (action: ResumeLayoutAdjustAction) => {
    if (!taskId || !optimizedResume) return
    const before = optimizedResume; setAdjusting(action); setAdjustError(null)
    try {
      const result = await adjustResumeLayoutDraft(taskId, optimizedResume, action, layout, { token: getToken(), accessToken })
      setLastResumeBeforeAiAdjust(before); setOptimizedResume(result.resume); setAdjustWarnings(result.warnings ?? []); setExported(null); setIsDirty(true)
    } catch (err) {
      setAdjustError(err instanceof Error ? err.message : 'AI 调整失败，请稍后重试或继续手动编辑')
    } finally { setAdjusting(null) }
  }

  const handleUndoAiAdjust = () => {
    if (!lastResumeBeforeAiAdjust) return
    setOptimizedResume(lastResumeBeforeAiAdjust); setLastResumeBeforeAiAdjust(null)
    setAdjustWarnings([]); setAdjustError(null); setExported(null); setIsDirty(true)
  }

  const handleExportFormatChange = (format: ResumeExportFormat) => {
    setExportFormat(format); setPreviewOpen(false); if (exported) setExported(null)
  }

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId); setExportError(null); if (exported) setExported(null)
  }

  const handlePrint = () => {
    if (printNavigating || !exported?.printFileUrl) return
    setPrintNavigating(true)
    navigate('/print/confirm', {
      state: {
        file: {
          name: exported.filename,
          size: exported.sizeBytes >= 1024 * 1024 ? `${(exported.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(exported.sizeBytes / 1024))} KB`,
          pages: exported.pageCount, fileId: exported.fileId, fileUrl: exported.printFileUrl, mimeType: 'application/pdf',
        },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
      },
    })
  }

  if (loading) {
    return (
      <KioskPageFrame className="fusion-w3 fusion-w3--resume"><section data-kiosk-domain="resume" data-kiosk-screen="resume-optimize" className="resume-lightflow resume-optimize-lightflow resume-lightflow__state flex h-full flex-col p-6">
        <KioskPageHeader title="优化建议" description="基于已有内容优化表达" onBack={() => navigate(-1)} backLabel="返回报告" />
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-50">
            <SparklesIcon className="h-10 w-10 animate-pulse text-primary-600" />
          </div>
          <p className="text-base text-neutral-500">正在生成优化建议…</p>
        </div>
      </section></KioskPageFrame>
    )
  }

  if (failMsg) {
    return (
      <KioskPageFrame className="fusion-w3 fusion-w3--resume"><section data-kiosk-domain="resume" data-kiosk-screen="resume-optimize" className="resume-lightflow resume-optimize-lightflow resume-lightflow__state flex h-full flex-col p-6">
        <KioskPageHeader title="优化建议" description="基于已有内容优化表达" onBack={() => navigate(-1)} backLabel="返回报告" />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <AlertCircleIcon className="h-14 w-14 text-neutral-300" />
          <p className="text-base text-neutral-500">{failMsg}</p>
          <Button size="lg" onClick={() => navigate('/resume/source?intent=optimize')}>重新上传简历</Button>
        </div>
      </section></KioskPageFrame>
    )
  }

  const { strong, quantify, trim } = countModuleTypes(modules)

  return (
    <KioskPageFrame className="fusion-w3 fusion-w3--resume">
    <section data-kiosk-domain="resume" data-kiosk-screen="resume-optimize" className="resume-lightflow resume-optimize-lightflow flex h-full flex-col p-6">
      <div className="resume-lightflow__header">
        <KioskPageHeader
          title="优化建议"
          description="基于已有内容优化表达(仅供参考)，只重组原文事实，不补充虚构信息"
          onBack={() => requestLeave(() => navigate(-1))}
          backLabel="返回报告"
        />
        <div className="resume-lightflow__stepper mt-4">
          <Stepper steps={OPTIMIZE_STEPS} currentIndex={3} />
        </div>
      </div>

      {providerName === 'mock' && (
        <div className="resume-lightflow__notice mt-4 flex items-start gap-2 rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning-fg">
          <FlaskConicalIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{COMPLIANCE_COPY.KIOSK_RESUME_DEMO_NOTICE}</p>
        </div>
      )}

      {/* 内容区：左主列 + 右侧栏 */}
      <div className={[
        'resume-lightflow__content resume-lightflow__optimize-content mt-4 flex-1',
        confirmLeave ? 'overflow-hidden' : 'overflow-y-auto',
      ].join(' ')}>
        <div className="resume-lightflow__form-col">
            <div className="flex items-center gap-2 rounded-lg border border-neutral-100 bg-neutral-50 px-4 py-2.5">
              <InfoIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
              <p className="text-xs text-neutral-400">
                {COMPLIANCE_COPY.KIOSK_RESUME_OPTIMIZE_DISCLAIMER}页面只展示表达调整参考，不承诺提分或招聘结果。
              </p>
            </div>

            {summary && (
              <div className="flex items-center gap-2 rounded-lg border border-primary-100 bg-primary-50/60 px-4 py-2.5">
                <TargetIcon className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
                <p className="text-sm text-neutral-700">
                  目标方向：<span className="font-medium text-primary-700">{summary}</span>
                </p>
              </div>
            )}

            {modules.length > 0 && (
              <Card className="resume-lightflow__work-card p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-2xl font-bold text-neutral-900">{modules.length} 组可对照修改项</span>
                  {strong > 0 && <span className="rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">表达优化 ×{strong}</span>}
                  {quantify > 0 && <span className="rounded-full border border-warning-bg bg-warning-bg px-3 py-1 text-xs font-semibold text-warning-fg">量化留白提示 ×{quantify}</span>}
                  {trim > 0 && <span className="rounded-full border border-warning-bg bg-warning-bg px-3 py-1 text-xs font-semibold text-warning-fg">冗余删减 ×{trim}</span>}
                  <span className="text-xs text-neutral-400">基于诊断结果与原文片段生成，不展示无依据的分数提升</span>
                </div>
              </Card>
            )}

            {/*
              逐条对照已拆到 `/resume/optimize/compare`（S2-1，设计基线 09b-resume-optimize.html）。
              本页保留「有多少条 + 去哪看」，把「一条一条决定改不改」交给专门那一屏 ——
              27 寸竖屏上原先诊断评分与 N 组 diff 同屏，两块都读不清、按钮都点不准。
            */}
            {modules.length > 0 && (
              <Card className="resume-lightflow__comparison-card p-5">
                <p className="text-sm leading-relaxed text-neutral-600">
                  这 {modules.length} 组建议是「原句 → 候选表达」的逐条对照。对照要一条一条读才有用，
                  已单独放在一屏里，那里一次只让你决定一条。
                </p>
                <Button
                  size="lg"
                  variant="secondary"
                  className="resume-lightflow__compare-entry mt-4"
                  onClick={() =>
                    requestLeave(() =>
                      navigate('/resume/optimize/compare', { state: { taskId, accessToken } }),
                    )
                  }
                >
                  逐条看完整对照
                </Button>
              </Card>
            )}

            {optimizedResume && (
              <div className="resume-lightflow__editor-region">
                <OptimizedResumeEditor resume={optimizedResume} onChange={handleResumeChange}
                  layout={layout} previewClassName={previewClassName} previewStyle={previewStyle} />
              </div>
            )}

            {exportError && <p className="rounded-xl bg-error-bg px-4 py-3 text-sm text-error-fg">{exportError}</p>}

            {exported && (
              <Card className="resume-lightflow__export-card border-success-bg bg-success-bg/60 p-5">
                <p className="flex items-center gap-2 text-base font-semibold text-success-fg">
                  <CheckCircle2Icon className="h-5 w-5" aria-hidden="true" />
                  优化版{EXPORT_FORMAT_OPTIONS.find((o) => o.value === exportFormat)?.label ?? 'PDF'} 已生成
                </p>
                <p className="mt-1 text-sm text-success-fg">
                  {exported.filename}
                  {exported.pageCount > 0 ? ` · ${exported.pageCount} 页` : ''}
                  {exported.sizeBytes > 0 ? ` · ${Math.max(1, Math.round(exported.sizeBytes / 1024))} KB` : ''}
                </p>
                {!exported.signedUrl && (
                  <p className="mt-1 text-xs text-warning-fg">演示模式未生成真实文件，接入后端后可下载或打印。</p>
                )}
                <p className="mt-1 text-xs text-success-fg/80">文件短期保留后自动清理，本机不长期保存你的简历。</p>
              </Card>
            )}
        </div>

          {optimizedResume && (
            <aside className="resume-lightflow__sidebar" aria-label="排版与导出">
              <div className="fy-side-card">
                <h3>排版调整</h3>
                <p className="fy-side-sub">调整后编辑区实时预览，导出 PDF 按此排版</p>
                <ResumeLayoutControls layout={layout} onChange={handleLayoutChange} disabled={exporting} />
              </div>

              {/* 读取失败 ≠ 没有模板：说清是取不到，并给出仍然可用的路径。 */}
              {templatesError && (
                <div className="fy-side-card resume-lightflow__template-card" role="status">
                  <h3>简历模板</h3>
                  <p className="fy-side-sub">
                    模板列表这次没读取到，不是没有模板。导出仍可正常进行，只是会使用默认版式；
                    右侧「排版调整」照常可用。
                  </p>
                </div>
              )}

              {resumeTemplates.length > 0 && (
                <div className="fy-side-card resume-lightflow__template-card">
                  <h3>简历模板</h3>
                  <p className="fy-side-sub">PDF 导出按所选模板自动填充版式；Word/TXT/Markdown 保持内容格式导出</p>
                  <div className="flex flex-col gap-2">
                    {resumeTemplates.map((template) => (
                      <button key={template.id} type="button" aria-pressed={selectedTemplateId === template.id}
                        disabled={exporting} onClick={() => handleTemplateChange(template.id)}
                        className="fy-tpl-btn">
                        <b>{template.title}</b>
                        <span>{template.resumeLayoutPreset.style} · {template.recommendedFor}</span>
                      </button>
                    ))}
                  </div>
                  {selectedTemplate && (
                    <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-xs leading-relaxed text-neutral-500">已选择：{selectedTemplate.title}。</p>
                  )}
                </div>
              )}

              <div className="fy-side-card resume-lightflow__assistant-card">
                <h3>AI 辅助调整</h3>
                <p className="fy-side-sub">仅基于当前简历和原文做表达密度调整，不新增经历或事实</p>
                <div className="fy-ai-grid">
                  <Button size="sm" variant="secondary" disabled={aiAdjustDisabled} onClick={() => void handleAiAdjust('condense')}>
                    {adjusting === 'condense' ? '正在精简…' : 'AI 精简'}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={aiAdjustDisabled} onClick={() => void handleAiAdjust('reformat')}>
                    {adjusting === 'reformat' ? '正在调整…' : 'AI 调整排版'}
                  </Button>
                </div>
                {lastResumeBeforeAiAdjust && (
                  <button type="button" className="fy-undo-btn" onClick={handleUndoAiAdjust}>撤销 AI 调整</button>
                )}
                {adjustWarnings.length > 0 && (
                  <div className="mt-3 rounded-lg bg-primary-50 px-3 py-2 text-xs leading-relaxed text-primary-700">
                    {adjustWarnings.slice(0, 3).map((warning, idx) => <p key={`${warning}-${idx}`}>{warning}</p>)}
                  </div>
                )}
                {adjustError && <p className="mt-3 rounded-lg bg-error-bg px-3 py-2 text-xs leading-relaxed text-error-fg">{adjustError}</p>}
              </div>

              <div className="fy-side-card">
                <h3>导出格式</h3>
                <div className="fy-fmt-grid">
                  {EXPORT_FORMAT_OPTIONS.map((option) => (
                    <button key={option.value} type="button" aria-pressed={exportFormat === option.value}
                      disabled={exporting} onClick={() => handleExportFormatChange(option.value)}>
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="fy-side-sub">PDF 直接打印；Word/TXT/Markdown 供下载编辑。导出成功后才会出现下载与打印入口。</p>
              </div>

              {!exported && (
                <Button size="lg" className="flex w-full items-center justify-center gap-2" disabled={exporting} onClick={() => void handleExport()}>
                  <FileDownIcon className="h-5 w-5" />
                  {exporting ? '正在生成文件…' : `导出 ${EXPORT_FORMAT_OPTIONS.find((o) => o.value === exportFormat)?.label ?? 'PDF'}`}
                </Button>
              )}
              {exported && (
                <div className="flex flex-col gap-2">
                  <Button size="lg" variant="secondary" disabled={exporting} onClick={() => void handleExport()}>重新导出</Button>
                  {exported.signedUrl && (
                    <Button size="lg" variant="secondary" className="flex items-center justify-center gap-2"
                      onClick={() => setPreviewOpen(true)}>
                      <EyeIcon className="h-5 w-5" />
                      查看或手机保存{EXPORT_FORMAT_OPTIONS.find((o) => o.value === exportFormat)?.label}
                    </Button>
                  )}
                  <Button size="lg" className="flex items-center justify-center gap-2"
                    disabled={!exported.printFileUrl || printNavigating} onClick={handlePrint}>
                    <PrinterIcon className="h-5 w-5" />
                    {printNavigating ? '正在进入打印确认…' : exported.printFileUrl ? '去打印优化版' : '打印链接未就绪'}
                  </Button>
                </div>
              )}
            </aside>
          )}

      </div>

      <KioskActionBar className="resume-lightflow__action-bar mt-6 flex gap-3">
        <Button size="lg" variant="secondary" className="flex-1" onClick={() => requestLeave(handleViewRecord)}>
          在 AI 服务记录里查看
        </Button>
        <Button size="lg" className="flex flex-[2] items-center justify-center gap-2"
          disabled={exporting || !optimizedResume} onClick={() => void handleExport()}>
          <FileDownIcon className="h-5 w-5" />
          {exporting ? '正在生成文件…' : `确认优化版，导出 ${EXPORT_FORMAT_OPTIONS.find((o) => o.value === exportFormat)?.label ?? 'PDF'}`}
        </Button>
      </KioskActionBar>

      {previewOpen && exported?.signedUrl && (
        <FilePreviewDialog
          fileUrl={exported.signedUrl}
          fileName={exported.filename}
          format={exportFormat}
          phoneDownloadUrl={exported.signedUrl}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/35 px-6">
          <div className="resume-lightflow__leave-dialog w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <p className="text-lg font-bold text-neutral-900">离开前确认</p>
            <p className="mt-2 text-sm leading-relaxed text-neutral-500">
              你已经修改了优化版简历。未导出 PDF 前离开，本次编辑内容不会保存。
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button size="lg" variant="secondary" onClick={() => setConfirmLeave(null)}>继续编辑</Button>
              <Button size="lg" onClick={() => { const action = confirmLeave; setConfirmLeave(null); action() }}>
                确认离开
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
    </KioskPageFrame>
  )
}
