// ============================================================
// /job-fairs/:id/visit-plan —— AI 参会准备清单 / 参会回顾
// （稿 28-jobfair-enhanced.html，screen=visit-plan / 092）。
//
// 状态：missing-context | idle | generating | ready | ai-unavailable | failed | load-failed。
// 前五个与稿同名；`idle` 与 `load-failed` 是稿没建模、后端真实存在的两条路径，
// 已登记在 fairWorkbenchSpecs 的 FAIR_PILL_GAPS 并由 verify:fair-workbench-qx 钉住：
//   · idle        —— 简历上下文在（有 taskId），只是这场还没生成过清单。
//                    GET latest 对这种情况回 404 FAIR_VISIT_PLAN_NOT_FOUND，
//                    是这条链路最常见的应答。原先 catch 后一律落 missing-context，
//                    页面于是说「还没有选简历」并把唯一出口指向选简历——
//                    **生成入口从此不可达**，带着简历进来的人永远生成不了。
//   · load-failed —— 读上次结果真的失败了（5xx / 断网 / 超时）。不能伪装成空态：
//                    空态会让人以为没生成过，于是重新生成、重新付一次 AI 成本。
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
import { FileTextIcon, MapIcon, PrinterIcon, SparklesIcon, UsersIcon } from 'lucide-react'
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
import { isAiOutage } from '../../ai/aiOutage'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { QxFairWorkbench } from './QxFairWorkbench'
import { fairIsCentered } from './fairWorkbenchSpecs'
import { FairSkeletonList } from './components/FairWorkbenchBits'
import { FairVisitPlanBody } from './components/FairVisitPlanSections'
import {
  DirExitList,
  DirKv,
  DirNote,
  DirState,
  DirSteps,
  DirStrip,
  DirStripItem,
} from '../../components/qingxu/directory/DirectoryBits'

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
    // 副标题只说本机的排序依据。原来写的是「企业在活动结束后通常仍在招聘」——
    // 本机既不知道这些单位现在招不招，也无从核对，那是替用人单位做承诺。
    companies: { title: '仍可继续跟进的企业', subtitle: '按与简历方向匹配程度排序；是否仍在招聘以来源平台为准' },
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
  /** 读「上一次的结果」这一步本身失败了（不是生成失败，也不是没生成过）。 */
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadRetryKey, setLoadRetryKey] = useState(0)
  /**
   * 能力级故障（未配置 / 演示模式 / 模型根本够不着），不是「这次没成」。
   * 判据统一走 ai/aiOutage.ts 的 AI_OUTAGE_CODES —— 限流 429 与上游 5xx 不进表，
   * 那些只是本次失败，仍要保留重试入口，不许显示成「功能不可用」。
   */
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
    setLoading(true)
    setLoadError(null)
    getLatestFairVisitPlan(fairId, taskId, { token: getToken(), accessToken })
      .then((result) => { if (!cancelled && result.status === 'completed') setPlan(result) })
      .catch((err) => {
        if (cancelled) return
        // 404 = 这场还没生成过（FAIR_VISIT_PLAN_NOT_FOUND，或结束前生成、结束后再来读的
        // FAIR_VISIT_PLAN_STALE_MODE）。两者都是「可以生成」，不是故障，所以不报错。
        // 其余一切（5xx / 401 / 断网 / 超时）都是**这一步真的失败了**，必须说出来：
        // 原来一律 `.catch(() => undefined)` 吞掉，屏幕上看起来和「没生成过」一模一样。
        const status = err instanceof FairVisitPlanApiError ? err.status : null
        if (status === 404) return
        setLoadError(userMessageOf(err, '上次的参会准备单没取到，请重新加载'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId, taskId, accessToken, getToken, loadRetryKey])

  const handleGenerate = async () => {
    if (!taskId || !fairId) return
    setGenerating(true)
    setError(null)
    setAiUnavailable(false)
    try {
      const result = await generateFairVisitPlan(fairId, taskId, { token: getToken(), accessToken })
      if (result.status === 'failed') setError(result.failReason ?? '生成未完成，请稍后重试')
      else setPlan(result)
    } catch (err) {
      // 能力级故障与「这次没成」分开报：前者说清 AI 不可用、浏览与打印不受影响，
      // 后者保留重试。把限流报成「功能不可用」本身就是伪造能力的一种。
      setAiUnavailable(isAiOutage(err))
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

  // 页面状态与实际情况的对应（末位 idle 是关键：它才是「有简历、还没生成」的落点）：
  //   缺 taskId（没有本人简历上下文）→ missing-context
  //   正在生成 / 正在读上次结果      → generating
  //   已有结果                        → ready
  //   AI 能力不可用（非本次失败）    → ai-unavailable
  //   本次生成失败（有具体原因）      → failed
  //   读上次结果失败                  → load-failed
  //   以上都不是                      → idle（可以生成）
  const uiState = !taskId
    ? 'missing-context'
    : generating || loading
      ? 'generating'
      : plan
        ? 'ready'
        : aiUnavailable
          ? 'ai-unavailable'
          : error
            ? 'failed'
            : loadError
              ? 'load-failed'
              : 'idle'

  const exitItems = (
    <>
      <DirStripItem icon={UsersIcon} title="先看参展名单" desc="名单和 AI 清单是两条线，互不影响" onClick={() => navigate(`/job-fairs/${fairId}/companies`)} />
      <DirStripItem icon={MapIcon} tone="slate" title="看展位索引" desc="按展位号先规划自己的顺序" onClick={() => navigate(`/job-fairs/${fairId}/map`)} />
      <DirStripItem icon={PrinterIcon} tone="wheat" title="打印一份纸质名单" desc="拿在手上逐家勾，比屏幕好用" onClick={() => navigate(`/job-fairs/${fairId}/materials`)} />
    </>
  )
  /*
   * 出口条有两种形态，按这一屏是否居中来选：
   *
   * 居中态（generating / ai-unavailable / failed / load-failed）内容短，稿让整块
   * 垂直居中，横向的 DirStrip 正合适。
   *
   * 顶部对齐的两个信息态（missing-context / idle）内容是**固定文案**，跟后端返回
   * 多少数据无关：实测底部恒空 701px / 636px，这是真的死白，不是夹具只有一条记录。
   * 这里改用共享的 DirExitList —— 它本来就是「可吸收余量的纵向出口列表」
   * （directory-qx.css: .dw-exitlist{flex:1}，卡片更高、图标与字号更大）。
   * 余量变成更大的触控目标，是 primitives.css 余量规则里的第一优先级，
   * 比塞占位内容或把文字拉高都好。
   */
  const exits = fairIsCentered('visit-plan', uiState)
    ? <DirStrip>{exitItems}</DirStrip>
    : <DirExitList>{exitItems}</DirExitList>

  const ctabar = uiState === 'missing-context'
    ? (
      <>
        <p className="why">没有简历也照样能逛：参展名单、展位索引和物料打印都不需要 AI。</p>
        <button type="button" className="qx-btn narrow" data-variant="ghost" onClick={() => navigate(`/job-fairs/${fairId}/materials`)}>打印活动资料</button>
        <button type="button" className="qx-btn narrow" data-variant="primary" onClick={() => navigate('/resume/source?intent=diagnose')}>选择本人简历</button>
      </>
    )
    : uiState === 'idle'
      ? (
        <>
          {/* 这一态的全部意义就是让生成键够得着。此前它被折进 missing-context，
              底栏主键是「选择本人简历」—— 简历明明已经确认过了。 */}
          <p className="why">生成不保证成功；失败会明确说明原因，不会给你一份空清单。</p>
          <button type="button" className="qx-btn narrow" data-variant="ghost" onClick={() => navigate(`/job-fairs/${fairId}/materials`)}>打印活动资料</button>
          <button
            type="button"
            className="qx-btn narrow"
            data-variant="primary"
            data-testid="fair-visit-plan-generate"
            disabled={generating}
            onClick={() => void handleGenerate()}
          >
            <SparklesIcon size={20} aria-hidden />
            {copy.generate}
          </button>
        </>
      )
    : uiState === 'load-failed'
      ? (
        <>
          <p className="why">读取上次结果失败不影响重新生成，但会多花一次 AI 额度。</p>
          <button
            type="button"
            className="qx-btn narrow"
            data-variant="ghost"
            data-testid="fair-visit-plan-reload"
            onClick={() => setLoadRetryKey((k) => k + 1)}
          >
            重新加载
          </button>
          <button
            type="button"
            className="qx-btn narrow"
            data-variant="primary"
            data-testid="fair-visit-plan-generate"
            disabled={generating}
            onClick={() => void handleGenerate()}
          >
            <SparklesIcon size={20} aria-hidden />
            {copy.generate}
          </button>
        </>
      )
    : uiState === 'generating'
      ? (
        <>
          <p className="why">生成不保证成功；失败会明确说明原因，不会给你一份空清单。</p>
          <button type="button" className="qx-btn narrow" data-variant="ghost" onClick={() => navigate(`/job-fairs/${fairId}`)}>返回招聘会</button>
        </>
      )
      : uiState === 'ai-unavailable'
      ? (
        <>
          {/* AI 是加速器不是前置条件：能力不可用时这条出口必须仍然能走到出纸。 */}
          <p className="why">AI 不可用不影响你逛名单、查展位和打印资料。</p>
          <button type="button" className="qx-btn narrow" data-variant="ghost" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>看参展名单</button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate(`/job-fairs/${fairId}/materials`)}>
            <PrinterIcon size={20} aria-hidden />
            打印活动资料
          </button>
        </>
      )
      : uiState === 'failed'
        ? (
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/resume/source?intent=diagnose')}>换一份简历再试</button>
            <button type="button" className="qx-btn" data-variant="primary" disabled={generating} onClick={() => void handleGenerate()}>
              {generating ? '正在生成' : '重新生成'}
            </button>
          </>
        )
        : (
          <>
            <button type="button" className="qx-btn narrow" data-variant="ghost" disabled={generating} onClick={() => void handleGenerate()}>
              {generating ? '正在生成' : '重新生成'}
            </button>
            <button type="button" className="qx-btn" data-variant="primary" disabled={printing} onClick={() => void handlePrint()}>
              <PrinterIcon size={20} aria-hidden />
              {printing ? copy.printing : copy.print}
            </button>
          </>
        )

  return (
    <QxFairWorkbench
      screen="visit-plan"
      state={uiState}
      fairId={fairId}
      title={copy.title}
      subtitle={plan
        ? `${plan.basedOn?.fairName ?? plan.fair?.title ?? '招聘会'} · ${plan.basedOn?.companyCount ?? 0} 家企业 / ${plan.basedOn?.positionCount ?? 0} 个岗位`
        : copy.subtitleHint}
      ctabar={ctabar}
    >
      {uiState === 'missing-context' ? (
        <>
          <DirNote>
            <b>参会准备清单需要两样东西。</b>
            一份你本人的简历，和这场招聘会真实的参展企业与岗位。两样都齐了才生成，缺一样就先不生成。
          </DirNote>
          <section className="dw-blk">
            <div className="dw-sec-h"><span className="t">当前上下文</span></div>
            <DirKv rows={[
              ['本人简历', taskId ? '已确认' : '还没有选'],
              ['参展企业上下文', '生成时按服务端返回的本场名单计算'],
              ['是否发给企业', '不会。系统不代投、不替企业筛选或邀约。'],
            ]} />
          </section>
          <section className="dw-blk">
            <div className="dw-sec-h"><span className="t">清单里会有什么、不会有什么</span></div>
            <DirSteps items={[
              '按名单里的单位，列出可以问的问题和要带的材料。',
              '指出你简历里和这些岗位对不上的地方，让你现场好解释。',
              '不排推荐路线、不预测你能不能拿到面试、不替你联系任何单位。',
            ]} />
          </section>
          <p className="dw-why">{copy.emptyLead}</p>
          {exits}
        </>
      ) : uiState === 'idle' ? (
        <>
          <DirState tone="info" testId="fair-visit-plan-idle" title="这场还没有生成过清单">
            你本人的简历已经确认过了，只是<b>这场招聘会还没有生成过</b>。
            本机不会先摆一份空清单占位——底部那个键点下去才会真的去生成。
          </DirState>
          <section className="dw-blk">
            <div className="dw-sec-h"><span className="t">当前上下文</span></div>
            <DirKv rows={[
              ['本人简历', '已确认'],
              ['本场是否已生成', '服务端没有这场的结果，可以现在生成'],
              ['参展企业上下文', '生成时按服务端返回的本场名单计算'],
              ['是否发给企业', '不会。系统不代投、不替企业筛选或邀约。'],
            ]} />
          </section>
          <section className="dw-blk">
            <div className="dw-sec-h"><span className="t">清单里会有什么、不会有什么</span></div>
            <DirSteps items={[
              '按名单里的单位，列出可以问的问题和要带的材料。',
              '指出你简历里和这些岗位对不上的地方，让你现场好解释。',
              '不排推荐路线、不预测你能不能拿到面试、不替你联系任何单位。',
            ]} />
          </section>
          {exits}
        </>
      ) : uiState === 'load-failed' ? (
        <>
          <DirState tone="error" testId="fair-visit-plan-load-failed" title="上次的清单没取到">
            {loadError}
            <br />
            这是<b>读取上一次结果失败</b>，不是你没生成过。本机不拿一张空白页冒充「还没生成」——
            那会让你为同一场重复生成一次，多花一次额度。先重新加载；确实需要新的再点生成。
          </DirState>
          {exits}
        </>
      ) : uiState === 'generating' ? (
        <>
          <DirState tone="info" testId="fair-visit-plan-generating" title="正在按你的简历和这场名单生成清单">
            任务已经提交，结果由服务端返回后才会显示。这中间<b>没有百分比可以给你</b>，本机不会编一个进度条。
          </DirState>
          <FairSkeletonList rows={2} />
          {exits}
        </>
      ) : uiState === 'ai-unavailable' ? (
        <>
          {/* 告警语气由顶栏胶囊承担（稿 PILL visit-plan:ai-unavailable = warn）；
              正文块用 info —— DirState 是五个服务台共用的共享件，这里不为一页扩它的 tone 联合。 */}
          <DirState tone="info" testId="fair-visit-plan-ai-unavailable" title="AI 这会儿用不了">
            {error}
            <br />
            这是<b>整条 AI 能力当前不可用</b>，不是你的简历有问题，重试也不会变。
            参展名单、展位索引和物料打印<b>都不经过 AI，照常可用</b>。
          </DirState>
          {exits}
        </>
      ) : uiState === 'failed' ? (
        <>
          <DirState tone="error" testId="fair-visit-plan-failed" title="这次没生成出来">
            {error}
            <br />
            可能是简历内容不完整、参展名单还没回来，或者模型这会儿不稳定。<b>本机不会拿一份通用参会攻略冒充结果</b>。
          </DirState>
          {exits}
        </>
      ) : plan ? (
        <>
          {/* ready 态的正文分区抽到 components/FairVisitPlanSections.tsx：
              本页补回 idle / load-failed 两个真实状态后越过 500 行门槛。
              抽的只是渲染，状态机与副作用全留在这里。 */}
          <FairVisitPlanBody
            plan={plan}
            isReview={isReview}
            companiesCopy={copy.companies}
            reviewDisclosure={REVIEW_DISCLOSURE}
          />

          {error ? (
            <DirState tone="error" testId="fair-visit-plan-action-error" title="上一步没有完成">{error}</DirState>
          ) : null}

          <DirStrip>
            <DirStripItem icon={UsersIcon} title="对照参展名单核一遍" desc="清单里的每家单位都能在名单里找到" onClick={() => navigate(`/job-fairs/${fairId}/companies`)} />
            <DirStripItem icon={FileTextIcon} tone="slate" title="我的文档" desc="是否入库以服务端返回为准" onClick={() => navigate('/me/documents')} />
            <DirStripItem icon={SparklesIcon} tone="wheat" title="AI服务记录" desc="本人 AI 服务记录" onClick={() => navigate('/me/ai-records')} />
          </DirStrip>
        </>
      ) : null}
    </QxFairWorkbench>
  )
}
