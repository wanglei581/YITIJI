// AI 服务记录 — /me/ai-records（本人，仅元数据）。
// 删除成功只在服务端回执后展示；确认超时回到未确认，不乐观移除。

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  JobAiSessionListItem,
  MemberAiRecordItem,
  MemberAiRecordKind,
  MemberInterviewItem,
} from '@ai-job-print/shared'
import {
  BriefcaseIcon,
  FileCheckIcon,
  RouteIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { deleteMyAiRecord, getMyAiRecords } from '../../../services/api/memberAssets'
import { deleteMyJobAiSession, listMyJobAiSessions } from '../../../services/api/jobAi'
import { deleteMyInterview, getMyInterviews } from '../../../services/api/interview'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { QxMeGuide, QxMePage, QxMeSummary, recordsCtabar } from './qx/QxMeChrome'
import { QxMeErrorBlock, QxMeLoadingBlock, QxMeLoginBlock, QxMeStartRow, QxMeStructRow } from './qx/QxMeStateBits'
import { JobAiSessionRecords } from './JobAiSessionRecords'
import { MockInterviewRecords } from './MockInterviewRecords'
import { patchInterviewWorkbenchSession } from '../../interview/interviewWorkbenchSession'
import './styles/member-records-qx.css'

type AiRecordView = MemberAiRecordItem & {
  ref?: { type: 'job_fair'; id: string; name: string } | null
}

const KIND_META: Record<MemberAiRecordKind, { label: string; hint: string; tone?: 'plum' | 'slate' | 'wheat' }> = {
  parse: { label: '简历诊断', hint: '上传简历后的诊断记录' },
  optimize: { label: '简历优化', hint: '基于诊断生成的优化建议', tone: 'plum' },
  generate: { label: 'AI 简历生成', hint: 'AI 引导生成的简历记录' },
  job_fit: { label: '岗位匹配参考', hint: '仅供求职准备参考', tone: 'slate' },
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

function shortTaskId(taskId: string): string {
  return taskId.length > 10 ? `${taskId.slice(0, 6)}...${taskId.slice(-4)}` : taskId
}

function metaLine(item: MemberAiRecordItem): string {
  const expires = item.expiresAt ? ` · 留存至 ${formatTime(item.expiresAt)}` : ''
  return `${item.provider} · 任务 ${shortTaskId(item.taskId)} · ${formatTime(item.createdAt)}${expires}`
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

type LoadState = 'loading' | 'error' | 'ready'
type Toast = { tone: 'ok' | 'bad'; text: string }

export function MyAiRecordsPage() {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<AiRecordView[]>([])
  const [jobAiSessions, setJobAiSessions] = useState<JobAiSessionListItem[]>([])
  const [interviews, setInterviews] = useState<MemberInterviewItem[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmExpired, setConfirmExpired] = useState(false)
  const [confirmJobAiSessionId, setConfirmJobAiSessionId] = useState<string | null>(null)
  const [confirmInterviewId, setConfirmInterviewId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyJobAiSessionId, setBusyJobAiSessionId] = useState<string | null>(null)
  const [busyInterviewId, setBusyInterviewId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const mountedRef = useRef(false)
  const loadSeqRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loadSeqRef.current += 1
    }
  }, [])

  const load = useCallback(() => {
    const seq = loadSeqRef.current + 1
    loadSeqRef.current = seq
    if (!isLoggedIn) {
      setItems([])
      setJobAiSessions([])
      setInterviews([])
      setState('ready')
      return
    }
    setState('loading')
    const token = getToken()
    Promise.all([
      getMyAiRecords(token, { pageSize: 50 }),
      listMyJobAiSessions(token, { pageSize: 50 }),
      getMyInterviews(token),
    ])
      .then(([recordsPage, sessionsPage, interviewPage]) => {
        if (!mountedRef.current || loadSeqRef.current !== seq) return
        setItems(recordsPage.items as AiRecordView[])
        const completedJobFitTaskIds = new Set(
          recordsPage.items
            .filter((item) => item.kind === 'job_fit' && item.status === 'completed')
            .map((item) => item.taskId),
        )
        setJobAiSessions(sessionsPage.items.filter((session) => shouldDisplayJobAiSession(session, completedJobFitTaskIds)))
        setInterviews(interviewPage.items)
        setState('ready')
      })
      .catch(() => {
        if (!mountedRef.current || loadSeqRef.current !== seq) return
        setState('error')
      })
  }, [getToken, isLoggedIn])

  useEffect(() => { load() }, [load, reloadKey])
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

  const totalCount = items.length + jobAiSessions.length + interviews.length
  const empty = totalCount === 0
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

  const struct = (
    <>
      <QxMeStructRow icon={FileCheckIcon} title="简历诊断与优化记录" desc="只存服务元数据，不存原文与模型输出" mode={!isLoggedIn ? 'lock' : 'error'} testid="member-records-struct-ai-records-0" />
      <QxMeStructRow icon={RouteIcon} title="职业规划建议记录" desc="阶段性行动建议的服务记录" mode={!isLoggedIn ? 'lock' : 'error'} testid="member-records-struct-ai-records-1" />
      <QxMeStructRow icon={BriefcaseIcon} title="岗位 AI 参考会话" desc="基于公开岗位字段的解读记录" mode={!isLoggedIn ? 'lock' : 'error'} testid="member-records-struct-ai-records-2" />
    </>
  )

  let body: ReactNode
  if (!isLoggedIn) {
    body = <QxMeLoginBlock title="登录后查看 AI 服务记录" desc="AI 服务记录只在登录后与账号绑定；公共一体机不保存游客记录。" struct={struct} onJobs={() => navigate('/jobs')} onPrint={() => navigate('/print-scan')} />
  } else if (state === 'loading') {
    body = <QxMeLoadingBlock title="正在加载 AI 服务记录" />
  } else if (state === 'error') {
    body = <QxMeErrorBlock title="AI 服务记录这次没有加载出来" desc="当前列表没有更新。请检查网络后重试；已有记录不会因为这次失败而消失。" struct={struct} />
  } else if (empty) {
    body = (
      <>
        <section className="qx-me-banner" data-testid="qx-me-fallback" data-kind="empty">
          <span className="qx-me-banner-ico" aria-hidden="true"><SparklesIcon size={34} /></span>
          <span className="qx-me-banner-main">
            <h2 className="qx-me-banner-t">还没有 AI 服务记录</h2>
            <span className="qx-me-banner-p">完成简历诊断、优化、模拟面试、岗位 AI 参考、职业规划或参会准备后，这里会显示记录。<b>空就是空</b>。</span>
          </span>
          <span className="qx-me-banner-mini"><i>共 0</i></span>
        </section>
        <section className="qx-me-list qx-me-grow" aria-label="从这里开始">
          <QxMeStartRow icon={FileCheckIcon} title="做一次简历诊断" desc="诊断结果会生成一条可回看的服务记录" label="去诊断" route="/resume/source?intent=diagnose" testid="member-records-start-diagnose" onClick={() => navigate('/resume/source?intent=diagnose')} />
          <QxMeStartRow icon={BriefcaseIcon} tone="slate" title="让 AI 解读一个岗位" desc="基于来源岗位的公开字段生成参考解读" label="查看岗位" route="/jobs" testid="member-records-start-jobs" onClick={() => navigate('/jobs')} />
          <QxMeStartRow icon={RouteIcon} tone="wheat" title="做一次职业规划" desc="阶段性行动建议会存成一条服务记录" label="去规划" route="/resume-service" testid="member-records-start-plan" onClick={() => navigate('/resume-service')} />
          <div className="qx-me-legal">仅展示本人 AI 服务元数据，不展示简历原文、诊断正文或模型原始输出。</div>
        </section>
        <QxMeGuide items={[['怎么产生', '用过 AI 服务之后', '诊断、优化、规划、参会准备都会记'], ['这里显示什么', '只有服务元数据', '不展示提示词或模型原始输出'], ['可以删除', '两步确认', '删除后不可恢复']]} />
      </>
    )
  } else {
    body = (
      <>
        <QxMeSummary
          icon={<SparklesIcon size={32} />}
          label="AI 服务记录"
          big={totalCount}
          desc="仅展示本人服务元数据，不展示简历原文、诊断正文或模型原始输出"
          minis={[`当前 ${totalCount} 行`]}
        />
        <section className="qx-me-list qx-me-grow" data-testid="member-records-list" aria-label="AI 服务记录">
          <MockInterviewRecords
            items={interviews}
            confirmId={confirmInterviewId}
            busyId={busyInterviewId}
            onOpen={(sessionId) => {
              // 五页合成一张工作台之后，/interview/report 是工作台的一个 stage 而不是独立路由。
              // 只 navigate 会落到工作台默认 stage（setup），看不到这条记录的报告。
              patchInterviewWorkbenchSession({ stage: 'report', report: { sessionId } })
              navigate('/interview/report', { state: { sessionId } })
            }}
            onDelete={(sessionId) => void removeInterview(sessionId)}
          />
          <JobAiSessionRecords
            items={jobAiSessions}
            confirmId={confirmJobAiSessionId}
            busyId={busyJobAiSessionId}
            onDelete={(sessionId) => void removeJobAiSession(sessionId)}
          />
          {items.length > 0 ? (
            <div className="qx-me-legal">简历与规划 AI 记录 · 仅展示服务元数据，不展示简历原文或诊断正文</div>
          ) : null}
          {items.map((item) => {
            const kind = KIND_META[item.kind] ?? { label: 'AI 服务记录', hint: '本人 AI 服务元数据', tone: 'slate' as const }
            const status = STATUS_META[item.status]
            const confirming = confirmId === item.id
            const expired = confirmExpired && !confirmId && items[0]?.id === item.id
            const busy = busyId === item.id
            return (
              <div key={item.id} className="qx-me-row" data-flag={confirming ? 'true' : undefined} data-record-kind={item.kind} data-record-status={item.status} data-confirm-window={expired ? 'expired' : undefined}>
                <span className="qx-me-row-ico" data-tone={kind.tone} aria-hidden="true"><SparklesIcon size={28} /></span>
                <span className="qx-me-row-main">
                  <span className="qx-me-row-head">
                    <span className="qx-me-chip">{kind.label}</span>
                    <span className="qx-me-st" data-tone={status.tone}>{status.label}</span>
                  </span>
                  <span className="qx-me-row-title" style={{ marginTop: 8 }}>{item.kind === 'fair_visit_plan' && item.ref?.name ? item.ref.name : kind.hint}</span>
                  <span className="qx-me-row-sub">{metaLine(item)}</span>
                  {confirming && item.kind === 'parse' ? <span className="qx-me-reason">删除这条诊断记录时，服务端会同时删除同一任务的派生记录与岗位 AI 会话。</span> : null}
                  {expired ? <span className="qx-me-reason">上一次确认已超时失效，删除未执行；需要重新点击删除。</span> : null}
                  {confirming ? <span className="qx-me-reason">成功即完成删除，失败会提示稍后重试；本页不会提前显示成功。</span> : null}
                  {item.kind === 'fair_visit_plan' && item.ref?.type === 'job_fair' && item.ref.id && item.status === 'completed' ? (
                    <button type="button" className="qx-me-small" style={{ marginTop: 8 }} onClick={() => openFairPlan(item)}>打开这场招聘会规划</button>
                  ) : null}
                </span>
                <span className="qx-me-acts">
                  {confirming ? (
                    <>
                      <button type="button" className="qx-me-small" aria-label="取消删除这条记录" onClick={() => setConfirmId(null)}>
                        <XIcon size={19} aria-hidden />取消
                      </button>
                      <button
                        type="button"
                        className="qx-me-small"
                        data-variant="danger"
                        aria-label="确认删除这条记录，删除后不可恢复"
                        onClick={() => void remove(item)}
                      >
                        <Trash2Icon size={19} aria-hidden />确认删除
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="qx-me-small"
                      data-variant="danger"
                      aria-disabled={busy || undefined}
                      title={confirming ? '再次点击确认删除' : '删除'}
                      aria-label={confirming ? '再次点击确认删除 AI 服务记录' : '删除 AI 服务记录'}
                      onClick={() => void remove(item)}
                    >
                      <Trash2Icon size={19} aria-hidden />{busy ? '正在删除…' : '删除'}
                    </button>
                  )}
                </span>
              </div>
            )
          })}
          <div className={toast?.tone === 'bad' ? 'qx-me-legal' : 'qx-me-legal'}>
            {toast?.tone === 'bad'
              ? '删除失败，记录可能已到期或被清理。列表保持原样，可稍后重试。'
              : confirmingLine(confirmId)}
          </div>
        </section>
      </>
    )
  }

  return (
    <QxMePage
      title="AI服务记录"
      view="ai-records"
      screen="member-list"
      screenState={`ai-records-${uiState}`}
      eyebrow="AI SERVICE RECORDS"
      ask={<>AI 帮你做过什么，<em>一条不落</em>。</>}
      doing={<>只展示<b>服务元数据</b>，不展示简历原文、诊断正文或模型原始输出。</>}
      truth="删除后不可恢复；删除简历诊断记录会同时删除同一任务的派生记录与岗位 AI 会话。"
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
    </QxMePage>
  )
}

function confirmingLine(confirmId: string | null): string {
  return confirmId
    ? '再次点击「确认删除」后不可恢复；删除简历诊断记录会同时删除同一任务的派生记录与岗位 AI 会话。'
    : '删除需要两步确认；未在确认时限内再次点击，会回到未确认状态。删除简历诊断记录会同时删除同一任务的派生记录与岗位 AI 会话。'
}
