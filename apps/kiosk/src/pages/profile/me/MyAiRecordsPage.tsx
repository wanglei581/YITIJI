// ============================================================
// AI 服务记录 — /me/ai-records（本人，仅元数据）。
// 不展示简历原文 / payload / 诊断正文；删除本人记录走既有硬删与审计链路。
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card } from '@ai-job-print/ui'
import type { JobAiSessionListItem, MemberAiRecordItem, MemberAiRecordKind } from '@ai-job-print/shared'
import { SparklesIcon, Trash2Icon } from 'lucide-react'
import { deleteMyAiRecord, getMyAiRecords } from '../../../services/api/memberAssets'
import { deleteMyJobAiSession, listMyJobAiSessions } from '../../../services/api/jobAi'
import { useAuth } from '../../../auth/useAuth'
import { KIcon, type KioskIconName } from '../../../components/kiosk-icon'
import { useInkRipple } from '../../../hooks/useInkRipple'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'
import { JobAiSessionRecords } from './JobAiSessionRecords'
import './me-detail-inkpaper.css'

const KIND_META: Record<MemberAiRecordKind, { label: string; hint: string; icon: KioskIconName; tone: string }> = {
  parse: { label: '简历诊断', hint: '上传简历后的诊断记录', icon: 'doc-check', tone: 'teal' },
  optimize: { label: '简历优化', hint: '基于诊断生成的优化建议', icon: 'sparkle', tone: 'rose' },
  generate: { label: 'AI 简历生成', hint: 'AI 引导生成的简历记录', icon: 'resume', tone: 'teal' },
  job_fit: { label: '岗位匹配参考', hint: '仅供求职准备参考', icon: 'briefcase', tone: 'slate' },
  career_plan: { label: '职业规划建议', hint: '阶段性行动建议记录', icon: 'route', tone: 'wheat' },
  fair_visit_plan: { label: '招聘会准备单', hint: '基于招聘会公开信息生成', icon: 'fair', tone: 'wheat' },
}

const UNKNOWN_KIND_META = {
  label: 'AI 服务记录',
  hint: '本人 AI 服务元数据',
  icon: 'sparkle' as KioskIconName,
  tone: 'slate',
}

const STATUS_META: Record<MemberAiRecordItem['status'], { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'is-warning' },
  processing: { label: '处理中', cls: 'is-muted' },
  completed: { label: '已完成', cls: 'is-active' },
  failed: { label: '失败', cls: 'is-danger' },
}

function shortTaskId(taskId: string): string {
  return taskId.length > 10 ? `${taskId.slice(0, 6)}...${taskId.slice(-4)}` : taskId
}

function metaLine(item: MemberAiRecordItem): string {
  const expires = item.expiresAt ? ` · 留存至 ${formatTime(item.expiresAt)}` : ''
  return `${item.provider} · 任务 ${shortTaskId(item.taskId)} · ${formatTime(item.createdAt)}${expires}`
}

/**
 * 已完成 job_fit 结果已承担同次 match 的可回看元数据，避免同一次分析出现两条成功记录。
 * 失败/处理中及 recommend/explain 会话仍保留，不能被成功结果掩盖。
 */
function shouldDisplayJobAiSession(
  session: JobAiSessionListItem,
  completedJobFitTaskIds: Set<string>,
): boolean {
  return session.session.operation !== 'match'
    || session.session.status !== 'completed'
    || !session.session.resumeTaskId
    || !completedJobFitTaskIds.has(session.session.resumeTaskId)
}

export function MyAiRecordsPage() {
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberAiRecordItem[]>([])
  const [jobAiSessions, setJobAiSessions] = useState<JobAiSessionListItem[]>([])
  const [state, setState] = useState<MeListState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmJobAiSessionId, setConfirmJobAiSessionId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyJobAiSessionId, setBusyJobAiSessionId] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const mountedRef = useRef(false)
  const loadSeqRef = useRef(0)
  useInkRipple('.me-inkdetail .me-ripple')

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
      setState('ready')
      return
    }
    setState('loading')
    const token = getToken()
    Promise.all([
      getMyAiRecords(token, { pageSize: 50 }),
      listMyJobAiSessions(token, { pageSize: 50 }),
    ])
      .then(([recordsPage, sessionsPage]) => {
        if (!mountedRef.current || loadSeqRef.current !== seq) return
        setItems(recordsPage.items)
        const completedJobFitTaskIds = new Set(
          recordsPage.items
            .filter((item) => item.kind === 'job_fit' && item.status === 'completed')
            .map((item) => item.taskId),
        )
        setJobAiSessions(sessionsPage.items.filter((session) => shouldDisplayJobAiSession(session, completedJobFitTaskIds)))
        setState('ready')
      })
      .catch(() => {
        if (!mountedRef.current || loadSeqRef.current !== seq) return
        setState('error')
      })
  }, [getToken, isLoggedIn])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(null), 3000)
    return () => clearTimeout(t)
  }, [hint])

  useEffect(() => {
    if (!confirmId) return
    const t = setTimeout(() => setConfirmId(null), 3500)
    return () => clearTimeout(t)
  }, [confirmId])

  useEffect(() => {
    if (!confirmJobAiSessionId) return
    const t = setTimeout(() => setConfirmJobAiSessionId(null), 3500)
    return () => clearTimeout(t)
  }, [confirmJobAiSessionId])

  const remove = async (record: MemberAiRecordItem) => {
    if (confirmId !== record.id) {
      setConfirmId(record.id)
      return
    }
    const token = getToken()
    if (!token) return
    setBusyId(record.id)
    try {
      const result = await deleteMyAiRecord(token, record.id)
      if (record.kind === 'parse') {
        // 服务端删除 parse 会在同一事务中级联同 taskId 的派生记录和全部岗位 AI 会话。
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
      setHint(result.deletedCount > 1 ? '记录及关联分析结果已删除' : '记录已删除')
    } catch {
      setHint('删除失败，记录可能已到期或被清理')
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
      setHint('岗位 AI 参考记录已删除')
    } catch {
      setHint('删除失败，记录可能已到期或被清理')
    } finally {
      setBusyJobAiSessionId(null)
    }
  }

  const totalCount = items.length + jobAiSessions.length
  const completedCount =
    items.filter((item) => item.status === 'completed').length +
    jobAiSessions.filter((item) => item.session.status === 'completed').length

  return (
    <div className="me-inkdetail me-inkdetail-ai-records h-full">
      {hint && (
        <div role="status" className="me-toast fixed left-1/2 top-4 z-50 -translate-x-1/2 px-5 py-2.5">
          {hint}
        </div>
      )}

      <MeListShell
        title="AI服务记录"
        subtitle="本人 AI 简历、岗位匹配、职业规划与参会准备服务记录（仅元数据）"
        loginFrom="/me/ai-records"
        isLoggedIn={isLoggedIn}
        state={state}
        onRetry={() => setReloadKey((k) => k + 1)}
        isEmpty={items.length === 0 && jobAiSessions.length === 0}
        emptyIcon={SparklesIcon}
        emptyTitle="还没有 AI 服务记录"
        emptyDescription="完成简历诊断、优化、岗位 AI 参考、职业规划或参会准备后，这里会显示记录"
      >
        <section className="me-detail-summary" aria-label="AI 服务记录概览">
          <span className="me-summary-icon me-tone-teal" aria-hidden="true">
            <KIcon name="robot" />
          </span>
          <div className="min-w-0 flex-1">
            <p>AI 服务记录</p>
            <strong>{totalCount}</strong>
            <span>仅展示本人服务元数据，不展示简历原文、诊断正文或模型原始输出</span>
          </div>
          <div className="me-summary-mini" aria-label="AI 服务记录状态数量">
            <span>已完成 {completedCount}</span>
            <span>处理中 {totalCount - completedCount}</span>
          </div>
        </section>

        <JobAiSessionRecords
          items={jobAiSessions}
          confirmId={confirmJobAiSessionId}
          busyId={busyJobAiSessionId}
          onDelete={(sessionId) => void removeJobAiSession(sessionId)}
        />

        {items.length > 0 && (
          <div className="me-section-copy">
            <h2>简历与规划 AI 记录</h2>
            <p>仅展示本人 AI 服务元数据，不展示简历原文、诊断正文或文件内容。</p>
          </div>
        )}

        {items.map((item) => {
          const kind = KIND_META[item.kind] ?? UNKNOWN_KIND_META
          const status = STATUS_META[item.status]
          const confirming = confirmId === item.id
          return (
            <Card key={item.id} className="me-benefit-card me-ripple">
              <div className="flex items-center gap-4">
              <span className={['me-row-icon', `me-tone-${kind.tone}`].join(' ')} aria-hidden="true">
                <KIcon name={kind.icon} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="me-chip">{kind.label}</span>
                  <span className={['me-status', status.cls].join(' ')}>
                    {status.label}
                  </span>
                </div>
                <p className="me-row-title mt-2">{kind.hint}</p>
                <p className="me-row-meta">{metaLine(item)}</p>
              </div>
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => void remove(item)}
                title={confirming ? '再次点击确认删除' : '删除'}
                aria-label={confirming ? '再次点击确认删除 AI 服务记录' : '删除 AI 服务记录'}
                className={[
                  'me-delete-button me-ripple',
                  confirming
                    ? 'is-confirm'
                    : '',
                ].join(' ')}
              >
                <Trash2Icon className="h-4 w-4" aria-hidden="true" />
                {confirming && <span className="ml-1">确认删除</span>}
              </button>
              </div>
            </Card>
          )
        })}
        <p className="me-legal-note">仅展示本人 AI 服务元数据，不展示简历原文、诊断正文或文件内容</p>
      </MeListShell>
    </div>
  )
}
