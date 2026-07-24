// ============================================================
// 招聘会 AI 参会准备单。
//
// 基于本人已诊断简历 + 已发布招聘会公开快照生成；结果仅供本人参会准备参考。
// 失败时诚实展示原因，不使用本地模板冒充 AI 输出。
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
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
import { FusionBadge, FusionNotice, FusionSectionHead, KioskPageFrame } from '../jobs/components/W4Presentation'

interface PageState {
  taskId?: string
  accessToken?: string
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
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
      <KioskPageFrame
        tone="wheat"
        title="AI参会准备单"
        subtitle="基于本人简历与本场招聘会公开信息生成"
        backLabel="返回详情"
        onBack={() => navigate(`/job-fairs/${fairId}`)}
        badge={<FusionBadge icon={SparklesIcon}>需要简历</FusionBadge>}
      >
        <section className="jf-card accented text-center">
          <FusionSectionHead icon={SparklesIcon} title="先上传简历，再生成参会准备单" subtitle="系统不会把简历发送给企业" />
          <p className="mx-auto max-w-[720px] text-[20px] leading-relaxed text-[var(--muted)]">
            参会准备单基于你的真实简历和当前招聘会公开信息生成，仅供本人参会准备参考。
          </p>
          <div className="mt-7 flex justify-center gap-4">
            <button type="button" className="jf-btn dark" onClick={() => navigate('/resume/source?intent=diagnose')}>
            去上传简历
            </button>
            <button type="button" className="jf-btn ghost" onClick={() => navigate(`/job-fairs/${fairId}/materials`)}>
            打印活动资料
            </button>
          </div>
        </section>
        <FusionNotice>活动预约、岗位办理和结果均以来源平台为准，本系统不接收简历。</FusionNotice>
      </KioskPageFrame>
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
      <KioskPageFrame
        tone="wheat"
        title="AI参会准备单"
        subtitle={`${plan.basedOn?.fairName ?? plan.fair?.title ?? '招聘会'} · ${plan.basedOn?.companyCount ?? 0} 家企业 / ${plan.basedOn?.positionCount ?? 0} 个岗位`}
        backLabel="返回详情"
        onBack={() => navigate(`/job-fairs/${fairId}`)}
        badge={<FusionBadge icon={SparklesIcon}>已生成</FusionBadge>}
        actionBar={
          <>
            <button type="button" className="jf-btn ghost" disabled={generating} onClick={() => void handleGenerate()}>
              {generating ? '正在生成' : '重新生成'}
            </button>
            <div className="jf-spacer" />
            <button type="button" className="jf-btn dark" disabled={printing} onClick={() => void handlePrint()}>
              <PrinterIcon aria-hidden="true" />
              {printing ? '正在生成打印版' : '打印准备单'}
            </button>
          </>
        }
      >
          <FusionNotice>
            本准备单仅供本人参会准备参考；活动预约、岗位办理和结果均以来源平台为准，本系统不接收简历。
          </FusionNotice>

          <section className="jf-card accented">
            <FusionSectionHead icon={FileTextIcon} title="总览" subtitle={`结合你的简历方向与本场公开信息`} />
            <p className="text-[20px] leading-relaxed text-[var(--ink)]">{plan.summary}</p>
          </section>

          {/* 两列：优先企业 + 准备清单 */}
          <div className="jf-two-col">
            <section className="jf-card">
              <FusionSectionHead icon={BuildingIcon} title="现场优先了解企业" subtitle="按与简历方向匹配程度排序" />
              {(plan.priorityCompanies ?? []).length === 0 ? (
                <p className="text-[20px] text-[var(--muted)]">本场企业信息有限，建议先打印活动资料并按现场展位逐一了解。</p>
              ) : (
                <div className="jf-co-pick">
                  {(plan.priorityCompanies ?? []).map((company) => (
                    <div key={company.companyName} className="jf-cp">
                      <div className="jf-cp-top">
                        <b>{company.companyName}</b>
                      </div>
                      <p>{company.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="jf-card">
              <FusionSectionHead icon={ClipboardListIcon} title="参会前准备清单" subtitle="出发前逐项核对" />
              <ul className="jf-checklist">
                {(plan.preparationChecklist ?? []).map((item) => (
                  <li key={item} className="jf-check">
                    <span className="box" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* 两列：本场看点 + 可咨询问题 */}
          <div className="jf-two-col">
            <section className="jf-card">
              <FusionSectionHead icon={SparklesIcon} title="本场看点" />
              <ul className="jf-bullets">
                {(plan.fairHighlights ?? []).map((item) => <li key={item} className="jf-bullet"><i />{item}</li>)}
              </ul>
            </section>

            <section className="jf-card">
              <FusionSectionHead icon={HelpCircleIcon} title="现场可咨询问题" />
              <ul className="jf-bullets">
                {(plan.questionsToAsk ?? []).map((item) => <li key={item} className="jf-bullet"><i />{item}</li>)}
              </ul>
            </section>
          </div>

          {/* 现场提醒（横跨全宽） */}
          {(plan.onsiteTips ?? []).length > 0 && (
            <section className="jf-card">
              <FusionSectionHead icon={SparklesIcon} title="现场提醒" subtitle="AI 生成，仅供参考" />
              <ul className="jf-tips-row">
                {(plan.onsiteTips ?? []).map((item) => <li key={item} className="jf-tip"><i className="inline-block w-3 h-3 flex-none mt-2 rounded bg-[var(--wheat)]" />{item}</li>)}
              </ul>
            </section>
          )}

          {error && <p className="rounded-xl bg-error-bg px-4 py-3 text-sm text-error-fg">{error}</p>}
      </KioskPageFrame>
    )
  }

  return (
    <KioskPageFrame
      tone="wheat"
      title="AI参会准备单"
      subtitle="基于本人简历与本场招聘会公开信息生成"
      backLabel="返回详情"
      onBack={() => navigate(`/job-fairs/${fairId}`)}
      badge={<FusionBadge icon={SparklesIcon}>待生成</FusionBadge>}
      actionBar={
        <>
          <button type="button" className="jf-btn ghost" onClick={() => navigate(`/job-fairs/${fairId}/materials`)}>
            打印活动资料
          </button>
          <div className="jf-spacer" />
          <button type="button" className="jf-btn dark" disabled={generating} onClick={() => void handleGenerate()}>
            {generating ? (
              <>
                <Loader2Icon aria-hidden="true" />
                正在生成
              </>
            ) : (
              '生成参会准备单'
            )}
          </button>
        </>
      }
    >
        <FusionNotice>
          本准备单只服务本人参会准备；系统不会代办活动预约，也不会接收或转交简历。
        </FusionNotice>
        <section className="jf-card accented">
          <FusionSectionHead icon={SparklesIcon} title="将为你生成" subtitle="结合简历诊断和招聘会公开快照" />
          <div className="jf-two-col">
            <div className="jf-tile tinted">
              <span className="jf-tile-icon"><FileTextIcon aria-hidden="true" /></span>
              <span><b>活动看点</b><span>本场活动看点与现场路线提醒</span></span>
            </div>
            <div className="jf-tile">
              <span className="jf-tile-icon"><BuildingIcon aria-hidden="true" /></span>
              <span><b>优先企业</b><span>可优先了解的参展企业清单</span></span>
            </div>
            <div className="jf-tile">
              <span className="jf-tile-icon"><ClipboardListIcon aria-hidden="true" /></span>
              <span><b>准备清单</b><span>参会前准备清单</span></span>
            </div>
            <div className="jf-tile">
              <span className="jf-tile-icon"><HelpCircleIcon aria-hidden="true" /></span>
              <span><b>咨询问题</b><span>现场可咨询的问题</span></span>
            </div>
          </div>
          <p className="mt-5 text-[18px] leading-relaxed text-[var(--muted)]">
            如 AI 服务暂时不可用，你仍可以打印活动资料，按来源平台信息办理后续事项。
          </p>
        </section>
        {error && <p className="rounded-xl bg-error-bg px-4 py-3 text-sm text-error-fg">{error}</p>}
    </KioskPageFrame>
  )
}
