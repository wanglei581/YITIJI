// ============================================================
// 招聘会 AI 参会准备单 / 参会回顾。
//
// 基于本人已诊断简历 + 已发布招聘会公开快照生成；结果仅供本人参考。
// 失败时诚实展示原因，不使用本地模板冒充 AI 输出。
//
// 两态（服务端按 endAt 判定，前端只读 plan.mode，不自己猜）：
//   preparation 未结束 —— 参会准备单（原样保留）
//   review      已结束 —— 参会回顾与后续跟进
// 已结束场次不得出现「出发前 / 现场」类内容：那是语义问题，不是文案问题。
// 「本机记录」区为非 LLM 事实区；REVIEW_DISCLOSURE 是对用户的诚实声明，
// 由 verify:fair-visit-review-ui 钉死，不得以「优化文案」为由删除。
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
import { getJobFairById } from '../../services/api/jobFairs'
import { readAiResumeSession } from '../resume/aiResumeSession'
import { FusionBadge, FusionNotice, FusionSectionHead, KioskPageFrame } from '../jobs/components/W4Presentation'

interface PageState {
  taskId?: string
  accessToken?: string
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * 对用户的诚实声明（回顾态必显，屏幕与打印版同文）。
 * 系统只有本机记录的动作，没有现场事实：打开签到入口 ≠ 到场。
 */
export const REVIEW_DISCLOSURE =
  '本系统不记录你是否到场，也不记录你在现场取得的材料；以下内容仅基于本机记录的浏览与跳转行为，以及该场招聘会的公开信息。'

const COPY = {
  preparation: {
    title: 'AI参会准备单',
    subtitleHint: '基于本人简历与本场招聘会公开信息生成',
    generate: '生成参会准备单',
    print: '打印准备单',
    printing: '正在生成打印版',
    emptyLead: '先上传简历，再生成参会准备单',
    companies: { title: '现场优先了解企业', subtitle: '按与简历方向匹配程度排序' },
  },
  review: {
    title: 'AI参会回顾',
    subtitleHint: '该场招聘会已结束，以下为后续跟进参考',
    generate: '生成参会回顾',
    print: '打印回顾',
    printing: '正在生成打印版',
    emptyLead: '先上传简历，再生成参会回顾',
    companies: { title: '仍可继续跟进的企业', subtitle: '企业在活动结束后通常仍在招聘' },
  },
} as const


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
  // 该页此前从头到尾不取 fair、不读 status —— 于是「未生成」态也无从知道
  // 这场是不是已经结束。这里取一次，只用来决定文案形态。
  const [fairEnded, setFairEnded] = useState(false)
  const [loading, setLoading] = useState(Boolean(taskId && fairId))
  const [generating, setGenerating] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useBusyLock(generating || printing)

  useEffect(() => {
    if (!fairId) return
    let cancelled = false
    void getJobFairById(fairId)
      .then((res) => { if (!cancelled) setFairEnded(res.data?.status === 'ended') })
      .catch(() => { /* 取不到就按未结束展示，服务端仍会按 endAt 判定形态 */ })
    return () => { cancelled = true }
  }, [fairId])

  // 已生成时以服务端判定为准；未生成时用列表状态兜底。
  const mode = plan?.mode ?? (fairEnded ? 'review' : 'preparation')
  const isReview = mode === 'review'
  const copy = COPY[isReview ? 'review' : 'preparation']

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
        title={copy.title}
        subtitle={copy.subtitleHint}
        backLabel="返回详情"
        onBack={() => navigate(`/job-fairs/${fairId}`)}
        badge={<FusionBadge icon={SparklesIcon}>需要简历</FusionBadge>}
      >
        <section className="jf-card accented text-center">
          <FusionSectionHead icon={SparklesIcon} title={copy.emptyLead} subtitle="系统不会把简历发送给企业" />
          <p className="mx-auto max-w-[720px] text-[20px] leading-relaxed text-[var(--muted)]">
            {isReview
              ? '参会回顾基于你的真实简历和该场招聘会的公开信息生成，仅供本人后续跟进参考。'
              : '参会准备单基于你的真实简历和当前招聘会公开信息生成，仅供本人参会准备参考。'}
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
        title={copy.title}
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
              {printing ? copy.printing : copy.print}
            </button>
          </>
        }
      >
          <FusionNotice>
            {isReview
              ? '本回顾仅供本人后续跟进参考；岗位办理和结果均以来源平台为准，本系统不接收简历。'
              : '本准备单仅供本人参会准备参考；活动预约、岗位办理和结果均以来源平台为准，本系统不接收简历。'}
          </FusionNotice>

          <section className="jf-card accented">
            <FusionSectionHead icon={FileTextIcon} title="总览" subtitle={`结合你的简历方向与本场公开信息`} />
            <p className="text-[20px] leading-relaxed text-[var(--ink)]">{plan.summary}</p>
          </section>

          {/* 两列：优先企业 + 准备清单 */}
          <div className="jf-two-col">
            <section className="jf-card">
              <FusionSectionHead icon={BuildingIcon} title={copy.companies.title} subtitle={copy.companies.subtitle} />
              {(plan.priorityCompanies ?? []).length === 0 ? (
                <p className="text-[20px] text-[var(--muted)]">
                  {isReview
                    ? '本场企业信息有限，可前往来源平台查看该主办方发布的企业与在招岗位。'
                    : '本场企业信息有限，建议先打印活动资料并按现场展位逐一了解。'}
                </p>
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
              <FusionSectionHead
                icon={ClipboardListIcon}
                title={isReview ? '后续可做的跟进动作' : '参会前准备清单'}
                subtitle={isReview ? '活动已结束，这些是现在就能做的' : '出发前逐项核对'}
              />
              <ul className="jf-checklist">
                {((isReview ? plan.followUpActions : plan.preparationChecklist) ?? []).map((item) => (
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
              <FusionSectionHead icon={SparklesIcon} title={isReview ? '本场概况' : '本场看点'} />
              <ul className="jf-bullets">
                {(plan.fairHighlights ?? []).map((item) => <li key={item} className="jf-bullet"><i />{item}</li>)}
              </ul>
            </section>

            <section className="jf-card">
              <FusionSectionHead
                icon={HelpCircleIcon}
                title={isReview ? '下次同类活动可提前准备的问题' : '现场可咨询问题'}
              />
              <ul className="jf-bullets">
                {((isReview ? plan.nextTimeQuestions : plan.questionsToAsk) ?? []).map((item) => (
                  <li key={item} className="jf-bullet"><i />{item}</li>
                ))}
              </ul>
            </section>
          </div>

          {/* 现场提醒只在未结束场次出现：活动结束后「现场提醒」没有存在意义。 */}
          {!isReview && (plan.onsiteTips ?? []).length > 0 && (
            <section className="jf-card">
              <FusionSectionHead icon={SparklesIcon} title="现场提醒" subtitle="AI 生成，仅供参考" />
              <ul className="jf-tips-row">
                {(plan.onsiteTips ?? []).map((item) => <li key={item} className="jf-tip"><i className="inline-block w-3 h-3 flex-none mt-2 rounded bg-[var(--wheat)]" />{item}</li>)}
              </ul>
            </section>
          )}

          {/* 本机记录：非 AI 事实区。只列本机真实记录的动作，绝不推断现场发生了什么。 */}
          {isReview && (
            <section className="jf-card" data-review-records>
              <FusionSectionHead icon={FileTextIcon} title="你在本机留下的记录" subtitle="非 AI 生成，来自本机真实记录" />
              {plan.localRecords?.requiresLogin ? (
                <p className="text-[20px] leading-relaxed text-[var(--muted)]">
                  未登录会员，无法关联你在本机的浏览与跳转记录。
                </p>
              ) : (plan.localRecords?.openedCompanySourceEntries ?? []).length > 0 ? (
                <>
                  <p className="text-[20px] leading-relaxed text-[var(--ink)]">
                    你在本机打开过这些参展企业的来源投递入口：
                  </p>
                  <ul className="jf-bullets mt-2">
                    {(plan.localRecords?.openedCompanySourceEntries ?? []).map((name) => (
                      <li key={name} className="jf-bullet"><i />{name}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-[20px] leading-relaxed text-[var(--muted)]">
                  本机没有你在这场招聘会打开来源投递入口的记录。
                </p>
              )}
              <p className="mt-4 text-[18px] leading-relaxed text-[var(--muted)]">{REVIEW_DISCLOSURE}</p>
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
              copy.generate
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
