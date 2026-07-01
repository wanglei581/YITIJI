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
  PencilLineIcon,
  PrinterIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TargetIcon,
} from 'lucide-react'
import type {
  GeneratedResume,
  ResumeGenerateExportResponse,
  ResumeOptimizeModule,
  ResumeTargetContext,
} from '@ai-job-print/shared'
import { COMPLIANCE_COPY, makePrintParams } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { exportGeneratedResume, getResumeOptimize } from '../../services/api'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { readAiResumeSession } from './aiResumeSession'

function targetSummary(tc?: ResumeTargetContext): string | null {
  if (!tc) return null
  if (tc.skipped) return '通用诊断（未指定方向）'
  const parts = [tc.industry, tc.targetJob, tc.experience, tc.scene].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

const taCls =
  'w-full scroll-mt-32 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-gray-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100'

type LeaveAction = () => void

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="h-4 w-1 rounded-full bg-primary-600" aria-hidden="true" />
      <p className="text-base font-semibold text-gray-900">{title}</p>
    </div>
  )
}

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
  const [exported, setExported] = useState<ResumeGenerateExportResponse | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState<LeaveAction | null>(null)

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

  const handleExport = async () => {
    if (!optimizedResume) return
    setExporting(true)
    setExportError(null)
    try {
      const result = await exportGeneratedResume(optimizedResume, taskId, getToken())
      setExported(result)
      setIsDirty(false)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : '导出失败，请稍后重试')
    } finally {
      setExporting(false)
    }
  }

  const handlePrint = () => {
    if (printNavigating || !exported?.signedUrl) return
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
          fileUrl: exported.signedUrl,
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
            <Card className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-lg font-bold text-gray-900">优化版简历</p>
                <p className="flex items-center gap-1 text-xs text-gray-400">
                  <PencilLineIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  可直接点击修改
                </p>
              </div>
              <div className="border-b-2 border-primary-600 pb-3">
                <p className="text-2xl font-bold text-gray-900">{optimizedResume.basic.name || '(原文未识别到姓名)'}</p>
                <p className="mt-1 text-sm text-gray-500">
                  {[
                    optimizedResume.intention.position ? `求职意向:${optimizedResume.intention.position}` : '',
                    optimizedResume.basic.phone ? `电话:${optimizedResume.basic.phone}` : '',
                    optimizedResume.basic.email ? `邮箱:${optimizedResume.basic.email}` : '',
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>

              <div className="mt-4 space-y-5">
                <div>
                  <SectionTitle title="个人简介" />
                  <textarea
                    className={`${taCls} min-h-24 resize-y`}
                    value={optimizedResume.summary}
                    placeholder="(空)"
                    onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                    onChange={(e) => {
                      markEdited()
                      setOptimizedResume((r) => r ? { ...r, summary: e.target.value.slice(0, 600) } : r)
                    }}
                  />
                </div>

                {optimizedResume.education.length > 0 && (
                  <div>
                    <SectionTitle title="教育经历" />
                    <div className="space-y-3">
                      {optimizedResume.education.map((e, i) => (
                        <div key={i}>
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="text-sm font-semibold text-gray-800">
                              {[e.school, e.major, e.degree].filter(Boolean).join(' · ')}
                            </p>
                            {e.period && <p className="shrink-0 text-xs text-gray-400">{e.period}</p>}
                          </div>
                          <textarea
                            className={`${taCls} mt-1.5 min-h-20 resize-y`}
                            value={e.description ?? ''}
                            placeholder="(无描述)"
                            onFocus={(ev) => ev.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                            onChange={(ev) => {
                              markEdited()
                              setOptimizedResume((r) => r ? {
                                ...r,
                                education: r.education.map((x, idx) => idx === i ? { ...x, description: ev.target.value.slice(0, 1000) } : x),
                              } : r)
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {optimizedResume.experience.length > 0 && (
                  <div>
                    <SectionTitle title="实习 / 工作经历" />
                    <div className="space-y-3">
                      {optimizedResume.experience.map((e, i) => (
                        <div key={i}>
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="text-sm font-semibold text-gray-800">{e.company} · {e.role}</p>
                            {e.period && <p className="shrink-0 text-xs text-gray-400">{e.period}</p>}
                          </div>
                          <textarea
                            className={`${taCls} mt-1.5 min-h-24 resize-y`}
                            value={e.description}
                            onFocus={(ev) => ev.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                            onChange={(ev) => {
                              markEdited()
                              setOptimizedResume((r) => r ? {
                                ...r,
                                experience: r.experience.map((x, idx) => idx === i ? { ...x, description: ev.target.value.slice(0, 1000) } : x),
                              } : r)
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {optimizedResume.projects.length > 0 && (
                  <div>
                    <SectionTitle title="项目经历" />
                    <div className="space-y-3">
                      {optimizedResume.projects.map((p, i) => (
                        <div key={i}>
                          <p className="text-sm font-semibold text-gray-800">{p.role ? `${p.name} · ${p.role}` : p.name}</p>
                          <textarea
                            className={`${taCls} mt-1.5 min-h-24 resize-y`}
                            value={p.description}
                            onFocus={(ev) => ev.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                            onChange={(ev) => {
                              markEdited()
                              setOptimizedResume((r) => r ? {
                                ...r,
                                projects: r.projects.map((x, idx) => idx === i ? { ...x, description: ev.target.value.slice(0, 1000) } : x),
                              } : r)
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {optimizedResume.skills.length > 0 && (
                  <div>
                    <SectionTitle title="技能" />
                    <div className="flex flex-wrap gap-2">
                      {optimizedResume.skills.map((s, i) => (
                        <span key={i} className="rounded-lg bg-primary-50 px-2.5 py-1 text-sm text-primary-700">{s}</span>
                      ))}
                    </div>
                  </div>
                )}

                {optimizedResume.certificates.length > 0 && (
                  <div>
                    <SectionTitle title="证书 / 资质" />
                    <p className="text-sm text-gray-700">{optimizedResume.certificates.join(' · ')}</p>
                  </div>
                )}
              </div>
            </Card>

            <p className="flex items-center gap-1.5 text-xs text-gray-400">
              <ShieldCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
              优化版中的学校/公司/证书等事实信息均来自你的简历原文,AI 未做任何添加;原文没有的内容保持为空,由你自行补充。
            </p>
          </>
        )}

        {exportError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{exportError}</p>}

        {exported && (
          <Card className="border-green-100 bg-green-50/60 p-5">
            <p className="flex items-center gap-2 text-base font-semibold text-green-800">
              <CheckCircle2Icon className="h-5 w-5" aria-hidden="true" />
              优化版 PDF 已生成
            </p>
            <p className="mt-1 text-sm text-green-700">
              {exported.filename} · {exported.pageCount} 页
              {exported.sizeBytes > 0 ? ` · ${Math.max(1, Math.round(exported.sizeBytes / 1024))} KB` : ''}
            </p>
            {!exported.signedUrl && (
              <p className="mt-1 text-xs text-amber-700">演示模式未生成真实文件,接入后端后可打印。</p>
            )}
            <p className="mt-1 text-xs text-green-700/80">文件短期保留后自动清理,本机不长期保存你的简历。</p>
          </Card>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {optimizedResume && !exported && (
          <Button
            size="lg"
            className="flex items-center justify-center gap-2"
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            <FileDownIcon className="h-5 w-5" />
            {exporting ? '正在生成 PDF…' : '确认优化版,导出 PDF'}
          </Button>
        )}
        {exported && (
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" variant="secondary" disabled={exporting} onClick={() => void handleExport()}>
              重新导出
            </Button>
            <Button
              size="lg"
              className="flex items-center justify-center gap-2"
              disabled={!exported.signedUrl || printNavigating}
              onClick={handlePrint}
            >
              <PrinterIcon className="h-5 w-5" />
              {printNavigating ? '正在进入打印确认…' : '去打印优化版'}
            </Button>
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
