// ============================================================
// 招聘会 AI 参会准备单。
//
// 基于本人已诊断简历 + 已发布招聘会公开快照生成；结果仅供本人参会准备参考。
// 失败时诚实展示原因，不使用本地模板冒充 AI 输出。
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import type { FairVisitPlanResponse } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import {
  BuildingIcon,
  ClipboardListIcon,
  FileTextIcon,
  HelpCircleIcon,
  Loader2Icon,
  PrinterIcon,
  SparklesIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { generateFairVisitPlan, getLatestFairVisitPlan, printFairVisitPlan } from '../../services/api/fairVisitPlan'
import { readAiResumeSession } from '../resume/aiResumeSession'

interface PageState {
  taskId?: string
  accessToken?: string
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary-600" aria-hidden="true" />
        <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
      </div>
      {children}
    </Card>
  )
}

export function FairVisitPlanPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const fairId = id ?? ''
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as PageState
  const session = useMemo(() => readAiResumeSession(), [])
  const taskId = state.taskId ?? session?.taskId
  const accessToken = state.accessToken ?? session?.accessToken

  const [plan, setPlan] = useState<FairVisitPlanResponse | null>(null)
  const [loading, setLoading] = useState(Boolean(taskId && fairId))
  const [generating, setGenerating] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useBusyLock(generating || printing)

  useEffect(() => {
    if (!taskId || !fairId) {
      setLoading(false)
      return
    }
    let cancelled = false
    getLatestFairVisitPlan(fairId, taskId, { token: getToken(), accessToken })
      .then((result) => { if (!cancelled && result.status === 'completed') setPlan(result) })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId, taskId, accessToken, getToken])

  const handleGenerate = async () => {
    if (!taskId || !fairId) return
    setGenerating(true)
    setError(null)
    try {
      const result = await generateFairVisitPlan(fairId, taskId, { token: getToken(), accessToken })
      if (result.status === 'failed') setError(result.failReason ?? '生成未完成，请稍后重试')
      else setPlan(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '参会准备单生成失败，请稍后重试')
    } finally {
      setGenerating(false)
    }
  }

  const handlePrint = async () => {
    if (!taskId || !fairId) return
    setPrinting(true)
    setError(null)
    try {
      const file = await printFairVisitPlan(fairId, taskId, { token: getToken(), accessToken })
      if (!file.printFileUrl) throw new Error('打印链接未就绪，请稍后重试')
      navigate('/print/confirm', {
        state: {
          file: {
            name: file.filename,
            size: formatSize(file.sizeBytes),
            pages: file.pageCount,
            fileId: file.fileId,
            fileUrl: file.printFileUrl,
            mimeType: 'application/pdf',
          },
          params: makePrintParams({ copies: 1, duplex: file.pageCount > 1 ? 'double' : 'single', color: 'bw' }),
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '打印版生成失败，请稍后重试')
    } finally {
      setPrinting(false)
    }
  }

  if (!taskId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <SparklesIcon className="h-10 w-10 text-neutral-300" aria-hidden="true" />
        <p className="text-base font-semibold text-neutral-900">先上传简历，再生成参会准备单</p>
        <p className="max-w-md text-sm leading-relaxed text-neutral-500">
          参会准备单基于你的真实简历和当前招聘会公开信息生成；系统不会把简历发送给企业。
        </p>
        <div className="flex gap-3">
          <Button size="lg" className="h-14 px-8" onClick={() => navigate('/resume/source?intent=diagnose')}>
            去上传简历
          </Button>
          <Button size="lg" variant="secondary" className="h-14 px-8" onClick={() => navigate(`/job-fairs/${fairId}/materials`)}>
            打印活动资料
          </Button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-neutral-400">
        <Loader2Icon className="h-5 w-5 animate-spin" aria-hidden="true" />
        正在加载…
      </div>
    )
  }

  if (plan) {
    return (
      <div className="flex h-full flex-col px-6 pt-6">
        <PageHeader
          title="AI参会准备单"
          subtitle={`${plan.basedOn?.fairName ?? plan.fair?.title ?? '招聘会'} · ${plan.basedOn?.companyCount ?? 0} 家企业 / ${plan.basedOn?.positionCount ?? 0} 个岗位`}
          actions={<Button size="sm" variant="secondary" onClick={() => navigate(`/job-fairs/${fairId}`)}>返回详情</Button>}
        />
        <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-32">
          <ComplianceBanner tone="info">
            本准备单仅供本人参会准备参考；活动预约、岗位办理和结果均以来源平台为准，本系统不接收简历。
          </ComplianceBanner>

          <Card className="p-5">
            <h2 className="text-base font-semibold text-neutral-900">总览</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-700">{plan.summary}</p>
          </Card>

          <Section icon={FileTextIcon} title="本场看点">
            <ul className="flex flex-col gap-2 text-sm leading-relaxed text-neutral-700">
              {(plan.fairHighlights ?? []).map((item) => <li key={item}>· {item}</li>)}
            </ul>
          </Section>

          <Section icon={BuildingIcon} title="现场优先了解企业">
            {(plan.priorityCompanies ?? []).length === 0 ? (
              <p className="text-sm text-neutral-500">本场企业信息有限，建议先打印活动资料并按现场展位逐一了解。</p>
            ) : (
              <div className="flex flex-col gap-3">
                {(plan.priorityCompanies ?? []).map((company) => (
                  <div key={company.companyName} className="rounded-xl border border-primary-100 bg-primary-50/40 p-4">
                    <p className="text-sm font-bold text-primary-800">{company.companyName}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-neutral-600">{company.reason}</p>
                    {company.sourceUrl && <p className="mt-1 text-xs text-neutral-400">来源平台：{company.sourceUrl}</p>}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section icon={ClipboardListIcon} title="参会前准备清单">
            <ul className="flex flex-col gap-2">
              {(plan.preparationChecklist ?? []).map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-neutral-700">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-neutral-300" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </Section>

          <Section icon={HelpCircleIcon} title="现场可咨询问题">
            <ul className="flex flex-col gap-2 text-sm leading-relaxed text-neutral-700">
              {(plan.questionsToAsk ?? []).map((item) => <li key={item}>· {item}</li>)}
            </ul>
          </Section>

          <Section icon={SparklesIcon} title="现场提醒">
            <ul className="flex flex-col gap-2 text-sm leading-relaxed text-neutral-700">
              {(plan.onsiteTips ?? []).map((item) => <li key={item}>· {item}</li>)}
            </ul>
          </Section>

          {error && <p className="rounded-xl bg-error-bg px-4 py-3 text-sm text-error-fg">{error}</p>}
        </div>
        <div className="absolute inset-x-0 bottom-0 border-t border-neutral-100 bg-white/95 px-6 py-4 backdrop-blur">
          <div className="flex gap-3">
            <Button size="lg" className="h-14 flex-1 text-base" disabled={printing} onClick={() => void handlePrint()}>
              <PrinterIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />
              {printing ? '正在生成打印版…' : '打印准备单'}
            </Button>
            <Button size="lg" variant="secondary" className="h-14 min-w-[140px] text-base" disabled={generating} onClick={() => void handleGenerate()}>
              {generating ? <Loader2Icon className="h-5 w-5 animate-spin" aria-hidden="true" /> : '重新生成'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col px-6 pt-6">
      <PageHeader
        title="AI参会准备单"
        subtitle="基于本人简历与本场招聘会公开信息生成"
        actions={<Button size="sm" variant="secondary" onClick={() => navigate(`/job-fairs/${fairId}`)}>返回详情</Button>}
      />
      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-28">
        <ComplianceBanner tone="info">
          本准备单只服务本人参会准备；系统不会代办活动预约，也不会接收或转交简历。
        </ComplianceBanner>
        <Card className="p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-50">
              <SparklesIcon className="h-6 w-6 text-primary-600" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-neutral-900">将为你生成</h2>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm text-neutral-600">
                <li>· 本场活动看点与现场路线提醒</li>
                <li>· 可优先了解的参展企业清单</li>
                <li>· 参会前准备清单</li>
                <li>· 现场可咨询的问题</li>
              </ul>
              <p className="mt-3 text-xs text-neutral-400">
                如 AI 服务暂时不可用，你仍可以打印活动资料，按来源平台信息办理后续事项。
              </p>
            </div>
          </div>
        </Card>
        {error && <p className="rounded-xl bg-error-bg px-4 py-3 text-sm text-error-fg">{error}</p>}
      </div>
      <div className="absolute inset-x-0 bottom-0 border-t border-neutral-100 bg-white/95 px-6 py-4 backdrop-blur">
        <div className="flex gap-3">
          <Button size="lg" className="h-14 flex-1 text-base" disabled={generating} onClick={() => void handleGenerate()}>
            {generating ? (
              <>
                <Loader2Icon className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
                正在生成…
              </>
            ) : (
              '生成参会准备单'
            )}
          </Button>
          <Button size="lg" variant="secondary" className="h-14 min-w-[150px]" onClick={() => navigate(`/job-fairs/${fairId}/materials`)}>
            打印活动资料
          </Button>
        </div>
      </div>
    </div>
  )
}
