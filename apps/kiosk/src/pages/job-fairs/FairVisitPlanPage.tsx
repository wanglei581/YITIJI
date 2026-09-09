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
  AlertTriangleIcon,
  BuildingIcon,
  FileTextIcon,
  Loader2Icon,
  PrinterIcon,
  SparklesIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import {
  FairVisitPlanApiError,
  generateFairVisitPlan,
  getLatestFairVisitPlan,
  printFairVisitPlan,
} from '../../services/api/fairVisitPlan'
import { getJobFairById } from '../../services/api/jobFairs'
import { readAiResumeSession } from '../resume/aiResumeSession'
import { userMessageOf } from '../../services/api/userErrorMessage'
import {
  QxFairCta,
  QxFairNavRow,
  QxFairShell,
  QxFairSkel,
  QxFairState,
} from './qx/qxFairChrome'

function isAiUnavailableError(err: unknown): boolean {
  return err instanceof FairVisitPlanApiError && (err.code === 'MOCK_MODE' || err.status === 503 || err.status === 502)
}

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
  const [aiUnavailable, setAiUnavailable] = useState(false)

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
      .catch((err) => { if (!cancelled && isAiUnavailableError(err)) setAiUnavailable(true) })
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
      if (isAiUnavailableError(err)) setAiUnavailable(true)
      setError(userMessageOf(err, '参会准备单生成失败，请稍后重试'))
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
      setError(userMessageOf(err, '打印版生成失败，请稍后重试'))
    } finally {
      setPrinting(false)
    }
  }

  const viewState = !taskId
    ? 'missing-context'
    : loading || generating
      ? (generating ? 'generating' : 'loading')
      : aiUnavailable
        ? 'ai-unavailable'
        : error && !plan
          ? 'failed'
          : plan
            ? 'ready'
            : 'missing-context'

  if (viewState === 'missing-context') {
    return (
      <QxFairShell
        title={copy.title}
        subtitle={copy.subtitleHint}
        status={{ tone: 'warn', label: '缺少简历或参展上下文' }}
        screen="visit-plan"
      fairId={fairId}
        state="missing-context"
        ctabar={
          <QxFairCta variant="primary" testId="visit-plan-primary" onClick={() => navigate('/me/resumes')}>
            选择本人简历
          </QxFairCta>
        }
      >
        <div className="qx-fair-aibar">
          <span className="qx-fair-ai-ic"><SparklesIcon size={26} aria-hidden /></span>
          <span>
            <span className="qx-fair-ai-t">参会准备清单需要两样东西</span>
            <span className="qx-fair-ai-d">{copy.emptyLead}。系统不会把简历发送给企业。不排路线、不承诺结果。</span>
          </span>
        </div>
        <section className="qx-card">
          <div className="qx-fair-blk-h">当前上下文</div>
          <dl className="qx-fair-kv">
            <div className="qx-fair-kv-row"><dt>本人简历</dt><dd><span className="qx-fair-tag warn">还没有选</span></dd></div>
            <div className="qx-fair-kv-row"><dt>参展名单</dt><dd>打开这场的参展名单即可核对，不依赖模型</dd></div>
          </dl>
        </section>
        <div className="qx-fair-state-acts">
          <QxFairCta onClick={() => navigate('/resume/source?intent=diagnose')}>去上传简历</QxFairCta>
          <QxFairCta onClick={() => navigate(`/job-fairs/${fairId}/materials`)}>打印活动资料</QxFairCta>
        </div>
        <p className="qx-fair-local-note">活动预约、岗位办理和结果均以来源平台为准，本系统不接收简历。</p>
      </QxFairShell>
    )
  }

  if (viewState === 'loading' || viewState === 'generating') {
    return (
      <QxFairShell
        title={copy.title}
        subtitle={copy.subtitleHint}
        status={{ tone: 'unknown', label: generating ? '已提交，等服务端返回' : '正在加载' }}
        screen="visit-plan"
        state={generating ? 'generating' : 'loading'}
        ctabar={
          <QxFairCta variant="primary" testId="visit-plan-primary" onClick={() => navigate(`/job-fairs/${fairId}`)}>
            返回招聘会
          </QxFairCta>
        }
      >
        {generating ? (
          <QxFairState screen="visit-plan" tone="info" icon={Loader2Icon} title="正在按你的简历和这场名单生成清单">
            任务已经提交，结果由服务端返回后才会显示。这中间<b>没有百分比可以给你</b>，本机不会编一个进度条。
          </QxFairState>
        ) : (
          <QxFairSkel rows={2} />
        )}
        <div className="qx-rows">
          <QxFairNavRow icon={BuildingIcon} title="先看参展名单" description="名单和 AI 清单是两条线，互不影响。" onClick={() => navigate(`/job-fairs/${fairId}/companies`)} testId="visit-plan-companies" />
        </div>
      </QxFairShell>
    )
  }

  if (viewState === 'ai-unavailable') {
    return (
      <QxFairShell
        title={copy.title}
        subtitle={copy.subtitleHint}
        status={{ tone: 'warn', label: 'AI 不可用，浏览与打印不受影响' }}
        screen="visit-plan"
        state="ai-unavailable"
        ctabar={
          <QxFairCta variant="primary" testId="visit-plan-primary" onClick={() => navigate(`/job-fairs/${fairId}`)}>
            返回招聘会
          </QxFairCta>
        }
      >
        <QxFairState screen="visit-plan" tone="info" icon={AlertTriangleIcon} title="参会准备清单暂时生成不了">
          本机没有拿到可用的模型服务。参展名单、展位索引、物料打印和来源预约<b>都不依赖它</b>，可以照常使用。
        </QxFairState>
        <div className="qx-rows">
          <QxFairNavRow icon={BuildingIcon} title="自己看参展名单" description="不用 AI 也能挑出想去的单位。" onClick={() => navigate(`/job-fairs/${fairId}/companies`)} testId="visit-plan-companies-off" />
          <QxFairNavRow icon={FileTextIcon} title="打印一份纸质名单" description="拿在手上逐家勾，比屏幕好用。" onClick={() => navigate(`/job-fairs/${fairId}/materials`)} testId="visit-plan-materials" />
        </div>
      </QxFairShell>
    )
  }

  if (viewState === 'failed') {
    return (
      <QxFairShell
        title={copy.title}
        subtitle={copy.subtitleHint}
        status={{ tone: 'bad', label: '本次生成失败' }}
        screen="visit-plan"
        state="failed"
        ctabar={
          <>
            <QxFairCta onClick={() => navigate('/me/resumes')}>换一份简历再试</QxFairCta>
            <QxFairCta variant="primary" testId="visit-plan-primary" onClick={() => void handleGenerate()}>
              重新生成
            </QxFairCta>
          </>
        }
      >
        <QxFairState screen="visit-plan" tone="error" icon={AlertTriangleIcon} title="这次没生成出来">
          服务端返回失败。可能是简历内容不完整、参展名单还没回来，或者模型这会儿不稳定。<b>本机不会拿一份通用参会攻略冒充结果</b>。
          {error ? <p>{error}</p> : null}
        </QxFairState>
      </QxFairShell>
    )
  }

  if (plan) {
    return (
      <QxFairShell
        title={copy.title}
        subtitle={`${plan.basedOn?.fairName ?? plan.fair?.title ?? '招聘会'} · ${plan.basedOn?.companyCount ?? 0} 家企业 / ${plan.basedOn?.positionCount ?? 0} 个岗位`}
        status={{ tone: 'ok', label: '清单已由服务端返回' }}
        screen="visit-plan"
        state="ready"
        ctabar={
          <>
            <QxFairCta disabled={generating} onClick={() => void handleGenerate()}>
              {generating ? '正在生成' : '重新生成'}
            </QxFairCta>
            <QxFairCta variant="primary" testId="visit-plan-primary" disabled={printing} onClick={() => void handlePrint()}>
              <PrinterIcon aria-hidden />
              {printing ? copy.printing : copy.print}
            </QxFairCta>
          </>
        }
      >
        <div className="qx-fair-aibar">
          <span className="qx-fair-ai-ic"><SparklesIcon size={26} aria-hidden /></span>
          <span>
            <span className="qx-fair-ai-t">清单已生成，内容可以改也可以删</span>
            <span className="qx-fair-ai-d">
              {isReview
                ? '本回顾仅供本人后续跟进参考；岗位办理和结果均以来源平台为准，本系统不接收简历。'
                : '本准备单仅供本人参会准备参考；活动预约、岗位办理和结果均以来源平台为准，本系统不接收简历。'}
            </span>
          </span>
        </div>
        <section className="qx-card">
          <div className="qx-fair-blk-h">总览</div>
          <p className="qx-fair-local-note" style={{ color: 'var(--qx-ink)', fontSize: 20 }}>{plan.summary}</p>
        </section>
        <div className="qx-fair-two-col">
          <section className="qx-card">
            <div className="qx-fair-blk-h">{copy.companies.title}<span className="hint">{copy.companies.subtitle}</span></div>
            {(plan.priorityCompanies ?? []).length === 0 ? (
              <p className="qx-fair-local-note">
                {isReview
                  ? '本场企业信息有限，可前往来源平台查看该主办方发布的企业与在招岗位。'
                  : '本场企业信息有限，建议先打印活动资料并按现场展位逐一了解。'}
              </p>
            ) : (
              <dl className="qx-fair-kv">
                {(plan.priorityCompanies ?? []).map((company) => (
                  <div key={company.companyName} className="qx-fair-kv-row">
                    <dt>{company.companyName}</dt>
                    <dd>{company.reason}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
          <section className="qx-card">
            <div className="qx-fair-blk-h">{isReview ? '后续可做的跟进动作' : '参会前准备清单'}</div>
            <ul className="qx-fair-checklist">
              {((isReview ? plan.followUpActions : plan.preparationChecklist) ?? []).map((item) => (
                <li key={item} className="qx-fair-check"><span className="box" aria-hidden="true" />{item}</li>
              ))}
            </ul>
          </section>
        </div>
        <div className="qx-fair-two-col">
          <section className="qx-card">
            <div className="qx-fair-blk-h">{isReview ? '本场概况' : '本场看点'}</div>
            <ul className="qx-fair-bullets">
              {(plan.fairHighlights ?? []).map((item) => <li key={item} className="qx-fair-bullet"><i />{item}</li>)}
            </ul>
          </section>
          <section className="qx-card">
            <div className="qx-fair-blk-h">{isReview ? '下次同类活动可提前准备的问题' : '现场可咨询问题'}</div>
            <ul className="qx-fair-bullets">
              {((isReview ? plan.nextTimeQuestions : plan.questionsToAsk) ?? []).map((item) => (
                <li key={item} className="qx-fair-bullet"><i />{item}</li>
              ))}
            </ul>
          </section>
        </div>
        {!isReview && (plan.onsiteTips ?? []).length > 0 && (
          <section className="qx-card">
            <div className="qx-fair-blk-h">现场提醒<span className="hint">AI 生成，仅供参考</span></div>
            <ul className="qx-fair-bullets">
              {(plan.onsiteTips ?? []).map((item) => <li key={item} className="qx-fair-bullet"><i />{item}</li>)}
            </ul>
          </section>
        )}
        {isReview && (
          <section className="qx-card" data-review-records>
            <div className="qx-fair-blk-h">你在本机留下的记录<span className="hint">非 AI 生成，来自本机真实记录</span></div>
            {plan.localRecords?.requiresLogin ? (
              <p className="qx-fair-local-note">未登录会员，无法关联你在本机的浏览与跳转记录。</p>
            ) : (plan.localRecords?.openedCompanySourceEntries ?? []).length > 0 ? (
              <>
                <p className="qx-fair-local-note">你在本机打开过这些参展企业的来源投递入口：</p>
                <ul className="qx-fair-bullets">
                  {(plan.localRecords?.openedCompanySourceEntries ?? []).map((name) => (
                    <li key={name} className="qx-fair-bullet"><i />{name}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="qx-fair-local-note">本机没有你在这场招聘会打开来源投递入口的记录。</p>
            )}
            <p className="qx-fair-local-note">{REVIEW_DISCLOSURE}</p>
          </section>
        )}
        {error ? <p className="qx-fair-blocked">{error}</p> : null}
      </QxFairShell>
    )
  }

  return (
    <QxFairShell
      title="AI参会准备单"
      subtitle="基于本人简历与本场招聘会公开信息生成"
      status={{ tone: 'unknown', label: '待生成' }}
      screen="visit-plan"
      state="missing-context"
      ctabar={
        <>
          <QxFairCta onClick={() => navigate(`/job-fairs/${fairId}/materials`)}>打印活动资料</QxFairCta>
          <QxFairCta variant="primary" testId="visit-plan-primary" disabled={generating} onClick={() => void handleGenerate()}>
            {generating ? <><Loader2Icon aria-hidden />正在生成</> : copy.generate}
          </QxFairCta>
        </>
      }
    >
      <section className="qx-card">
        <div className="qx-fair-blk-h">将为你生成<span className="hint">结合简历诊断和招聘会公开快照</span></div>
        <p className="qx-fair-local-note">本准备单只服务本人参会准备；系统不会代办活动预约，也不会接收或转交简历。</p>
        <p className="qx-fair-local-note">如 AI 服务暂时不可用，你仍可以打印活动资料，按来源平台信息办理后续事项。</p>
      </section>
      {error ? <p className="qx-fair-blocked">{error}</p> : null}
    </QxFairShell>
  )
}
