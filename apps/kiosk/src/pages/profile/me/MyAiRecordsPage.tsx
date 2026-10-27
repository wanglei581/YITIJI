import { useMemberCursorPage } from './useMemberCursorPage'
import { MemberLoadMore } from './MemberLoadMore'
import { QaRecords } from './QaRecords'
import { aiRecordPath, recordUnavailableReason } from './aiRecordNavigation'
import { clearResumeReferences } from '../../resume/clearResumeReferences'
// AI 服务记录 — /me/ai-records（本人，仅元数据）。
// 删除成功只在服务端回执后展示；确认超时回到未确认，不乐观移除。

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  JobAiSessionListItem,
  MemberAiRecordItem,
  MemberAiRecordKind,
  MemberInterviewItem,
  MemberQaRecordItem,
} from '@ai-job-print/shared'
import { deleteMyAiRecord, getMyAiRecords, type AiRecordsPage } from '../../../services/api/memberAssets'
import { deleteMyJobAiSession, listMyJobAiSessions } from '../../../services/api/jobAi'
import { deleteMyInterview, getMyInterviews } from '../../../services/api/interview'
import { useAuth } from '../../../auth/useAuth'
import { useRecruitmentHosting } from '../../../hooks/useRecruitmentHosting'
import { formatTime } from '../assets/format'
import { QxMePage, recordsCtabar } from './qx/QxMeChrome'
import { MeAiChip, MeEmptyPack, MeExitCard } from '../touch/MeStatePacks'
import { MeActs, MeBtn, MeP, MeRow, MeRows } from '../touch/MeKit'
import { QxMeErrorBlock, QxMeLoadingBlock, QxMeLoginBlock } from './qx/QxMeStateBits'
import { JobAiSessionRecords } from './JobAiSessionRecords'
import { MockInterviewRecords } from './MockInterviewRecords'
import { patchInterviewWorkbenchSession } from '../../interview/interviewWorkbenchSession'
import { AI_CONTENT_COMPLAINT_ROUTE } from './feedback/aiComplaint'
import './styles/member-records-qx.css'

type AiRecordView = MemberAiRecordItem & {
  ref?: { type: 'job_fair'; id: string; name: string } | null
}

const KIND_META: Record<MemberAiRecordKind, { label: string; hint: string; tone?: 'plum' | 'slate' | 'wheat' }> = {
  parse: { label: '简历诊断', hint: '上传简历后的诊断记录' },
  optimize: { label: '简历优化', hint: '基于诊断生成的优化建议', tone: 'plum' },
  generate: { label: 'AI 简历生成', hint: 'AI 引导生成的简历记录' },
  job_fit: { label: '简历对照', hint: '仅供求职准备参考', tone: 'slate' },
  career_plan: { label: '职业规划建议', hint: '阶段性行动建议记录', tone: 'wheat' },
  fair_visit_plan: { label: '招聘会准备单', hint: '基于招聘会公开信息生成', tone: 'wheat' },
  self_assessment: { label: '自我探索 / 个人倾向参考（仅本人可见）', hint: '基于本人作答的 5 维度倾向参考', tone: 'slate' },
}

const STATUS_META: Record<MemberAiRecordItem['status'], { label: string; tone?: 'wait' | 'run' | 'bad' }> = {
  pending: { label: '待处理', tone: 'wait' },
  processing: { label: '处理中', tone: 'run' },
  completed: { label: '已完成' },
  failed: { label: '失败', tone: 'bad' },
}

/** 行内第一行：状态 · 时间 · 保留至（稿 pageAi）。不写模型名和任务编号：那是工程信息。 */
function metaLine(item: MemberAiRecordItem, status: string): string {
  const expires = item.expiresAt ? ` · 保留至 ${formatTime(item.expiresAt)}` : ''
  return `${status} · ${formatTime(item.createdAt)}${expires}`
}

function shouldDisplayJobAiSession(
  session: JobAiSessionListItem,
  completedJobFitTaskIds: Set<string>,
): boolean {
  return session.session.operation !== 'match'
    || session.session.status !== 'completed'
    || !session.session.resumeTaskId
    || !completedJobFitTaskIds.has(session.session.resumeTaskId)
}

type Toast = { tone: 'ok' | 'bad'; text: string }

export function MyAiRecordsPage() {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  // 招聘内容托管（3.13）关闭时：不读、不列岗位 AI 会话与招聘会准备单，也不摆岗位 AI 类入口与说明（那些页不开放）。
  // 托管还没读到时先不拉列表：否则先按「关闭」拉一遍、读到「打开」再拉一遍，列表会闪一次骨架。
  const hosting = useRecruitmentHosting()
  const hostingOpen = hosting.enabled
  const hostingKnown = hosting.status === 'ready'
  const [reloadKey, setReloadKey] = useState(0)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmExpired, setConfirmExpired] = useState(false)
  const [confirmJobAiSessionId, setConfirmJobAiSessionId] = useState<string | null>(null)
  const [confirmInterviewId, setConfirmInterviewId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyJobAiSessionId, setBusyJobAiSessionId] = useState<string | null>(null)
  const [busyInterviewId, setBusyInterviewId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const token = getToken()
  const enabled = isLoggedIn && hostingKnown
  // GET /me/ai-records 的首页同时带回记录和小青作业。两个分页器各拉一遍就是两次一模一样的请求，
  // 所以首页由记录分页器发、小青作业分页器共用同一个请求；之后各按自己的游标加载更多。
  // 两个分页器的 effect 依赖相同、按声明顺序执行，记录那边总是先发出新的首页请求。
  const firstRecordsPage = useRef<Promise<AiRecordsPage> | null>(null)
  const fetchRecords = useCallback((cursor?: string) => {
    if (cursor) return getMyAiRecords(token, { pageSize: 50, cursor })
    const request = getMyAiRecords(token, { pageSize: 50 })
    firstRecordsPage.current = request
    return request
  }, [token])
  const fetchQa = useCallback(async (qaCursor?: string) => {
    const page = await (qaCursor
      ? getMyAiRecords(token, { pageSize: 50, qaCursor })
      : firstRecordsPage.current ?? getMyAiRecords(token, { pageSize: 50 }))
    return { items: page.qaRecords, total: page.qaTotal, nextCursor: page.qaNextCursor }
  }, [token])
  const fetchSessions = useCallback((cursor?: string) => listMyJobAiSessions(token, { pageSize: 50, cursor }), [token])
  const fetchInterviews = useCallback((cursor?: string) => getMyInterviews(token, { pageSize: 50, cursor }), [token])
  const recordsPage = useMemberCursorPage<AiRecordView>({ enabled, identityKey: token, reloadKey, fetchPage: fetchRecords })
  const qaPage = useMemberCursorPage<MemberQaRecordItem>({ enabled, identityKey: token, reloadKey, fetchPage: fetchQa })
  const sessionsPage = useMemberCursorPage<JobAiSessionListItem>({ enabled: enabled && hostingOpen, identityKey: token, reloadKey, fetchPage: fetchSessions, keyOf: (item) => item.session.id })
  const interviewPage = useMemberCursorPage<MemberInterviewItem>({ enabled, identityKey: token, reloadKey, fetchPage: fetchInterviews, keyOf: (item) => item.sessionId })
  const { setItems } = recordsPage
  const { items: interviews, setItems: setInterviews } = interviewPage
  const { setItems: setJobAiSessions } = sessionsPage
  const items = hostingOpen ? recordsPage.items : recordsPage.items.filter((item) => item.kind !== 'fair_visit_plan')
  const completedJobFitTaskIds = new Set(items.filter((item) => item.kind === 'job_fit' && item.status === 'completed').map((item) => item.taskId))
  const jobAiSessions = sessionsPage.items.filter((item) => shouldDisplayJobAiSession(item, completedJobFitTaskIds))
  const pages = [recordsPage, qaPage, interviewPage, ...(hostingOpen ? [sessionsPage] : [])]
  const state = !hostingKnown || pages.some((page) => page.state === 'loading') ? 'loading'
    : pages.some((page) => page.state === 'error') ? 'error' : 'ready'

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])
  useEffect(() => {
    if (!confirmId) return
    const t = setTimeout(() => {
      setConfirmId(null)
      setConfirmExpired(true)
    }, 3500)
    return () => clearTimeout(t)
  }, [confirmId])
  useEffect(() => {
    if (!confirmJobAiSessionId) return
    const t = setTimeout(() => setConfirmJobAiSessionId(null), 3500)
    return () => clearTimeout(t)
  }, [confirmJobAiSessionId])
  useEffect(() => {
    if (!confirmInterviewId) return
    const t = setTimeout(() => setConfirmInterviewId(null), 3500)
    return () => clearTimeout(t)
  }, [confirmInterviewId])

  const remove = async (record: MemberAiRecordItem) => {
    if (confirmId !== record.id) {
      setConfirmExpired(false)
      setConfirmId(record.id)
      return
    }
    const token = getToken()
    if (!token) return
    setBusyId(record.id)
    try {
      const result = await deleteMyAiRecord(token, record.id)
      if (record.kind === 'parse') {
        setItems((prev) => prev.filter((item) => item.taskId !== record.taskId))
        setJobAiSessions((prev) => prev.filter((item) => item.session.resumeTaskId !== record.taskId))
      } else {
        setItems((prev) => prev.filter((item) => item.id !== record.id))
      }
      if (record.kind === 'job_fit') {
        setJobAiSessions((prev) => prev.filter((item) => !(
          item.session.operation === 'match' && item.session.resumeTaskId === record.taskId
        )))
      }
      clearResumeReferences(record.taskId)
      setReloadKey((key) => key + 1)
      setConfirmId(null)
      setToast({ tone: 'ok', text: result.deletedCount > 1 ? '记录及关联分析结果已删除' : '记录已删除' })
    } catch {
      setToast({ tone: 'bad', text: '删除失败，记录可能已到期或被清理' })
    } finally {
      setBusyId(null)
    }
  }

  const removeJobAiSession = async (sessionId: string) => {
    if (confirmJobAiSessionId !== sessionId) {
      setConfirmJobAiSessionId(sessionId)
      return
    }
    const token = getToken()
    if (!token) return
    setBusyJobAiSessionId(sessionId)
    try {
      await deleteMyJobAiSession(token, sessionId)
      setJobAiSessions((prev) => prev.filter((item) => item.session.id !== sessionId))
      setReloadKey((key) => key + 1)
      setConfirmJobAiSessionId(null)
      setToast({ tone: 'ok', text: '岗位 AI 参考记录已删除' })
    } catch {
      setToast({ tone: 'bad', text: '删除失败，记录可能已到期或被清理' })
    } finally {
      setBusyJobAiSessionId(null)
    }
  }

  const removeInterview = async (sessionId: string) => {
    if (confirmInterviewId !== sessionId) {
      setConfirmInterviewId(sessionId)
      return
    }
    const token = getToken()
    if (!token) return
    setBusyInterviewId(sessionId)
    try {
      await deleteMyInterview(token, sessionId)
      setInterviews((prev) => prev.filter((item) => item.sessionId !== sessionId))
      setReloadKey((key) => key + 1)
      setConfirmInterviewId(null)
      setToast({ tone: 'ok', text: '模拟面试记录已删除' })
    } catch {
      setToast({ tone: 'bad', text: '删除失败，记录可能已到期或被清理' })
    } finally {
      setBusyInterviewId(null)
    }
  }

  const openFairPlan = (item: AiRecordView) => {
    if (item.kind !== 'fair_visit_plan' || item.ref?.type !== 'job_fair' || !item.ref.id) return
    navigate(`/job-fairs/${encodeURIComponent(item.ref.id)}/visit-plan`, { state: { taskId: item.taskId } })
  }

  const totalCount = items.length + jobAiSessions.length + interviews.length + qaPage.items.length
  const empty = totalCount === 0 && !pages.some((page) => page.nextCursor)
  const uiState = !isLoggedIn
    ? 'login'
    : state === 'loading'
      ? 'loading'
      : state === 'error'
        ? 'error'
        : empty
          ? 'empty'
          : busyId
            ? 'deleting'
            : toast?.tone === 'ok'
              ? 'delete-success'
              : toast?.tone === 'bad'
                ? 'delete-failure'
                : confirmExpired
                  ? 'delete-expired'
                  : confirmId
                    ? 'delete-confirm'
                    : 'ready'

  const toggleRow = (key: string) => {
    setOpenKey((prev) => (prev === key ? null : key))
    setConfirmId(null)
    setConfirmInterviewId(null)
    setConfirmJobAiSessionId(null)
  }

  let body: ReactNode
  if (!isLoggedIn) {
    body = <QxMeLoginBlock title="登录后查看 AI 服务记录" />
  } else if (state === 'loading') {
    body = <QxMeLoadingBlock title="正在加载 AI 服务记录" />
  } else if (state === 'error') {
    body = <QxMeErrorBlock onRetry={() => setReloadKey((k) => k + 1)} />
  } else if (empty) {
    body = (
      <div className="me-state" data-testid="qx-me-fallback">
        <MeEmptyPack sentence="还没有 AI 服务记录。做过诊断、优化、生成、规划或模拟面试之后，会出现在这里。">
          <MeExitCard art="resume" artWidth={120} title="去做简历诊断" desc="上传一份简历，先做诊断" onClick={() => navigate('/resume/source?intent=diagnose')} />
          <MeExitCard art="checklist" artWidth={110} title="查政策" desc="看本机构发布的就业政策" onClick={() => navigate('/policy-service')} />
        </MeEmptyPack>
      </div>
    )
  } else {
    body = (
      <>
        <MeRows few={totalCount < 5 && openKey === null} testId="member-records-list" label="AI 服务记录">
          <QaRecords items={qaPage.items} token={token ?? null} onDeleted={() => setReloadKey((key) => key + 1)} openKey={openKey} onToggle={toggleRow} />
          <MockInterviewRecords
            items={interviews}
            confirmId={confirmInterviewId}
            busyId={busyInterviewId}
            openKey={openKey}
            onToggle={toggleRow}
            onOpen={(sessionId) => {
              // 五页合成一张工作台之后，/interview/report 是工作台的一个 stage 而不是独立路由。
              // 只 navigate 会落到工作台默认 stage（setup），看不到这条记录的报告。
              patchInterviewWorkbenchSession({ stage: 'report', report: { sessionId } })
              navigate('/interview/report', { state: { sessionId } })
            }}
            onDelete={(sessionId) => void removeInterview(sessionId)}
          />
          {hostingOpen ? (
            <JobAiSessionRecords
              items={jobAiSessions}
              confirmId={confirmJobAiSessionId}
              busyId={busyJobAiSessionId}
              openKey={openKey}
              onToggle={toggleRow}
              onDelete={(sessionId) => void removeJobAiSession(sessionId)}
            />
          ) : null}
          {items.map((item) => {
            const kind = KIND_META[item.kind] ?? { label: 'AI 服务记录', hint: '本人 AI 服务记录' }
            const status = STATUS_META[item.status]
            const openPath = aiRecordPath(item)
            const openReason = recordUnavailableReason(item)
            const confirming = confirmId === item.id
            const expired = confirmExpired && !confirmId && items[0]?.id === item.id
            const busy = busyId === item.id
            const key = `rec-${item.id}`
            const isOpen = openKey === key
            return (
              <MeRow
                key={item.id}
                data-flag={confirming ? 'true' : undefined}
                data-record-kind={item.kind}
                data-record-status={item.status}
                data-confirm-window={expired ? 'expired' : undefined}
                open={isOpen || confirming}
                onToggle={() => toggleRow(key)}
                title={item.kind === 'fair_visit_plan' && item.ref?.name ? item.ref.name : kind.label}
                lines={[metaLine(item, status.label)]}
                chips={<MeAiChip />}
                actions={(
                  <MeActs>
                    {openPath ? <MeBtn v="pri" disabled={busy} onClick={() => navigate(openPath)}>打开</MeBtn> : null}
                    {hostingOpen && item.kind === 'fair_visit_plan' && item.ref?.type === 'job_fair' && item.ref.id && item.status === 'completed' ? (
                      <MeBtn v="sec" onClick={() => openFairPlan(item)}>打开这场招聘会规划</MeBtn>
                    ) : null}
                    {confirming ? (
                      <>
                        <MeBtn v="danger" aria-label="确认删除这条记录，删除后不可恢复" onClick={() => void remove(item)}>确认删除</MeBtn>
                        <MeBtn v="sec" aria-label="取消删除这条记录" onClick={() => setConfirmId(null)}>取消</MeBtn>
                      </>
                    ) : (
                      <MeBtn
                        v="sec"
                        aria-disabled={busy || undefined}
                        aria-label="删除 AI 服务记录"
                        onClick={() => void remove(item)}
                      >
                        {busy ? '正在删除…' : '删除'}
                      </MeBtn>
                    )}
                  </MeActs>
                )}
                extra={(
                  <>
                    {openReason ? <MeP tone="reason">{openReason}</MeP> : null}
                    {confirming && item.kind === 'parse' ? <MeP tone="reason">删除这条诊断记录时，会同时删除这份简历的优化稿、简历对照、职业规划及相关 AI 分析记录。</MeP> : null}
                    {expired ? <MeP tone="reason">上一次确认已超时失效，删除未执行；需要重新点击删除。</MeP> : null}
                    {confirming ? <MeP tone="reason">成功即完成删除，失败会提示稍后重试；本页不会提前显示成功。</MeP> : null}
                  </>
                )}
              />
            )
          })}
        </MeRows>
        {totalCount < 5 && openKey === null ? (
          <div className="me-stack">
            <MeExitCard art="resume" artWidth={110} title="去做简历诊断" desc="上传一份简历，先做诊断" onClick={() => navigate('/resume/source?intent=diagnose')} />
            <MeExitCard art="checklist" artWidth={100} title="查政策" desc="看本机构发布的就业政策" onClick={() => navigate('/policy-service')} />
          </div>
        ) : null}
        <MemberLoadMore {...qaPage} label="加载更多小青作业" />
        <MemberLoadMore {...interviewPage} label="加载更多模拟面试" />
        {hostingOpen ? <MemberLoadMore {...sessionsPage} label="加载更多岗位 AI 记录" /> : null}
      </>
    )
  }

  return (
    <QxMePage
      title="AI 服务记录"
      view="ai-records"
      screen="member-list"
      screenState={`ai-records-${uiState}`}
      eyebrow="我的 · AI 服务记录"
      sub="列表不显示原文、提示词和输出全文"
      fine={`仅展示本人 AI 服务记录，不展示简历原文、诊断正文或模型原始输出。诊断、优化、生成、对照、规划、自我探索和模拟面试都在这里。${confirmingLine(confirmId)}`}
      toast={toast}
      ctabar={recordsCtabar(
        uiState === 'login' || uiState === 'loading' || uiState === 'error' ? uiState : 'ready',
        navigate,
        () => setReloadKey((k) => k + 1),
        '/me/ai-records',
        '去做简历诊断',
        () => navigate('/resume/source?intent=diagnose'),
      )}
    >
      {body}
      {isLoggedIn && state === 'ready' ? <MemberLoadMore {...recordsPage} label="加载更多简历与规划记录" /> : null}
      {/* AI 内容投诉入口（C3，走查 W-01）：稿 39 没画，放在列表下面，写清是哪个功能、什么时间、哪段内容。 */}
      {isLoggedIn ? (
        <div className="me-static" data-testid="member-records-ai-complaint">
          <MeP>对 AI 生成的内容有异议？可以投诉，写清是哪个功能、什么时间、哪段内容。</MeP>
          <MeActs>
            <MeBtn v="sec" data-route={AI_CONTENT_COMPLAINT_ROUTE} onClick={() => navigate(AI_CONTENT_COMPLAINT_ROUTE)}>投诉 AI 内容</MeBtn>
          </MeActs>
        </div>
      ) : null}
    </QxMePage>
  )
}

function confirmingLine(confirmId: string | null): string {
  return confirmId
    ? '再点一次「确认删除」后不可恢复；删除简历诊断记录会同时删除这份简历的优化稿、简历对照、职业规划及相关 AI 分析记录。'
    : '删除需要两步确认；超过确认时限没有再点，会回到未确认状态。离开 3 分钟没操作会自动退出。'
}
