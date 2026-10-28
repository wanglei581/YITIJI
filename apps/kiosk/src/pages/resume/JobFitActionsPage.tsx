// ============================================================
// P11 岗位匹配 · 差距行动清单（S2-2 拆页）。
//
// 拆页依据（`ai-capability-wiring-matrix-2026-08-16.md` §3.5）：
//   职责 —— 只列「要补什么、怎么补、本机能不能补」，并直连打印 / 简历优化 / 材料工厂。
//   入口 —— 比对结果页的「我要补这些差距」。
//   返回 —— 回比对结果页。
//   判据 —— 比对页专心做「差在哪」，行动页专心做「怎么办」。
//
// 视觉真值（2026-09-23 迁入青序流光）：
//   docs/design/kiosk-redesign-2026-08/46-resume-decision-workspace.html?screen=actions
// 与 /resume/job-fit 同一宿主：舞台（JobFitStage）、呈现件（jobFitQxKit）与窄屏壳层样式
// （job-fit-qx.css 的 .jfq-root 段）共用，本页独有的分组清单样式在 resume-decision-qx.css。
//
// 合规（CLAUDE.md §2 / compliance-boundary §4）：
//   本页只做「改简历、备材料、打印」三件本机能做的事。
//   **不出现任何投递动作** —— 岗位只是第三方来源信息，投递一律回来源平台完成。
//   来源卡的 CTA 用白名单里的「查看岗位」，跳回岗位详情页，由那里承载来源平台入口；
//   本页不自建第二个外跳入口，也不复述投递类文案。
// ============================================================

import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { JobFitResponse } from '@ai-job-print/shared'
import { BriefcaseIcon, ListIcon, PenLineIcon, PrinterIcon } from 'lucide-react'
import {
  AiDisclaimerLine,
  AigcMark,
  EvidenceBadge,
  EvidenceLegend,
  aiErrorMessageOf,
  deriveAiAvailability,
  isAiOutage,
  useAiTask,
} from '../../ai'
import { getLatestJobFit, printJobFit } from '../../services/api/jobFit'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import type { QxTouchRail } from '../../components/qingxu/touch/QxTouchBand'
import { ResumeErrorState, ResumeStepsState, ResumeWaitState } from './touch/ResumeStates'
import { ASKS } from './touch/resumeAsks'
import { unattendedReason } from './touch/unattendedReason'
import { ResumeTouchActs } from './touch/ResumeTouchActs'
import { ResumeDocArt } from './touch/ResumeDocArt'
import './touch/resume-fit.css'
import { ResumeTouchFrame } from './touch/ResumeTouchFrame'
import { readAiResumeSession } from './aiResumeSession'
import { useRecruitmentHosting } from '../../hooks/useRecruitmentHosting'
import { JobFitStage } from './JobFitPage'
import { useRouteIdentityGuard } from './hooks/useRouteIdentityGuard'
import {
  CtaNote,
  Guardline,
  KitRows,
  Sec,
  Verdict,
} from './jobFit/jobFitQxKit'
import './job-fit-qx.css'
import './resume-decision-qx.css'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useStartPrintHandoff } from '../print/usePrintHandoff'

const JOB_FIT_ROUTE = '/resume/job-fit'

type ActionsScreen =
  | 'session-ended'
  | 'missing-task'
  | 'loading'
  | 'unknown'
  | 'ai-down'
  | 'failed'
  | 'ready'
  | 'print-pending'
  | 'print-failed'

interface ScreenView {
  title: string
  subtitle: string
  pill: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  rail?: QxTouchRail
  body: ReactNode
  cta: ReactNode
}

function QxAction({ label, variant, onClick, icon }: {
  label: string
  variant: 'ghost' | 'primary' | 'teal'
  onClick: () => void
  icon?: ReactNode
}) {
  return (
    <button type="button" className="qx-btn" data-variant={variant} onClick={onClick}>
      {icon}
      {label}
    </button>
  )
}

export function JobFitActionsPage() {
  const navigate = useNavigate()
  const startPrint = useStartPrintHandoff()
  const location = useLocation()
  const { user, getToken } = useAuth()
  const state = location.state as Record<string, unknown> | null

  const session = useMemo(() => readAiResumeSession(), [])
  const { ended: identityEnded, begin, settle, isLive } = useRouteIdentityGuard({ user, getToken })
  const queryTaskId = useMemo(
    () => new URLSearchParams(location.search).get('taskId') ?? undefined,
    [location.search],
  )
  const currentToken = getToken()
  const stateTaskId = typeof state?.taskId === 'string' ? state.taskId : undefined
  const taskId = stateTaskId ?? queryTaskId ?? session?.taskId
  const usingSessionTask = !stateTaskId && !queryTaskId && Boolean(session?.taskId)
  const accessToken =
    (typeof state?.accessToken === 'string' ? state.accessToken : undefined) ??
    (usingSessionTask ? session?.accessToken : undefined)
  /** 与 JobFitPage 同一判据：无会员 token 但持匿名一次性令牌 = 匿名会话。 */
  const isAnonymous = !currentToken && Boolean(accessToken)

  const [storedResult, setResult] = useState<JobFitResponse | null>(null)
  /** 渲染闸：会话一结束，同一次渲染里就不再读存着的结果（存值随后在 layout effect 里清掉）。 */
  const result = identityEnded ? null : storedResult
  const [loading, setLoading] = useState(Boolean(taskId))
  const [aiOutage, setAiOutage] = useState<string | null>(null)
  const [probed, setProbed] = useState(false)
  const [failReason, setFailReason] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useBusyLock(printing)
  // 招聘内容托管（3.13）关闭时没有岗位信息可看：「看来源岗位要求」「查看岗位」换成本机照常能走的去处。
  const hostingOpen = useRecruitmentHosting().enabled

  // 会话结束的那一次提交：丢掉结果、放下忙态（忙锁不许按住隐私计时）。
  // 离开本页（打印等待屏的两个出口都会离开）则由身份闸的卸载代次作废晚到的打印返回。
  useLayoutEffect(() => {
    if (!identityEnded) return
    setResult(null)
    setError(null)
    setPrinting(false)
    setLoading(false)
  }, [identityEnded])

  useEffect(() => {
    if (identityEnded) return
    if (!taskId) {
      setLoading(false)
      return
    }
    const run = begin()
    if (!run) return
    let cancelled = false
    setLoading(true)
    getLatestJobFit(taskId, { token: getToken(), accessToken })
      .then((res) => {
        if (cancelled || !isLive(run)) return
        setProbed(true)
        if (res.status === 'completed') {
          setResult(res)
          if ((res.gapPoints ?? []).length === 0 && (res.targetedSuggestions ?? []).length === 0) {
            setFailReason('这次没有生成差距与准备建议。')
          }
        } else {
          setFailReason(res.failReason || '这次没有生成差距与准备建议。')
        }
      })
      .catch((err: unknown) => {
        if (cancelled || !isLive(run)) return
        if (isAiOutage(err)) {
          setAiOutage(aiErrorMessageOf(err, 'AI 服务当前不可用'))
          return
        }
        setProbed(true)
        setFailReason(aiErrorMessageOf(err, '匹配结果读取失败'))
      })
      .finally(() => {
        if (!cancelled && isLive(run)) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [identityEnded, taskId, accessToken, getToken, begin, isLive])

  const availability = deriveAiAvailability({ outage: aiOutage, probed })

  const gapPoints = result?.gapPoints ?? []
  const rewrites = result?.targetedSuggestions ?? []
  const hasActions = gapPoints.length > 0 || rewrites.length > 0

  const task = useAiTask({
    availability,
    pending: loading,
    failed: Boolean(failReason),
    hasResult: hasActions,
  })

  const backToCompare = () =>
    navigate(JOB_FIT_ROUTE, { state: taskId ? { taskId, accessToken } : undefined })
  const goResumeHub = () => navigate('/resume-service')
  const goTriage = () => navigate('/resume/source?intent=diagnose')
  const goJobs = () => navigate('/jobs')
  const goPrintHub = () => navigate('/print-scan')
  const goMaterials = () => navigate('/resume/materials')
  const goResumeOptimize = () =>
    navigate('/resume/optimize', { state: taskId ? { taskId, accessToken } : undefined })

  /**
   * 打印差距清单走既有 `POST /resume/job-fit/:taskId/print`，
   * 与比对页同一个端点、同一份 PDF —— 不为本页另造一种产物。
   * `printFileUrl` 缺失时诚实报错，不静默跳转到一个打不出东西的确认页。
   */
  const handlePrint = async () => {
    if (!taskId || printing) return
    const run = begin('print')
    if (!run) return
    setPrinting(true)
    setError(null)
    try {
      const file = await printJobFit(taskId, { token: getToken(), accessToken })
      if (!isLive(run)) return
      if (!file.printFileUrl) throw new Error('打印链接未就绪，请稍后重试')
      startPrint({
        origin: 'job_fit',
        returnPath: window.location.pathname,
        file: {
          name: file.filename,
          size:
            file.sizeBytes >= 1024 * 1024
              ? `${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB`
              : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`,
          pages: file.pageCount,
          fileId: file.fileId,
          fileUrl: file.printFileUrl,
          mimeType: 'application/pdf',
        },
      })
    } catch (err) {
      if (!isLive(run)) return
      setError(userMessageOf(err, '打印版生成失败，请稍后重试'))
    } finally {
      setPrinting(false)
      settle(run)
    }
  }

  /**
   * 两类降级（原 AiTaskRegion 的 blocked / result-unavailable，文案原样保留）：
   *  ai-down  差距清单由 AI 生成，这次读不到 → 常显原因，列出仍然可用的非 AI 去处。
   *  failed   服务通了但这次没出清单（含「完成但两组都为空」）→ 说清这次没有，保留返回入口。
   *
   * 两类都保证「AI 挂了仍拿得到东西」：岗位原文照常可看，简历原文照常可打印，
   * 简历优化编辑区照常能改。这不是安慰话 —— 那三条都不经过本页这条 AI 链路。
   */
  const screen: ActionsScreen = identityEnded ? 'session-ended' : !taskId
    ? 'missing-task'
    : loading
      ? 'loading'
      : task.isFailed
        ? (aiOutage ? 'ai-down' : 'failed')
        : !task.isDone
          ? 'unknown'
          : printing
            ? 'print-pending'
            : error
              ? 'print-failed'
              : 'ready'

  const jobLabel = result?.job?.title
    ? `${result.job.title}${result.job.company ? ` · ${result.job.company}` : ''}`
    : '这次匹配的目标岗位'

  function buildView(): ScreenView {
    // 出口一律不带 taskId / accessToken：会话已经不属于现在站在屏幕前的这一位。
    if (screen === 'session-ended') {
      return {
        title: '这次办理已结束',
        subtitle: '登录状态或这台机器上的这次使用刚刚变化（退出、过期或清场）。刚才的行动清单和还在路上的请求都不再显示或继续。',
        pill: { tone: 'warn', label: '这次办理已结束 · 内容已隐藏' },
        body: (
          <ResumeErrorState
            reasonTitle="这次没有发生的事"
            rows={[
              { title: '不再显示刚才的清单', desc: '差距清单与改写建议都已隐藏。' },
              { title: '不再用刚才的登录凭证', desc: '读取或生成打印版都不会再用它。' },
              { title: '不会再进入打印确认', desc: '还在路上的返回结果不会再把你带去打印确认页。' },
            ]}
            acts={[
              { title: '去准备简历材料', desc: '需要继续时，重新登录或重新准备一份简历，再回来做岗位对照。', take: '去准备', art: 'resume', onClick: goTriage },
              { title: '先打印现有简历', desc: '已有电子稿或纸质件时，直接走打印流程。', take: '去打印', art: 'report', onClick: goPrintHub },
            ]}
          />
        ),
        cta: (
          <>
            <CtaNote>需要继续时，请重新登录或重新准备简历材料。</CtaNote>
            <QxAction label="返回简历服务" variant="ghost" onClick={goResumeHub} />
            <QxAction label="去准备简历材料" variant="primary" onClick={goTriage} />
          </>
        ),
      }
    }

    if (screen === 'missing-task') {
      return {
        title: '还没有可用的匹配结果',
        subtitle: '请先完成一次岗位匹配参考，再看差距行动清单。行动清单必须来自真实的匹配结果，没有结果就不生成空模板。',
        pill: { tone: 'warn', label: '缺少可用的岗位匹配结果' },
        body: (
          <ResumeTouchActs
            note="请先完成一次岗位匹配参考。没有真实结果时，不生成也不打印任何清单。"
            items={[
              { title: '去做岗位匹配', desc: '选择目标岗位并确认授权，走完才会有行动清单。', take: '去岗位匹配', art: 'report', onClick: () => navigate(JOB_FIT_ROUTE) },
              hostingOpen
                ? { title: '先看来源岗位要求', desc: '直接浏览来源平台的岗位信息，自己比对要求。', take: '去岗位信息', art: 'checklist' as const, onClick: goJobs }
                : { title: '先准备简历材料', desc: '上传或扫描一份简历，解析成功后才能对照。', take: '去准备简历', art: 'resume' as const, onClick: goTriage },
            ]}
            fine="行动清单必须来自真实的匹配结果，没有结果就不生成空模板。"
          />
        ),
        cta: (
          <>
            <CtaNote>没有真实结果时，不生成也不打印任何清单。</CtaNote>
            <QxAction label="返回简历服务" variant="ghost" onClick={goResumeHub} />
            <QxAction label="去准备简历材料" variant="primary" onClick={goTriage} />
          </>
        ),
      }
    }

    if (screen === 'loading') {
      return {
        title: '正在读取，清单还没到',
        subtitle: '读取请求已提交。只有系统确认存在真实差距与建议，才会出现行动项。',
        pill: { tone: 'unknown', label: '正在读取行动清单' },
        rail: { labels: ['读取清单', '看行动项', '改简历或打印'], now: 0 },
        body: (
          <ResumeWaitState
            icon={<ListIcon size={34} />}
            title="读取请求已提交，等待返回"
            desc="清单内容全部来自这次匹配结果。读取失败或没有内容会直接说明，不补造行动项。"
            tag="整体等待中，没有百分比"
            fine="读取期间不放开打印，也不提前显示清单内容；请求带着你这次的身份，只返回属于你本人的清单。"
            take={{ art: 'checklist', kicker: '读到之后，你可以带走', title: '一份准备清单', lines: ['差距与准备建议，一件一件列出', '只供本人准备，可打印'] }}
          />
        ),
        cta: (
          <>
            <CtaNote>读取期间不放开打印，也不提前显示清单内容。</CtaNote>
            <QxAction label="返回简历服务" variant="ghost" onClick={goResumeHub} />
            <QxAction label="取消读取，返回匹配参考" variant="primary" onClick={backToCompare} />
          </>
        ),
      }
    }

    if (screen === 'ai-down') {
      return {
        title: '差距清单这次读不到',
        subtitle: `${unattendedReason(aiOutage, 'AI 服务当前不可用')} —— 差距与准备建议由 AI 生成，这次生成不了。`,
        pill: { tone: 'bad', label: 'AI 差距清单当前不可用' },
        body: (
          <>
            <Sec title="当前判定" hint="只写已经确认的事实">
              <Verdict items={[
                { tone: 'bad', label: 'AI 差距与准备建议', value: '当前不可用' },
                hostingOpen ? { tone: 'ok', label: '岗位原文与来源信息', value: '照常可看' } : { tone: 'ok', label: '简历优化编辑区', value: '照常能改' },
                { tone: 'ok', label: '简历原文与打印', value: '不经过这条 AI' },
              ]} />
              <p className="jfq-sec-copy">
                {hostingOpen
                  ? '岗位原文与来源信息照常可看；你的简历原文照常可打印；简历优化编辑区也照常能改。想投递请回岗位详情页，从来源平台入口走。'
                  : '你的简历原文照常可打印；简历优化编辑区也照常能改。'}
              </p>
            </Sec>
            <Sec title="现在能用的非 AI 入口" hint="都是既有流程" grow>
              <KitRows items={[
                { icon: <PenLineIcon size={22} />, title: '自己改简历', desc: '简历优化编辑区照常能改', onClick: goResumeOptimize },
                ...(hostingOpen ? [{ icon: <ListIcon size={22} />, title: '看来源岗位要求', desc: '直接浏览来源平台的岗位信息', onClick: goJobs }] : []),
                { icon: <PrinterIcon size={22} />, title: '打印现有简历', desc: '走既有打印流程，不依赖 AI', onClick: goPrintHub },
              ]} />
            </Sec>
          </>
        ),
        cta: (
          <>
            <CtaNote>AI 暂时不可用，这次没有行动清单。</CtaNote>
            <QxAction label="返回简历服务" variant="ghost" onClick={goResumeHub} />
            <QxAction label="返回比对结果" variant="primary" onClick={backToCompare} />
          </>
        ),
      }
    }

    if (screen === 'failed') {
      const reasonText = unattendedReason(failReason, '')
      return {
        title: '这次没有可执行的差距清单',
        subtitle: reasonText
          ? `本次没有可执行的差距清单：${reasonText}`
          : '本次没有可执行的差距清单。',
        pill: { tone: 'warn', label: '本次没有返回行动项' },
        body: (
          <ResumeErrorState
            reasonTitle="这次的结果"
            reason="这不是你的操作问题。可以回比对结果页重新分析一次；若这个岗位的要求写得很笼统，通常就抽不出可执行的差距项。"
            rows={[
              { title: '差距清单', desc: '这次没有' },
              { title: '匹配参考', desc: '回比对页查看' },
            ]}
            acts={[
              { title: '回比对结果', desc: '重新分析一次，或换一个更具体的目标岗位。', take: '返回比对结果', art: 'report', onClick: backToCompare },
              { title: '先自己改简历', desc: '按目标岗位调整内容重点，不依赖这份清单。', take: '去简历优化', art: 'resume', onClick: goResumeOptimize },
              hostingOpen
                ? { title: '看来源岗位要求', desc: '直接浏览来源平台的岗位信息，自己逐条比对。', take: '去岗位信息', art: 'checklist' as const, onClick: goJobs }
                : { title: '打印现有简历', desc: '手上已有可用文件时，直接进入既有打印流程。', take: '去打印服务', art: 'checklist' as const, onClick: goPrintHub },
            ]}
          />
        ),
        cta: (
          <>
            <CtaNote>没有返回的内容不会先填上凑数。</CtaNote>
            <QxAction label="返回简历服务" variant="ghost" onClick={goResumeHub} />
            <QxAction label="返回比对结果" variant="primary" onClick={backToCompare} />
          </>
        ),
      }
    }

    if (screen === 'unknown') {
      return {
        title: '还没有确认服务状态',
        subtitle: '还没有确认 AI 服务状态，本页暂不展示差距清单 —— 状态不明时不假装能算。',
        pill: { tone: 'unknown', label: '服务状态未确认' },
        body: (
          <ResumeTouchActs
            note="回到比对页会重新读取这次的匹配结果；状态没有确认之前，本页不显示任何清单内容。"
            items={[
              { title: '回比对结果', desc: '比对页会重新读取这次的匹配结果。', take: '返回比对结果', art: 'report', onClick: backToCompare },
              hostingOpen
                ? { title: '看来源岗位要求', desc: '直接浏览来源平台的岗位信息。', take: '去岗位信息', art: 'checklist' as const, onClick: goJobs }
                : { title: '先自己改简历', desc: '按目标岗位调整内容重点，不依赖这份清单。', take: '去简历优化', art: 'resume' as const, onClick: goResumeOptimize },
            ]}
            fine="状态不明时不显示任何清单内容，也不假装能算。"
          />
        ),
        cta: (
          <>
            <CtaNote>状态不明时不显示任何清单内容。</CtaNote>
            <QxAction label="返回比对结果" variant="primary" onClick={backToCompare} />
          </>
        ),
      }
    }

    if (screen === 'print-pending') {
      return {
        title: '打印版还没有生成',
        subtitle: '文件正在等待生成。生成成功才进入既有打印确认流程；本页不代表已打印或已出纸。',
        pill: { tone: 'unknown', label: '等待生成打印版文件' },
        body: (
          <ResumeStepsState
            steps={[
              { title: '清单已可读', detail: '行动项来自这次真实的匹配结果。' },
              { title: '等待生成打印文件', detail: '生成文件之前不进入打印，也没有进度和预计时间。', now: true },
              { title: '进入打印确认', detail: '份数、单双面与费用在确认页由你决定。' },
            ]}
            summary={[
              { label: '打印版文件', value: '还没有拿到可预览的打印版文件' },
              { label: '打印机', value: '没有发送到打印机，也没有开始出纸' },
              { label: '取件码', value: '没有产生取件码或订单号' },
              { label: '支付', value: '本页没有发起支付' },
              { label: '提供对象', value: '没有把清单内容提供给企业或第三方' },
            ]}
            fine="行动清单可读，不等于打印文件已经存在；清单内容没有提供给企业或第三方。"
            take={{ art: 'checklist', kicker: '生成之后，你可以带走', title: '一份准备清单', lines: ['差距与准备建议，一件一件列出', '只供本人准备，可打印'] }}
          />
        ),
        cta: (
          <>
            <CtaNote>离开本页后，这次生成的结果不会再把你带去打印确认页。</CtaNote>
            <QxAction label="返回比对结果" variant="ghost" onClick={backToCompare} />
            <QxAction label="改用现有文件打印" variant="primary" onClick={goPrintHub} />
          </>
        ),
      }
    }

    if (screen === 'print-failed') {
      return {
        title: '打印版没有生成成功',
        subtitle: '文件生成失败。系统不会把失败写成已发送打印。',
        pill: { tone: 'bad', label: '打印版文件生成失败' },
        body: (
          <ResumeErrorState
            reasonTitle="这次的结果"
            reason={error && (
              <span role="alert">{unattendedReason(error, '打印版这次没有生成成功，请重新生成，或改用现有文件打印。')}</span>
            )}
            rows={[
              { title: '打印版文件', desc: '未生成' },
              { title: '行动清单', desc: '仍可查看' },
              { title: '打印机', desc: '未收到任务' },
            ]}
            acts={[
              { title: '重新生成打印版', desc: '沿用当前清单再试一次，不重新跑匹配分析。', take: '重新生成', art: 'checklist', onClick: () => void handlePrint() },
              { title: '改用现有文件打印', desc: '手上已有可用文件或纸质件时，直接走既有打印流程。', take: '去打印服务', art: 'report', onClick: goPrintHub },
            ]}
          />
        ),
        cta: (
          <>
            <CtaNote>失败就是失败，不写成已发送到打印机。</CtaNote>
            <QxAction label="返回行动清单" variant="ghost" onClick={() => setError(null)} />
            <QxAction label="重新生成打印版" variant="primary" onClick={() => void handlePrint()} />
          </>
        ),
      }
    }

    return {
      title: '清单来了，一件一件来',
      subtitle: '每条准备事项都来自这次的匹配结果。没有返回的条目留空，不先填内容凑数。',
      pill: { tone: 'ok', label: '行动建议以真实匹配结果为准' },
      body: (
        <>
          <section className="jfq-summary rtp-fit-hero" aria-label="行动清单摘要">
            <div className="rtp-fit-art"><ResumeDocArt kind="checklist" /></div>
            <div className="rtp-fit-tx">
              <p className="jfq-summary-eyebrow"><AigcMark /></p>
              <h2 className="jfq-summary-title">可以先做这 {gapPoints.length + rewrites.length} 件</h2>
              <p className="rtp-fit-job">{jobLabel}</p>
              <div className="rdq-ai">
                <AiDisclaimerLine>
                  以下差距与准备建议由 AI 依据你的简历与该岗位公开要求生成，仅供参考，不代表任何招聘结果。
                </AiDisclaimerLine>
              </div>
            </div>
          </section>

          <div className="rtp-fit">
            {gapPoints.map((point, index) => (
              <div key={`${point.gap.slice(0, 24)}-${index}`} className="rtp-fit-row" data-tone="warn">
                <b><EvidenceBadge level="E3" /><i>准备</i> · {point.gap}</b>
                <span>{point.suggestion}</span>
              </div>
            ))}
            {rewrites.map((item, index) => (
              <div key={`${item.slice(0, 24)}-${index}`} className="rtp-fit-row" data-tone="ok">
                <b><EvidenceBadge level="E3" /><i>简历</i> · {item}</b>
              </div>
            ))}
            {gapPoints.length === 0 ? <p className="rdq-muted">这次返回的结果里没有差距项。</p> : null}
            {rewrites.length === 0 ? <p className="rdq-muted">这次返回的结果里没有改写建议。</p> : null}
          </div>

          <div className="qxt-exits">
            <button type="button" className="qxt-btn qxt-btn-sec qxt-btn-exit" onClick={goResumeOptimize}>去简历优化</button>
            <button type="button" className="qxt-btn qxt-btn-sec qxt-btn-exit" onClick={goMaterials}>去材料工坊</button>
          </div>

          <div className="rdq-ai">
            <EvidenceLegend />
          </div>

          <Guardline
            head="清单只供本人准备"
            body={hostingOpen
              ? '以下内容仅为帮助你修改简历与准备材料的参考，不代表任何招聘结果；本平台不提供投递功能，投递请前往岗位来源平台。'
              : '以下内容仅为帮助你修改简历与准备材料的参考，不代表任何招聘结果；本平台不提供投递功能。'}
          />

          {hostingOpen && result?.job?.sourceName && (
            <Sec title="岗位来源" hint="以来源平台公示为准">
              <div className="qx-card jfq-consent-card">
                <p>
                  岗位来源：{result.job.sourceName}
                  {result.job.externalId ? ` · 外部ID ${result.job.externalId}` : ''}
                </p>
                <p>准备好之后，请前往来源平台完成投递。</p>
                {result.job.id && (
                  <div className="rdq-actions">
                    <QxAction
                      label="查看岗位"
                      variant="teal"
                      icon={<BriefcaseIcon size={22} aria-hidden="true" />}
                      onClick={() => navigate(`/jobs/${result.job?.id ?? ''}`)}
                    />
                  </div>
                )}
              </div>
            </Sec>
          )}

          {isAnonymous && (
            <Guardline head="这次使用" body="未登录时，本次结果只保留在这台机器的这次使用里，离场即清。" />
          )}
        </>
      ),
      cta: (
        <>
          <CtaNote>没有返回的条目会一直留空，不会先填内容凑数。</CtaNote>
          <QxAction label="返回比对结果" variant="ghost" onClick={backToCompare} />
          <QxAction
            label="生成打印版"
            variant="primary"
            icon={<PrinterIcon size={22} aria-hidden="true" />}
            onClick={() => void handlePrint()}
          />
        </>
      ),
    }
  }

  const view = buildView()
  // 底栏「问小青」（稿 jobfit-actions）：生成打印版期间稿里 ask 为 false，不画；其余每个状态一句自己的问题。
  const askSpec = screen === 'session-ended' ? ASKS.actionsEnded
    : screen === 'missing-task' ? ASKS.actionsMissing
      : screen === 'loading' || screen === 'unknown' ? ASKS.actionsWait
        : screen === 'print-pending' ? null
          : screen === 'print-failed' ? ASKS.actionsPrintFailed
            : ASKS.actionsReady

  return (
    <JobFitStage>
      <ResumeTouchFrame
        eyebrow="简历对照 · 行动清单"
        title={view.title}
        subtitle={view.subtitle}
        status={view.pill}
        rail={view.rail}
        back={taskId && !identityEnded
          ? { label: '返回比对结果', onBack: backToCompare }
          : { label: '返回简历服务', onBack: goResumeHub }}
        ctabar={view.cta}
        ask={askSpec ? { ...askSpec, testId: 'job-fit-actions-ai-ask' } : false}
      >
        <main
          className="qx-scroll"
          data-kiosk-domain="resume"
          data-kiosk-screen="resume-job-fit-actions"
          data-state={screen}
          data-testid={`resume-job-fit-actions-state-${screen}`}
          {...task.containerProps}
        >
          {view.body}
        </main>
      </ResumeTouchFrame>
    </JobFitStage>
  )
}
