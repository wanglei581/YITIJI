// ============================================================
// 岗位大师（岗位决策分析台）M1.5 决策台深化。
//
// 入口①首页「岗位大师」磁贴。流程：选岗（站内已发布岗位或手填）→ 单次分析 →
// 竖屏结果页（决策摘要条 / 技能地图 / 差距行动 / 面试准备 / 简历改写 / 晋升路径 /
// 薪资 / 风险）→ 打印《岗位决策参考报告》。结果各卡在 jobMaster/ 子组件内实现，
// 本页只做选岗 + 结果编排 + 轻交互 + 合规按钮拆分。
// 合规：适配度仅三档参考等级（无百分比/录用承诺）；薪资只透传来源方文本；
// 「查看岗位」与「去来源平台投递」为两个独立按钮，不合并；失败诚实提示不产假结果。
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobDTO, JobMasterResponse } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BriefcaseIcon,
  CheckCircle2Icon,
  CoinsIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PrinterIcon,
  SearchIcon,
  TargetIcon,
} from 'lucide-react'
import { getJobs } from '../../services/api'
import { analyzeJobMaster, getLatestJobMaster, printJobMaster } from '../../services/api/jobMaster'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { readAiResumeSession } from '../resume/aiResumeSession'
import { DecisionSummaryBar } from './jobMaster/DecisionSummaryBar'
import { FitSkillMap } from './jobMaster/FitSkillMap'
import { GapActionCards } from './jobMaster/GapActionCards'
import { InterviewPrepCard } from './jobMaster/InterviewPrepCard'
import { ResumeRewriteCard } from './jobMaster/ResumeRewriteCard'
import { CareerTimeline } from './jobMaster/CareerTimeline'
import { RiskCard } from './jobMaster/RiskCard'

interface PageState {
  taskId?: string
  accessToken?: string
}

export function JobMasterPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as PageState
  const session = useMemo(() => readAiResumeSession(), [])
  const queryTaskId = useMemo(() => new URLSearchParams(location.search).get('taskId') ?? undefined, [location.search])
  const stateTaskId = typeof state.taskId === 'string' ? state.taskId : undefined
  const taskId = stateTaskId ?? queryTaskId ?? session?.taskId
  const usingSessionTask = !stateTaskId && !queryTaskId && Boolean(session?.taskId)
  const accessToken = state.accessToken ?? (usingSessionTask ? session?.accessToken : undefined)

  const [tab, setTab] = useState<'pick' | 'manual'>('pick')
  const [keyword, setKeyword] = useState('')
  const [jobs, setJobs] = useState<ExternalJobDTO[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [selectedJob, setSelectedJob] = useState<ExternalJobDTO | null>(null)
  const [manualTitle, setManualTitle] = useState('')
  const [manualReq, setManualReq] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [loadingLatest, setLoadingLatest] = useState(Boolean(taskId))
  const [result, setResult] = useState<JobMasterResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useBusyLock(analyzing || printing)

  useEffect(() => {
    let cancelled = false
    setJobsLoading(true)
    getJobs({ keyword: keyword || undefined, page: 1, pageSize: 8 })
      .then((res) => { if (!cancelled) setJobs(res.data) })
      .catch(() => { if (!cancelled) setJobs([]) })
      .finally(() => { if (!cancelled) setJobsLoading(false) })
    return () => { cancelled = true }
  }, [keyword])

  useEffect(() => {
    setResult(null)
    setSelectedJob(null)
    setError(null)
    if (!taskId) {
      setLoadingLatest(false)
      return
    }
    let cancelled = false
    setLoadingLatest(true)
    getLatestJobMaster(taskId, { token: getToken(), accessToken })
      .then((res) => { if (!cancelled) setResult(res.status === 'completed' ? res : null) })
      .catch(() => { if (!cancelled) setResult(null) })
      .finally(() => { if (!cancelled) setLoadingLatest(false) })
    return () => { cancelled = true }
  }, [taskId, accessToken, getToken])

  if (!taskId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <AlertCircleIcon className="h-10 w-10 text-gray-300" aria-hidden="true" />
        <p className="text-base text-gray-500">请先完成简历上传与诊断，再做岗位决策分析</p>
        <Button size="lg" onClick={() => navigate('/resume/source?intent=diagnose')}>去上传简历</Button>
      </div>
    )
  }

  if (loadingLatest) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <Loader2Icon className="h-10 w-10 animate-spin text-primary-600" aria-hidden="true" />
        <p className="text-base text-gray-500">正在恢复岗位决策报告…</p>
      </div>
    )
  }

  const handleAnalyze = async () => {
    setError(null)
    const input =
      tab === 'pick' && selectedJob
        ? { taskId, jobId: selectedJob.id }
        : tab === 'manual' && manualTitle.trim()
          ? { taskId, manualJob: { title: manualTitle.trim(), ...(manualReq.trim() ? { requirements: manualReq.trim() } : {}) } }
          : null
    if (!input) {
      setError(tab === 'pick' ? '请先选择一个岗位' : '请填写目标岗位名称')
      return
    }
    setAnalyzing(true)
    try {
      const res = await analyzeJobMaster(input, { token: getToken(), accessToken })
      if (res.status === 'failed') setError(res.failReason ?? '分析未完成，请稍后重试')
      else setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : '分析失败，请稍后重试')
    } finally {
      setAnalyzing(false)
    }
  }

  const handlePrint = async () => {
    setError(null)
    setPrinting(true)
    try {
      const file = await printJobMaster(taskId, { token: getToken(), accessToken })
      navigate('/print/confirm', {
        state: {
          file: {
            name: file.filename,
            size: file.sizeBytes >= 1024 * 1024 ? `${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`,
            pages: file.pageCount,
            fileId: file.fileId,
            fileUrl: file.signedUrl || undefined,
            mimeType: 'application/pdf',
          },
          params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '决策报告生成失败，请稍后重试')
    } finally {
      setPrinting(false)
    }
  }

  // ── 结果视图（编排 jobMaster/ 子组件 + 轻交互 + 合规按钮拆分）─────────────────
  if (result) {
    const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const sections: Array<{ id: string; label: string }> = []
    if (result.fit) sections.push({ id: 'jm-fit', label: '适配度' })
    if (result.fit?.gapSkills?.length) sections.push({ id: 'jm-gap', label: '差距行动' })
    if (result.interviewPrep?.length) sections.push({ id: 'jm-interview', label: '面试准备' })
    if (result.resumeRewrite?.length) sections.push({ id: 'jm-resume', label: '简历改写' })
    if (result.careerPath) sections.push({ id: 'jm-path', label: '晋升路径' })
    sections.push({ id: 'jm-risk', label: '风险' })
    // 站内岗位且有来源：才出「查看岗位」「去来源平台投递」两个独立按钮（手填无来源不出）
    const showSource = Boolean(result.job?.sourceUrl && selectedJob?.id)
    return (
      <div className="flex h-full flex-col px-6 pt-6">
        <PageHeader
          title="岗位决策参考报告"
          subtitle={`目标岗位：${result.job?.title ?? ''}${result.job?.company ? ` · ${result.job.company}` : ''}`}
          actions={<Button size="sm" variant="secondary" onClick={() => navigate('/')}>返回首页</Button>}
        />
        <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-28">
          <ComplianceBanner tone="info">
            以下内容仅为帮助你决策与准备的参考，不代表任何招聘结果或薪酬承诺；本平台不提供投递功能，投递请前往岗位来源平台。
          </ComplianceBanner>

          <DecisionSummaryBar
            jobTitle={result.job?.title ?? '目标岗位'}
            company={result.job?.company}
            fitLevel={result.fit?.level}
            summary={result.fit?.summary}
            sections={sections}
            onJump={jump}
          />

          {result.fit && <div id="jm-fit"><FitSkillMap fit={result.fit} /></div>}
          {result.fit?.gapSkills?.length ? <div id="jm-gap"><GapActionCards gapSkills={result.fit.gapSkills} /></div> : null}
          {result.interviewPrep?.length ? (
            <div id="jm-interview">
              <InterviewPrepCard items={result.interviewPrep} onPracticeInterview={() => navigate('/interview/setup')} />
            </div>
          ) : null}
          {result.resumeRewrite?.length ? (
            <div id="jm-resume">
              <ResumeRewriteCard items={result.resumeRewrite} onOptimizeResume={() => navigate('/resume/optimize', { state: { taskId, accessToken } })} />
            </div>
          ) : null}
          {result.careerPath && <div id="jm-path"><CareerTimeline careerPath={result.careerPath} /></div>}

          {/* 薪资参考卡（只透传来源方文本） */}
          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2">
              <CoinsIcon className="h-4 w-4 text-amber-500" aria-hidden="true" />
              <h2 className="text-base font-semibold text-gray-900">薪资参考</h2>
            </div>
            <p className="text-sm font-medium text-gray-900">
              {result.salary?.sourceText ? `来源方提供：${result.salary.sourceText}` : '来源平台未提供薪资信息'}
            </p>
            {result.salary?.note && <p className="mt-1 text-xs text-gray-500">{result.salary.note}</p>}
          </Card>

          <div id="jm-risk"><RiskCard risks={result.risks ?? []} /></div>

          {/* 下一步 / 来源与合规动作 */}
          <Card className="p-5">
            <h2 className="text-base font-semibold text-gray-900">下一步</h2>
            {result.job?.sourceName && (
              <p className="mt-1 text-xs text-gray-400">
                岗位来源：{result.job.sourceName}{result.job.externalId ? ` · 外部ID ${result.job.externalId}` : ''}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" className="min-h-[48px]" onClick={() => navigate('/resume/career-plan', { state: { taskId, accessToken } })}>去职业规划</Button>
              {showSource && (
                <>
                  <Button size="sm" variant="secondary" className="min-h-[48px]" onClick={() => navigate(`/jobs/${selectedJob?.id}`)}>查看岗位</Button>
                  <Button size="sm" variant="secondary" className="min-h-[48px]" onClick={() => navigate(`/jobs/${selectedJob?.id}`)}>
                    <ExternalLinkIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />去来源平台投递
                  </Button>
                </>
              )}
            </div>
          </Card>

          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
        </div>

        <div className="absolute inset-x-0 bottom-0 border-t border-gray-100 bg-white/95 px-6 py-4 backdrop-blur">
          <div className="flex gap-3">
            <Button size="lg" className="h-14 flex-1 text-base" disabled={printing} onClick={() => void handlePrint()}>
              {printing ? (
                <><Loader2Icon className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />正在生成报告…</>
              ) : (
                <><PrinterIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />打印决策报告</>
              )}
            </Button>
            <Button size="lg" variant="secondary" className="h-14 flex-1 text-base" onClick={() => { setResult(null); setError(null) }}>
              换个岗位再分析
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── 选择视图 ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col px-6 pt-6">
      <PageHeader
        title="岗位大师"
        subtitle="选择目标岗位，基于你的简历生成可打印的岗位决策参考报告"
        actions={<Button size="sm" variant="secondary" onClick={() => navigate(-1)}>返回</Button>}
      />
      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-28">
        <ComplianceBanner tone="info">
          分析结果仅供本人决策参考，不代表录用结果或薪酬承诺；本平台不提供投递功能，投递请前往岗位来源平台。
        </ComplianceBanner>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setTab('pick')}
            className={['min-h-[52px] rounded-xl border text-sm font-semibold', tab === 'pick' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600'].join(' ')}
          >
            <BriefcaseIcon className="mr-1.5 inline h-4 w-4" aria-hidden="true" />
            从岗位信息选择
          </button>
          <button
            type="button"
            onClick={() => setTab('manual')}
            className={['min-h-[52px] rounded-xl border text-sm font-semibold', tab === 'manual' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600'].join(' ')}
          >
            <TargetIcon className="mr-1.5 inline h-4 w-4" aria-hidden="true" />
            手填目标岗位
          </button>
        </div>

        {tab === 'pick' ? (
          <Card className="p-4">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" aria-hidden="true" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索岗位名称 / 公司"
                className="min-h-[48px] w-full rounded-xl border border-gray-200 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {jobsLoading ? (
                <p className="flex items-center gap-2 py-6 text-sm text-gray-400">
                  <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />正在加载岗位…
                </p>
              ) : jobs.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">没有找到岗位，可切换「手填目标岗位」</p>
              ) : (
                jobs.map((j) => {
                  const active = selectedJob?.id === j.id
                  return (
                    <button
                      key={j.id}
                      type="button"
                      onClick={() => setSelectedJob(j)}
                      className={['flex min-h-[56px] items-center justify-between rounded-xl border px-4 py-3 text-left', active ? 'border-primary-500 bg-primary-50' : 'border-gray-100 bg-white hover:border-gray-200'].join(' ')}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-gray-900">{j.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-gray-500">{j.company} · 来源：{j.sourceName}</span>
                      </span>
                      {active && <CheckCircle2Icon className="h-5 w-5 shrink-0 text-primary-600" aria-hidden="true" />}
                    </button>
                  )
                })
              )}
            </div>
          </Card>
        ) : (
          <Card className="p-4">
            <input
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              maxLength={50}
              placeholder="目标岗位名称，如：行政专员"
              className="min-h-[52px] w-full rounded-xl border border-gray-200 px-4 text-base focus:border-primary-500 focus:outline-none"
            />
            <textarea
              value={manualReq}
              onChange={(e) => setManualReq(e.target.value)}
              maxLength={2000}
              rows={5}
              placeholder="可粘贴岗位 JD / 任职要求（选填，提供后参考更有针对性）"
              className="mt-2 w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm leading-relaxed focus:border-primary-500 focus:outline-none"
            />
          </Card>
        )}

        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
      </div>

      <div className="absolute inset-x-0 bottom-0 border-t border-gray-100 bg-white/95 px-6 py-4 backdrop-blur">
        <Button size="lg" className="h-14 w-full text-base" disabled={analyzing} onClick={() => void handleAnalyze()}>
          {analyzing ? (
            <><Loader2Icon className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />正在分析（约 10-20 秒）…</>
          ) : (
            <>开始岗位决策分析<ArrowRightIcon className="ml-1.5 h-5 w-5" aria-hidden="true" /></>
          )}
        </Button>
      </div>
    </div>
  )
}
