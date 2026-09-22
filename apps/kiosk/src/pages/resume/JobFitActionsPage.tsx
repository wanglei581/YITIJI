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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { JobFitResponse } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import { BriefcaseIcon, FileTextIcon, ListIcon, PenLineIcon, PrinterIcon, UserIcon } from 'lucide-react'
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
import type { AuthContextValue } from '../../auth/context'
import { onMemberSessionExpired } from '../../services/auth/memberSessionEvents'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { readAiResumeSession } from './aiResumeSession'
import { JobFitStage } from './JobFitPage'
import {
  Checks,
  CtaNote,
  Ghosts,
  Guardline,
  KitRows,
  Nots,
  RouteCards,
  Sec,
  Slots,
  Steps,
  Trace,
  Verdict,
  Waiting,
} from './jobFit/jobFitQxKit'
import './job-fit-qx.css'
import './resume-decision-qx.css'
import { userMessageOf } from '../../services/api/userErrorMessage'

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
  body: ReactNode
  cta: ReactNode
}

/** 生成 / 打印各自独占：同类已有一趟在路上，第二趟直接不发。读取不设独占（effect 的 cancelled 作废旧的那趟）。 */
type RouteLane = 'generate' | 'print'
interface RouteRun { readonly epoch: number; readonly lane: RouteLane | null }

function aiResumeSessionKey(): string | null {
  const session = readAiResumeSession()
  return session ? `${session.taskId}\n${session.accessToken ?? ''}` : null
}

/**
 * 把当前这条历史记录里上一位的任务凭据洗掉：state（React Router 的 usr）里的 taskId / accessToken
 * 与地址里的 taskId。直接改 window.history，保留 key / idx 与其它字段；只在地址仍是本路由时动手。
 * 401 之后回登录页是整页跳转，再按浏览器返回，这条记录会重新挂载成下一位 —— 不能让它捡回这些。
 */
function scrubRouteHistoryEntry(routePath: string): void {
  if (typeof window === 'undefined' || window.location.pathname !== routePath) return
  const entry = window.history.state as { usr?: unknown } | null
  const url = new URL(window.location.href)
  const usr = entry?.usr && typeof entry.usr === 'object' ? { ...(entry.usr as Record<string, unknown>) } : null
  const stateHasTask = usr !== null && ('taskId' in usr || 'accessToken' in usr)
  if (!stateHasTask && !url.searchParams.has('taskId')) return
  url.searchParams.delete('taskId')
  if (usr) {
    delete usr.taskId
    delete usr.accessToken
  }
  const nextUsr = usr && Object.keys(usr).length > 0 ? usr : stateHasTask ? null : entry?.usr
  window.history.replaceState({ ...entry, usr: nextUsr }, '', `${url.pathname}${url.search}${url.hash}`)
}

/**
 * 决策工作台路由的身份闸（本页与 /resume/career-plan 共用，判据只留这一份）。
 *
 * 挂载那一刻绑定：会员 id + 令牌原文（游客为 guest），以及本机 AI 简历会话（taskId + 匿名
 * accessToken，登出 / 清场会同步抹掉）。路由还挂着时任一项变了 —— 登出、401 过期而回登录页
 * 还在等扫描收尾、换人、清场 —— 这次会话就**永久结束**：
 *  - 同一次渲染 `ended` 已为真，页面只画会话结束屏，不读挂载时存下的任何结果；
 *  - 在路上的读取 / 生成 / 打印回来时 `isLive` 为假：不写结果、不导航；
 *  - `begin` 不再放行任何请求，挂载时的 taskId / 匿名 accessToken 落不到下一位身上。
 * `isLive` / `begin` 同步读令牌与会话，登出已发生、还没重渲染的那一拍也拦得住；结束与卸载都让代次 +1。
 * 生成 / 打印同类独占，所以调用方 finally 里放下的只可能是它自己那一趟的忙态，碰不到更新的一趟。
 * 另外两处调同一个 `scrubRouteHistoryEntry`：会员会话失效事件的同步派发里（没有待撤扫描时 AuthProvider
 * 在同一调用栈里就整页跳走，React 来不及再渲染），以及会话结束后的 effect（其余身份变化与扫描收尾按住的路径）。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 宿主 46 两条兄弟路由共用这一道闸，判据只留一份
export function useRouteIdentityGuard({ user, getToken }: Pick<AuthContextValue, 'user' | 'getToken'>) {
  const { pathname } = useLocation()
  const token = user ? getToken() : null
  const identity = user ? `member\n${user.id}\n${token ?? ''}` : 'guest'
  const session = aiResumeSessionKey()
  const [bound] = useState(() => ({ identity, token, session, path: pathname }))
  const [latched, setLatched] = useState(false)
  const endedRef = useRef(false)
  const epochRef = useRef(0)
  const lanesRef = useRef(new Set<RouteLane>())
  const ended = latched || identity !== bound.identity || session !== bound.session

  const end = useCallback(() => {
    if (endedRef.current) return
    endedRef.current = true
    epochRef.current += 1
    setLatched(true)
  }, [])
  useLayoutEffect(() => { if (ended) end() }, [ended, end])
  useEffect(() => () => { epochRef.current += 1 }, [])
  // 与 AuthProvider 同一判据（只认本页绑定的那张会员令牌失效）。事件派发是同步的：无论本监听排在
  // AuthProvider 之前还是之后，都落在整页跳转真正卸载本页之前。路由不变，会话结束屏与扫描收尾照旧。
  useEffect(() => onMemberSessionExpired((failedToken) => {
    if (bound.token === null || (failedToken && failedToken !== bound.token)) return
    scrubRouteHistoryEntry(bound.path)
  }), [bound])
  useEffect(() => { if (ended) scrubRouteHistoryEntry(bound.path) }, [ended, bound])

  const stillBound = useCallback((): boolean => {
    if (endedRef.current) return false
    if (getToken() === bound.token && aiResumeSessionKey() === bound.session) return true
    end()
    return false
  }, [bound, getToken, end])
  const begin = useCallback((lane: RouteLane | null = null): RouteRun | null => {
    if (!stillBound() || (lane && lanesRef.current.has(lane))) return null
    if (lane) lanesRef.current.add(lane)
    return { epoch: epochRef.current, lane }
  }, [stillBound])
  const settle = useCallback((run: RouteRun) => { if (run.lane) lanesRef.current.delete(run.lane) }, [])
  const isLive = useCallback((run: RouteRun): boolean => run.epoch === epochRef.current && stillBound(), [stillBound])

  return { ended, begin, settle, isLive }
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
      navigate('/print/confirm', {
        state: {
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
          params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
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
        title: '这次会话已结束',
        subtitle: '登录状态或本机会话刚刚变化（退出、过期或清场）。刚才的行动清单和还在路上的请求都不再显示或继续。',
        pill: { tone: 'warn', label: '会话已结束 · 内容已隐藏' },
        body: (
          <Sec title="这次没有发生的事" hint="明确否定，避免误解" grow>
            <Nots items={[
              '不再显示刚才的差距清单与改写建议',
              '不再用刚才的登录凭证读取或生成打印版',
              '还在路上的返回结果不会再进入打印确认',
            ]} />
          </Sec>
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
          <>
            <Sec no="01" title="清单依赖的三项输入" hint="缺一项就不生成">
              <Slots items={[
                { label: '本人简历任务', value: '尚未确认' },
                { label: '目标岗位', value: '尚未选择' },
                { label: '匹配结果', value: '尚未生成' },
              ]} />
            </Sec>
            <Sec no="02" title="拿到清单的四步" hint="顺序固定，不能跳过" copy="每一步都在既有流程里完成，本页不会替你跳过其中任何一步。" grow>
              <Steps items={[
                { title: '准备本人简历任务', desc: '上传 PDF 或扫描纸质简历，等待解析成功。' },
                { title: '选择目标岗位', desc: '从已发布岗位中选择，或只填一个目标岗位名称。' },
                { title: '确认本人授权', desc: '确认之后，简历才会用于这次岗位匹配分析。' },
                { title: '等待匹配结果返回', desc: '结果返回后，差距与建议才会变成可执行的行动项。' },
              ]} />
            </Sec>
            <Sec no="03" title="现在就能开始的两条路" hint="按你手上有什么来选">
              <RouteCards items={[
                { title: '去做岗位匹配', desc: '选择目标岗位并确认授权，走完才会有行动清单。', action: '去岗位匹配', onClick: () => navigate(JOB_FIT_ROUTE) },
                { title: '先看来源岗位要求', desc: '直接浏览来源平台的岗位信息，自己比对要求。', action: '去岗位信息', onClick: goJobs },
              ]} />
            </Sec>
          </>
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
        subtitle: '读取请求已提交。只有服务端确认存在真实差距与建议，才会出现行动项。',
        pill: { tone: 'unknown', label: '正在读取行动清单' },
        body: (
          <>
            <Sec title="正在读取本人的行动清单" hint="无进度条 · 无预计时间">
              <Waiting
                icon={<ListIcon size={34} />}
                title="读取请求已提交，等待服务端返回"
                desc="清单内容全部来自这次匹配结果。读取失败或没有内容会直接说明，不补造行动项。"
                tag="整体等待中，没有百分比"
              />
            </Sec>
            <Sec title="这次读取用到的条件" hint="每一项都可核对" grow>
              <Checks items={[
                { tone: 'ok', icon: <UserIcon size={24} />, title: '本人凭证', desc: '请求带着本机当前会话的凭证，服务端据此只返回属于你本人的清单。', chip: '已提交' },
                { tone: 'wait', icon: <FileTextIcon size={24} />, title: '匹配结果', desc: '按这次匹配的任务读取；任务失效或不属于你时会直接说明。', chip: '等待返回' },
                { tone: 'wait', icon: <ListIcon size={24} />, title: '行动项内容', desc: '差距与准备建议由服务端逐条给出。', chip: '等待返回' },
                { tone: 'wait', icon: <PrinterIcon size={24} />, title: '打印版文件', desc: '清单可读之后才谈打印，本页现在不生成任何文件。', chip: '未开始' },
              ]} />
            </Sec>
            <Sec title="还没有返回的内容" hint="返回前一律留空">
              <Ghosts items={[
                { title: '差距与依据', desc: '每条行动项对应的岗位要求与准备建议，返回后才显示。', tag: '等待返回' },
                { title: '可执行动作', desc: '优化、材料准备还是打印，按真实建议再决定。', tag: '等待返回' },
              ]} />
            </Sec>
          </>
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
        subtitle: `${aiOutage ?? 'AI 服务当前不可用'} —— 差距与准备建议由 AI 生成，这次生成不了。`,
        pill: { tone: 'bad', label: 'AI 差距清单当前不可用' },
        body: (
          <>
            <Sec title="当前判定" hint="只写已经确认的事实">
              <Verdict items={[
                { tone: 'bad', label: 'AI 差距与准备建议', value: '当前不可用' },
                { tone: 'ok', label: '岗位原文与来源信息', value: '照常可看' },
                { tone: 'ok', label: '简历原文与打印', value: '不经过这条 AI' },
              ]} />
              <p className="jfq-sec-copy">
                岗位原文与来源信息照常可看；你的简历原文照常可打印；简历优化编辑区也照常能改。想投递请回岗位详情页，从来源平台入口走。
              </p>
            </Sec>
            <Sec title="现在能用的非 AI 入口" hint="都是既有流程" grow>
              <KitRows items={[
                { icon: <PenLineIcon size={22} />, title: '自己改简历', desc: '简历优化编辑区照常能改', onClick: goResumeOptimize },
                { icon: <ListIcon size={22} />, title: '看来源岗位要求', desc: '直接浏览来源平台的岗位信息', onClick: goJobs },
                { icon: <PrinterIcon size={22} />, title: '打印现有简历', desc: '走既有打印流程，不依赖 AI', onClick: goPrintHub },
              ]} />
            </Sec>
          </>
        ),
        cta: (
          <>
            <CtaNote>服务不可用时不显示任何清单内容，也不承诺恢复时间。</CtaNote>
            <QxAction label="返回简历服务" variant="ghost" onClick={goResumeHub} />
            <QxAction label="返回比对结果" variant="primary" onClick={backToCompare} />
          </>
        ),
      }
    }

    if (screen === 'failed') {
      return {
        title: '这次没有可执行的差距清单',
        subtitle: failReason
          ? `本次没有可执行的差距清单：${failReason}`
          : '本次没有可执行的差距清单。',
        pill: { tone: 'warn', label: '本次没有返回行动项' },
        body: (
          <>
            <Sec title="这次的结果" hint="只写事实，不补内容">
              <Verdict items={[
                { tone: 'warn', label: '差距清单', value: '这次没有' },
                { tone: 'ok', label: '匹配参考', value: '回比对页查看' },
              ]} />
              <p className="jfq-sec-copy">
                这不是你的操作问题。可以回比对结果页重新分析一次；若这个岗位的要求写得很笼统，通常就抽不出可执行的差距项。
              </p>
            </Sec>
            <Sec title="接下来" hint="都进入既有流程" grow>
              <RouteCards items={[
                { title: '回比对结果', desc: '重新分析一次，或换一个更具体的目标岗位。', action: '返回比对结果', onClick: backToCompare },
                { title: '先自己改简历', desc: '按目标岗位调整内容重点，不依赖这份清单。', action: '去简历优化', onClick: goResumeOptimize },
                { title: '看来源岗位要求', desc: '直接浏览来源平台的岗位信息，自己逐条比对。', action: '去岗位信息', onClick: goJobs },
              ]} />
            </Sec>
          </>
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
          <Sec title="现在能做的" hint="回到比对页会重新读取" grow>
            <RouteCards items={[
              { title: '回比对结果', desc: '比对页会重新读取这次的匹配结果。', action: '返回比对结果', onClick: backToCompare },
              { title: '看来源岗位要求', desc: '直接浏览来源平台的岗位信息。', action: '去岗位信息', onClick: goJobs },
            ]} />
          </Sec>
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
        subtitle: '文件正在等待服务端生成。生成成功才进入既有打印确认流程；本页不代表已打印或已出纸。',
        pill: { tone: 'unknown', label: '等待服务端生成打印版文件' },
        body: (
          <>
            <Sec title="已提交生成打印版" hint="生成 ≠ 打印">
              <Waiting
                icon={<PrinterIcon size={34} />}
                title="请求已提交，等待文件生成"
                desc="行动清单可读，不等于打印文件已经存在。文件真实生成后，才会进入既有的打印确认与取件流程。"
                tag="等待生成，没有进度和预计时间"
              />
            </Sec>
            <Sec title="打印这件事现在到哪一步" hint="只标位置，不画进度">
              <Trace items={[
                { phase: '第一步', title: '清单已可读', desc: '行动项来自这次真实的匹配结果。' },
                { phase: '第二步', title: '等待生成文件', desc: '服务端生成文件之前不进入打印。', now: true },
                { phase: '第三步', title: '进入打印确认', desc: '份数、单双面与费用在确认页由你决定。' },
              ]} />
            </Sec>
            <Sec title="现在还没有发生的事" hint="不提前写成已完成" grow>
              <Nots items={[
                '没有发送到打印机，也没有开始出纸',
                '没有产生取件码或订单号',
                '本页没有发起支付',
                '还没有拿到可预览的打印版文件',
                '没有把清单内容提供给企业或第三方',
              ]} />
            </Sec>
          </>
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
          <>
            <Sec title="这次的结果" hint="只写已确认的事实">
              <Verdict items={[
                { tone: 'bad', label: '打印版文件', value: '未生成' },
                { tone: 'ok', label: '行动清单', value: '仍可查看' },
                { tone: 'ok', label: '打印机', value: '未收到任务' },
              ]} />
              {error && (
                <p className="jfq-alert" role="alert">{error}</p>
              )}
            </Sec>
            <Sec title="接下来" hint="两条都进入既有流程" grow>
              <RouteCards items={[
                { title: '重新生成打印版', desc: '沿用当前清单再试一次，不重新跑匹配分析。', action: '重新生成', onClick: () => void handlePrint() },
                { title: '改用现有文件打印', desc: '手上已有可用文件或纸质件时，直接走既有打印流程。', action: '去打印服务', onClick: goPrintHub },
              ]} />
            </Sec>
          </>
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
          <Sec title="你的准备清单" hint="按这次返回的内容分组" grow>
            <Slots items={[
              { label: '目标岗位', value: jobLabel },
              { label: '清单归属', value: '仅本人准备使用', fixed: true },
            ]} />
            <div className="rdq-ai">
              <AiDisclaimerLine>
                以下差距与准备建议由 AI 依据你的简历与该岗位公开要求生成，仅供参考，不代表任何招聘结果。
              </AiDisclaimerLine>
            </div>
            <div className="rdq-groups">
              <section className="rdq-group" data-tone="urgent" aria-label="差距与准备建议">
                <div className="rdq-group-top">
                  <span className="rdq-group-no" aria-hidden="true">1</span>
                  <b>差距与准备建议</b>
                  <span className="rdq-group-chip">{gapPoints.length > 0 ? `${gapPoints.length} 项` : '本次未提供'}</span>
                </div>
                <p className="rdq-group-desc">岗位要求里有、简历里还看不到的部分，以及每一项怎么补。</p>
                {gapPoints.length > 0 ? (
                  <ul className="rdq-items">
                    {gapPoints.map((point, index) => (
                      <li key={`${point.gap.slice(0, 24)}-${index}`} className="rdq-item">
                        <b><EvidenceBadge level="E3" />{point.gap}</b>
                        <p>{point.suggestion}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rdq-muted">这次返回的结果里没有差距项。</p>
                )}
              </section>
              <section className="rdq-group" data-tone="week" aria-label="简历定向优化建议">
                <div className="rdq-group-top">
                  <span className="rdq-group-no" aria-hidden="true">2</span>
                  <b>简历定向优化建议</b>
                  <span className="rdq-group-chip">{rewrites.length > 0 ? `${rewrites.length} 条` : '本次未提供'}</span>
                </div>
                <p className="rdq-group-desc">照着改的是你自己的简历，本页不会自动改写或保存任何内容。</p>
                {rewrites.length > 0 ? (
                  <ul className="rdq-items">
                    {rewrites.map((item, index) => (
                      <li key={`${item.slice(0, 24)}-${index}`} className="rdq-item">
                        <b><EvidenceBadge level="E3" />{item}</b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rdq-muted">这次返回的结果里没有改写建议。</p>
                )}
              </section>
              <section className="rdq-group" data-tone="print" aria-label="材料与打印">
                <div className="rdq-group-top">
                  <span className="rdq-group-no" aria-hidden="true">3</span>
                  <b>材料与打印</b>
                  <span className="rdq-group-chip">由你决定</span>
                </div>
                <p className="rdq-group-desc">需要纸质件时，先生成打印版，再在打印确认页决定份数与单双面。</p>
                <div className="rdq-fields">
                  <div className="rdq-field"><small>打印版文件</small><span>尚未生成</span></div>
                  <div className="rdq-field"><small>要不要纸质件</small><span>由你在打印流程里确认</span></div>
                </div>
              </section>
            </div>
            <div className="rdq-ai">
              <EvidenceLegend />
              <AigcMark />
            </div>
          </Sec>

          <Sec title="准备路径" hint="确认后再进入既有流程">
            <RouteCards items={[
              { title: '按建议改简历', desc: '按你确认的方向修改内容，不自动改写简历。', action: '去简历优化', onClick: goResumeOptimize },
              { title: '准备求职材料', desc: '按目标岗位补齐成果、证书这类可出示材料。', action: '去材料工坊', onClick: goMaterials },
              { title: '生成打印版', desc: '文件生成成功后才进入打印确认，生成前不表示已打印。', action: '生成打印版', onClick: () => void handlePrint() },
            ]} />
            <Guardline
              head="清单只供本人准备"
              body="以下内容仅为帮助你修改简历与准备材料的参考，不代表任何招聘结果；本平台不提供投递功能，投递请前往岗位来源平台。"
            />
          </Sec>

          {result?.job?.sourceName && (
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
            <Guardline head="本机会话" body="未登录时，本次结果只保留在这台机器的当前会话里，离场即清。" />
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

  return (
    <JobFitStage>
      <QxPageFrame
        title={view.title}
        subtitle={view.subtitle}
        status={view.pill}
        back={taskId && !identityEnded
          ? { label: '返回比对结果', onBack: backToCompare }
          : { label: '返回简历服务', onBack: goResumeHub }}
        ctabar={view.cta}
        navbar={(
          <QxAppNavbar
            onHome={() => navigate('/')}
            onAdvisor={() => navigate('/assistant')}
            onProfile={() => navigate('/profile')}
          />
        )}
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
      </QxPageFrame>
    </JobFitStage>
  )
}
